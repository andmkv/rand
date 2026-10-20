import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const sqlOnlyTriggers = [
  {
    name: "immutable_project_revision",
    table_name: "project_revisions",
    function: "prevent_revision_rewrite",
  },
  {
    name: "user_asset_versions_immutable",
    table_name: "user_asset_versions",
    function: "reject_user_asset_version_update",
  },
];
// 0009 drops the classroom table/trigger but intentionally leaves the historical
// trigger function; it is inert and cannot run without a trigger attachment.
const sqlOnlyTriggerFunctions = [
  "prevent_revision_rewrite",
  "protect_submission_identity",
  "reject_user_asset_version_update",
];

type CatalogSnapshot = {
  tables: unknown[];
  enums: unknown[];
  columns: unknown[];
  constraints: unknown[];
  indexes: unknown[];
};

function normalizeDefinition(value: string | null, schema: string) {
  if (value === null) return null;
  return value
    .replaceAll(`"${schema}".`, "")
    .replaceAll(`${schema}.`, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function catalogSnapshot(
  pool: Pool,
  schema: string,
): Promise<CatalogSnapshot> {
  const normalizeRows = (rows: Record<string, unknown>[]) =>
    rows
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "string"
              ? normalizeDefinition(value, schema)
              : value,
          ]),
        ),
      )
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  const [tables, enums, columns, constraints, indexes] = await Promise.all([
    pool.query(
      `select c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relkind in ('r', 'p')
       order by c.relname`,
      [schema],
    ),
    pool.query(
      `select t.typname as name, e.enumlabel as label, e.enumsortorder as order
       from pg_type t join pg_namespace n on n.oid = t.typnamespace
       join pg_enum e on e.enumtypid = t.oid
       where n.nspname = $1
       order by t.typname, e.enumsortorder`,
      [schema],
    ),
    pool.query(
      `select c.relname as table_name, a.attname as column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
              a.attnotnull as not_null, pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
       where n.nspname = $1 and c.relkind in ('r', 'p')
         and a.attnum > 0 and not a.attisdropped
       order by c.relname, a.attnum`,
      [schema],
    ),
    pool.query(
      `select t.relname as table_name, con.conname as name,
              con.contype as kind, pg_catalog.pg_get_constraintdef(con.oid, true) as definition
       from pg_constraint con
       join pg_class t on t.oid = con.conrelid
       join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = $1
       order by t.relname, con.conname`,
      [schema],
    ),
    pool.query(
      `select t.relname as table_name, i.relname as name,
              pg_catalog.pg_get_indexdef(i.oid) as definition
       from pg_index ix
       join pg_class t on t.oid = ix.indrelid
       join pg_class i on i.oid = ix.indexrelid
       join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = $1
       order by t.relname, i.relname`,
      [schema],
    ),
  ]);
  return {
    tables: normalizeRows(tables.rows),
    enums: normalizeRows(enums.rows),
    columns: normalizeRows(columns.rows),
    constraints: normalizeRows(constraints.rows),
    indexes: normalizeRows(indexes.rows),
  };
}

test(
  "manual 0000–0011 SQL catalog matches server/db/schema.ts; SQL-only triggers are explicit",
  { timeout: 150000 },
  async () => {
    const pg = await disposablePostgres();
    const temporary = await mkdtemp(join(tmpdir(), "randusr-schema-drift-"));
    const output = join(temporary, "generated-reference");
    const configPath = join(
      repositoryRoot,
      `.drizzle-schema-check-${process.pid}-${randomUUID()}.config.ts`,
    );
    const referenceSchema = `drizzle_reference_${process.pid}`;
    try {
      await migrateDatabase(pg.db);
      const config = `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: ${JSON.stringify(join(repositoryRoot, "server/db/schema.ts"))},
  out: ${JSON.stringify(output)},
});
`;
      await writeFile(configPath, config, { flag: "wx" });
      await execFileAsync(
        join(repositoryRoot, "node_modules/.bin/drizzle-kit"),
        ["generate", `--config=${configPath}`, "--name=reference"],
        { cwd: repositoryRoot, timeout: 60_000, maxBuffer: 2_000_000 },
      );
      const generatedSql = (await readdir(output)).filter((name) =>
        name.endsWith(".sql"),
      );
      assert.equal(
        generatedSql.length,
        1,
        "expected a fresh temporary baseline",
      );
      let ddl = await readFile(join(output, generatedSql[0]), "utf8");
      ddl = ddl
        .replaceAll('"public".', `"${referenceSchema}".`)
        .replaceAll("public.", `${referenceSchema}.`);

      const client = await pg.pool.connect();
      try {
        await client.query(`create schema "${referenceSchema}"`);
        await client.query(`set search_path to "${referenceSchema}"`);
        for (const statement of ddl.split(/-->\s*statement-breakpoint/)) {
          if (statement.trim()) await client.query(statement);
        }
        await client.query("reset search_path");
      } finally {
        client.release();
      }

      const [applied, declared] = await Promise.all([
        catalogSnapshot(pg.pool, "public"),
        catalogSnapshot(pg.pool, referenceSchema),
      ]);
      assert.deepEqual(
        applied,
        declared,
        "the ordered SQL migration result differs from the current Drizzle declarations",
      );

      const triggers = await pg.pool.query(
        `select tr.tgname as name, rel.relname as table_name, proc.proname as function
         from pg_trigger tr
         join pg_class rel on rel.oid = tr.tgrelid
         join pg_namespace ns on ns.oid = rel.relnamespace
         join pg_proc proc on proc.oid = tr.tgfoid
         where ns.nspname = 'public' and not tr.tgisinternal
         order by tr.tgname`,
      );
      assert.deepEqual(triggers.rows, sqlOnlyTriggers);
      const triggerFunctions = await pg.pool.query(
        `select proc.proname as name
         from pg_proc proc
         join pg_namespace ns on ns.oid = proc.pronamespace
         where ns.nspname = 'public' and proc.prorettype = 'trigger'::regtype
         order by proc.proname`,
      );
      assert.deepEqual(
        triggerFunctions.rows.map((row) => row.name),
        sqlOnlyTriggerFunctions,
      );
    } finally {
      await pg.stop();
      await rm(configPath, { force: true });
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
