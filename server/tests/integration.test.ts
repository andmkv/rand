import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase, migrationsFolder } from "../db/migrate.js";
import { seedDatabase } from "../db/seed.js";
import * as schema from "../db/schema.js";
import { buildApp } from "../app.js";
import { requirePermission, hashToken, sessionCookie } from "../access.js";
import { matrix, roles, expected } from "./matrix.js";
const execFileAsync = promisify(execFile);
let connection: Awaited<ReturnType<typeof disposablePostgres>>;
let app: ReturnType<typeof buildApp>;
let temporary: string;
const existingEmail = "migration@example.invalid";
const existingProjectCode = "migration-preserved";
const existingProjectSnapshot = { code: '10 PRINT "kept"' };
const existingProjectPublishedAt = new Date("2026-10-01T12:00:00.000Z");
let existingUserId: string;
let existingProjectId: string;
let existingPublishedRevisionId: string;

before(
  async () => {
    connection = await disposablePostgres();
    temporary = await mkdtemp(join(tmpdir(), "randusr-migration-"));
    await mkdir(join(temporary, "meta"));
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    );
    // Start this database at the immediately previous released schema so the
    // migration test exercises the real 0009 -> 0011 upgrade.
    journal.entries = journal.entries.slice(0, 10);
    await writeFile(
      join(temporary, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      await copyFile(
        join(migrationsFolder, `${entry.tag}.sql`),
        join(temporary, `${entry.tag}.sql`),
      );
    await migrateDatabase(connection.db, temporary);
    const userResult = await connection.pool.query<{ id: string }>(
      `insert into users (email, display_name, password_hash)
       values ($1, 'Preserved', 'test-only-not-a-real-password') returning id`,
      [existingEmail],
    );
    existingUserId = userResult.rows[0].id;
    const projectResult = await connection.pool.query<{ id: string }>(
      `insert into projects (owner_id, title, snapshot_version, snapshot, mode, short_code)
       values ($1, $2, 2, $3::jsonb, 'sandbox', $4) returning id`,
      [
        existingUserId,
        "Preserved project",
        JSON.stringify(existingProjectSnapshot),
        existingProjectCode,
      ],
    );
    existingProjectId = projectResult.rows[0].id;
    const revisionResult = await connection.pool.query<{ id: string }>(
      `insert into project_revisions
         (project_id, actor_id, number, snapshot_version, snapshot, reason)
       values ($1, $2, 1, 2, $3::jsonb, 'save') returning id`,
      [
        existingProjectId,
        existingUserId,
        JSON.stringify(existingProjectSnapshot),
      ],
    );
    existingPublishedRevisionId = revisionResult.rows[0].id;
    await connection.pool.query(
      `update projects
       set visibility = 'public', published_revision_id = $1, published_at = $2
       where id = $3`,
      [
        existingPublishedRevisionId,
        existingProjectPublishedAt,
        existingProjectId,
      ],
    );
  },
  { timeout: 150000 },
);
after(async () => {
  await app?.close();
  await connection?.stop();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test("migrations install fresh and upgrade 0009 to 0011 repeatedly without losing accounts or projects", async () => {
  await migrateDatabase(connection.db);
  await migrateDatabase(connection.db); // safe repeated invocation
  const user = await connection.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, existingEmail));
  assert.equal(user[0].displayName, "Preserved");
  const project = await connection.db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.shortCode, existingProjectCode));
  assert.equal(project.length, 1);
  assert.equal(project[0].ownerId, user[0].id);
  assert.equal(project[0].title, "Preserved project");
  assert.deepEqual(project[0].snapshot, existingProjectSnapshot);
  assert.equal(project[0].visibility, "public");
  assert.equal(project[0].publishedRevisionId, existingPublishedRevisionId);
  assert.equal(
    project[0].publishedAt?.toISOString(),
    existingProjectPublishedAt.toISOString(),
  );
  const retainedRevision = await connection.db
    .select()
    .from(schema.projectRevisions)
    .where(eq(schema.projectRevisions.id, existingPublishedRevisionId));
  assert.equal(retainedRevision.length, 1);
  assert.equal(retainedRevision[0].projectId, existingProjectId);
  assert.equal(retainedRevision[0].actorId, existingUserId);
  assert.deepEqual(retainedRevision[0].snapshot, existingProjectSnapshot);
  const tables = await connection.pool.query(
    "select tablename from pg_tables where schemaname='public'",
  );
  assert.equal(tables.rows.length, 16);
  assert.ok(tables.rows.some((row) => row.tablename === "user_assets"));
  assert.ok(tables.rows.some((row) => row.tablename === "user_asset_versions"));
  assert.ok(!tables.rows.some((row) => row.tablename === "classes"));
  const assetIndexes = await connection.pool.query(
    "select indexname from pg_indexes where schemaname='public' and tablename in ('user_assets', 'user_asset_versions')",
  );
  for (const name of [
    "user_assets_owner_alias",
    "user_assets_owner_updated",
    "user_asset_versions_asset_number_unique",
    "user_asset_versions_asset_created",
  ])
    assert.ok(
      assetIndexes.rows.some((row) => row.indexname === name),
      name,
    );
  for (const [index, type] of ["sfx", "instrument"].entries())
    await connection.pool.query(
      `insert into user_assets (owner_id, type, name, alias) values ($1, $2, $3, $4)`,
      [existingUserId, type, `Sound ${type}`, `@migration-${index}`],
    );
  await assert.rejects(
    connection.pool.query(
      `insert into user_assets (owner_id, type, name, alias) values ($1, 'unknown', 'Bad', '@bad')`,
      [existingUserId],
    ),
  );
  const assetConstraints = await connection.pool.query(
    "select conname from pg_constraint where conrelid in ('user_assets'::regclass, 'user_asset_versions'::regclass)",
  );
  for (const name of [
    "user_assets_type",
    "user_assets_name",
    "user_assets_alias",
    "user_assets_latest_version",
    "user_asset_versions_number_check",
    "user_asset_versions_sprite",
    "user_asset_versions_sha256",
    "user_assets_owner_id_users_id_fk",
    "user_asset_versions_asset_id_user_assets_id_fk",
  ])
    assert.ok(
      assetConstraints.rows.some((row) => row.conname === name),
      name,
    );
  const assetTriggers = await connection.pool.query(
    "select tgname from pg_trigger where not tgisinternal and tgname='user_asset_versions_immutable'",
  );
  assert.equal(assetTriggers.rows.length, 1);
  const indexes = await connection.pool.query(
    "select indexname from pg_indexes where schemaname='public'",
  );
  for (const name of [
    "users_email_ci",
    "projects_owner_updated",
    "projects_gallery",
    "projects_short_code_unique",
    "registration_invitations_email",
  ])
    assert.ok(
      indexes.rows.some((row) => row.indexname === name),
      name,
    );

  // Verify the complete ordered chain also installs into a truly empty DB.
  const fresh = await disposablePostgres();
  try {
    await migrateDatabase(fresh.db);
    await migrateDatabase(fresh.db);
    const freshTables = await fresh.pool.query(
      "select tablename from pg_tables where schemaname='public'",
    );
    assert.equal(freshTables.rows.length, 16);
    assert.ok(freshTables.rows.some((row) => row.tablename === "user_assets"));
    assert.ok(
      freshTables.rows.some((row) => row.tablename === "user_asset_versions"),
    );
    const classTables = await fresh.pool.query(
      "select tablename from pg_tables where schemaname='public' and tablename in ('classes', 'class_memberships', 'assignments', 'assignment_submissions')",
    );
    assert.equal(classTables.rows.length, 0);
  } finally {
    await fresh.stop();
  }
  app = buildApp(connection.db);
  // Test routes exist ONLY inside this test, never shipped in the API.
  for (const { permission } of matrix)
    app.get(
      `/probe/${permission}`,
      { preHandler: requirePermission(connection.db, permission) },
      async () => ({ allowed: true }),
    );
  app.post(
    "/probe/input",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 30 } },
        },
      },
    },
    async () => ({ ok: true }),
  );
  app.get("/probe/failure", async () => {
    throw new Error("do-not-leak-password-token-sql");
  });
  await app.ready();
});

test(
  "0010 to 0011 widens sound types without changing pinned sprite versions and remains idempotent",
  { timeout: 150000 },
  async () => {
    const upgrade = await disposablePostgres();
    const folder = await mkdtemp(join(tmpdir(), "randusr-0010-upgrade-"));
    try {
      await mkdir(join(folder, "meta"));
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 11); // 0000..0010, no 0011
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries)
        await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
      await migrateDatabase(upgrade.db, folder);

      const insertedUser = await upgrade.pool.query<{ id: string }>(
        `insert into users (email, display_name, password_hash)
         values ('sound-upgrade@example.invalid', 'Before', 'test-only') returning id`,
      );
      const ownerId = insertedUser.rows[0].id;
      const insertedAsset = await upgrade.pool.query<{ id: string }>(
        `insert into user_assets (owner_id, type, name, alias)
         values ($1, 'sprite', 'Pinned sprite', '@pinned') returning id`,
        [ownerId],
      );
      const assetId = insertedAsset.rows[0].id;
      const pinnedSprite = {
        format: "randusr.indexed-sprite",
        version: 1,
        width: 1,
        height: 1,
        pixels: [1],
        palette: [0, 1],
        transparentIndex: null,
      };
      await upgrade.pool.query(
        `insert into user_asset_versions (asset_id, number, sprite, sha256)
         values ($1, 1, $2::jsonb, repeat('a', 64))`,
        [assetId, JSON.stringify(pinnedSprite)],
      );
      await migrateDatabase(upgrade.db); // 0010 -> 0011
      await migrateDatabase(upgrade.db); // idempotent rerun

      const kept = await upgrade.pool.query(
        `select a.type, a.name, a.alias, a.latest_version, v.number, v.sprite, v.sha256
         from user_assets a join user_asset_versions v on v.asset_id = a.id
         where a.id = $1`,
        [assetId],
      );
      assert.deepEqual(kept.rows[0], {
        type: "sprite",
        name: "Pinned sprite",
        alias: "@pinned",
        latest_version: 1,
        number: 1,
        sprite: pinnedSprite,
        sha256: "a".repeat(64),
      });
      for (const [index, type] of ["sfx", "instrument"].entries())
        await upgrade.pool.query(
          `insert into user_assets (owner_id, type, name, alias)
           values ($1, $2, $3, $4)`,
          [ownerId, type, `Sound ${type}`, `@sound-${index}`],
        );
      await assert.rejects(
        upgrade.pool.query(
          `insert into user_assets (owner_id, type, name, alias)
           values ($1, 'unknown', 'Bad', '@bad')`,
          [ownerId],
        ),
      );
      // The legacy sprite API remains representable after application rollback: its columns,
      // defaults and sprite rows are unchanged, and the widened check still accepts 'sprite'.
      assert.equal((await upgrade.pool.query("select count(*)::int as n from user_assets where type = 'sprite'")).rows[0].n, 1);
    } finally {
      await upgrade.stop();
      await rm(folder, { recursive: true, force: true });
    }
  },
);

test(
  "a custom-format PostgreSQL restore keeps 0011 sound recipes and project data readable",
  { timeout: 150000 },
  async () => {
    const source = await disposablePostgres();
    const restored = await disposablePostgres();
    const folder = await mkdtemp(join(tmpdir(), "randusr-sound-restore-"));
    try {
      await migrateDatabase(source.db);
      const owner = await source.pool.query<{ id: string }>(
        `insert into users (email, display_name, password_hash)
         values ('sound-restore@example.invalid', 'Restore', 'test-only') returning id`,
      );
      const ownerId = owner.rows[0].id;
      const recipe = {
        format: "randusr.sfx",
        version: 1,
        waveform: "pulse",
        pulseWidth: 0.33,
        noiseAmount: 0.2,
        volume: 0.7,
        envelope: { attackMs: 5, decayMs: 20, sustainLevel: 0.4, releaseMs: 40 },
        startFrequencyHz: 1550,
        endFrequencyHz: 95,
        durationMs: 300,
      };
      const project = await source.pool.query<{ id: string }>(
        `insert into projects (owner_id, title, snapshot_version, snapshot, mode, short_code)
         values ($1, 'Pinned sound', 2, $2::jsonb, 'sandbox', 'restore-sound') returning id`,
        [ownerId, JSON.stringify({
          version: 2,
          sourceCode: 'SOUND "@restore_laser"',
          assetManifest: { version: 1, sprites: [], sounds: [{
            type: "sfx", alias: "@restore_laser", name: "Restore laser", recipe,
          }] },
        })],
      );
      const sound = await source.pool.query<{ id: string }>(
        `insert into user_assets (owner_id, type, name, alias)
         values ($1, 'sfx', 'Restore laser', '@restore_laser') returning id`,
        [ownerId],
      );
      await source.pool.query(
        `insert into user_asset_versions (asset_id, number, sprite, sha256)
         values ($1, 1, $2::jsonb, repeat('b', 64))`,
        [sound.rows[0].id, JSON.stringify(recipe)],
      );

      const backup = await new Promise<Buffer>((resolve, reject) => {
        const process = spawn("docker", [
          "exec", source.containerName, "pg_dump", "-Fc", "-U", "postgres", "-d", "randusr_test",
        ]);
        const chunks: Buffer[] = [];
        process.stdout.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        process.on("error", reject);
        process.on("close", (code) => {
          if (code === 0) resolve(Buffer.concat(chunks));
          else reject(new Error("Disposable PostgreSQL backup command failed"));
        });
      });
      assert.ok(backup.byteLength > 0);
      const backupPath = join(folder, "sound-assets.dump");
      await writeFile(backupPath, backup);
      await execFileAsync("docker", ["cp", backupPath, `${restored.containerName}:/tmp/sound-assets.dump`]);
      await execFileAsync("docker", [
        "exec", restored.containerName, "pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
        "-U", "postgres", "-d", "randusr_test", "/tmp/sound-assets.dump",
      ], { timeout: 120_000 });

      const restoredSound = await restored.pool.query<{ recipe: unknown }>(
        `select v.sprite as recipe from user_assets a
         join user_asset_versions v on v.asset_id = a.id
         where a.type = 'sfx' and a.alias = '@restore_laser'`,
      );
      assert.deepEqual(restoredSound.rows[0]?.recipe, recipe);
      const restoredProject = await restored.pool.query<{ snapshot: { assetManifest: { sounds: unknown[] } }; title: string }>(
        `select title, snapshot from projects where short_code = 'restore-sound'`,
      );
      assert.equal(restoredProject.rows[0]?.title, "Pinned sound");
      assert.deepEqual(
        restoredProject.rows[0]?.snapshot.assetManifest.sounds[0],
        { type: "sfx", alias: "@restore_laser", name: "Restore laser", recipe },
      );
    } finally {
      await source.stop();
      await restored.stop();
      await rm(folder, { recursive: true, force: true });
    }
  },
);

test("API permission denials derive from the documented guest/registered/admin matrix", async () => {
  for (const [i, [role, p]] of Object.entries(roles).entries()) {
    let cookie: string | undefined;
    if (p) {
      const [user] = await connection.db
        .insert(schema.users)
        .values({
          email: `${role.toLowerCase()}@example.invalid`,
          displayName: role,
          passwordHash: "test-only",
          isAdmin: p.isAdmin,
          verifiedAt: new Date(),
        })
        .returning();
      const token = randomBytes(32).toString("base64url");
      await connection.db.insert(schema.sessions).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60000),
      });
      cookie = `${sessionCookie}=${token}`;
      const session = (
        await app.inject({ url: "/api/v1/session", headers: { cookie } })
      ).json();
      assert.equal(session.principal.id, user.id);
      assert.equal(JSON.stringify(session).includes("@"), false); // email never returned
    }
    for (const row of matrix) {
      const result = await app.inject({
        url: `/probe/${row.permission}`,
        headers: cookie ? { cookie } : {},
      });
      assert.equal(
        result.statusCode,
        expected(row.cells[i], p) ? 200 : p ? 403 : 401,
        `${role}: ${row.permission}`,
      );
      if (result.statusCode !== 200) assert.ok(result.json().error.requestId);
    }
  }
});

test("forged identity headers, unknown/expired/revoked sessions and suspended accounts fail closed", async () => {
  const headers = {
    "x-user-id": "admin",
    "x-role": "admin",
    authorization: "Bearer admin",
  };
  assert.equal(
    (await app.inject({ url: "/probe/administer", headers })).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: "/api/v1/session", headers })).json().principal,
    null,
  );
  const [user] = await connection.db
    .insert(schema.users)
    .values({
      email: "unverified@example.invalid",
      displayName: "Unverified",
      passwordHash: "test-only",
    })
    .returning();
  const token = randomBytes(32).toString("base64url");
  const cookie = `${sessionCookie}=${token}`;
  await connection.db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60000),
  });
  assert.equal(
    (
      await app.inject({ url: "/probe/cloudProjects", headers: { cookie } })
    ).json().error.code,
    "EMAIL_UNVERIFIED",
  );
  assert.equal(
    (await app.inject({ url: "/probe/accountSettings", headers: { cookie } }))
      .statusCode,
    200,
  );
  await connection.db
    .update(schema.users)
    .set({ state: "suspended" })
    .where(eq(schema.users.id, user.id));
  assert.equal(
    (await app.inject({ url: "/api/v1/session", headers: { cookie } })).json()
      .principal,
    null,
  );
  await connection.db
    .update(schema.users)
    .set({ state: "active" })
    .where(eq(schema.users.id, user.id));
  await connection.db
    .update(schema.sessions)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.sessions.userId, user.id));
  assert.equal(
    (await app.inject({ url: "/api/v1/session", headers: { cookie } })).json()
      .principal,
    null,
  );
  await connection.db
    .update(schema.sessions)
    .set({ expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() })
    .where(eq(schema.sessions.userId, user.id));
  assert.equal(
    (await app.inject({ url: "/api/v1/session", headers: { cookie } })).json()
      .principal,
    null,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/session",
        headers: {
          cookie: `${sessionCookie}=${randomBytes(32).toString("base64url")}`,
        },
      })
    ).json().principal,
    null,
  );
});

test("seed is idempotent and never changes administrator privileges", async () => {
  const email = "bootstrap@example.invalid";
  const [user] = await connection.db
    .insert(schema.users)
    .values({ email, displayName: "Bootstrap", passwordHash: "test-only" })
    .returning();
  await seedDatabase(connection.db);
  assert.equal(
    (
      await connection.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
    )[0].isAdmin,
    false,
  );
  await connection.db
    .update(schema.users)
    .set({ verifiedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await seedDatabase(connection.db);
  assert.equal(
    (
      await connection.db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, user.id))
    ).length,
    0,
  );
  await connection.db
    .update(schema.users)
    .set({ isAdmin: true })
    .where(eq(schema.users.id, user.id));
  await seedDatabase(connection.db);
  assert.equal(
    (
      await connection.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
    )[0].isAdmin,
    true,
  ); // Existing administrator privileges survive an upgrade.
  assert.equal((await connection.db.select().from(schema.tags)).length, 4);
  // Seed never writes an admin audit record; unrelated audit failures still roll back.
  await assert.rejects(
    connection.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ displayName: "Must roll back" })
        .where(eq(schema.users.id, user.id));
      await tx.insert(schema.auditLog).values({
        action: "x".repeat(65),
        targetType: "user",
        targetId: user.id,
      });
    }),
  );
  assert.equal(
    (
      await connection.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
    )[0].displayName,
    "Bootstrap",
  );
});

test("schema enforces unique normalized email, private defaults and same-project publication", async () => {
  const [user] = await connection.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, existingEmail));
  await assert.rejects(
    connection.db.insert(schema.users).values({
      email: existingEmail.toUpperCase(),
      displayName: "Duplicate",
      passwordHash: "test-only",
    }),
  );
  const snapshot = {
    format: "randusr",
    version: 2,
    sourceCode: 'TEXT 10,20,"Привет、日本語"',
  };
  const [project] = await connection.db
    .insert(schema.projects)
    .values({
      ownerId: user.id,
      mode: "sandbox",
      snapshot,
      shortCode: "random-test-one",
    })
    .returning();
  assert.equal(project.visibility, "private");
  assert.deepEqual(project.snapshot, snapshot);
  const [other] = await connection.db
    .insert(schema.projects)
    .values({
      ownerId: user.id,
      mode: "sandbox",
      snapshot,
      shortCode: "random-test-two",
    })
    .returning();
  const [revision] = await connection.db
    .insert(schema.projectRevisions)
    .values({
      projectId: project.id,
      actorId: user.id,
      snapshot,
      number: 1,
      reason: "publish",
    })
    .returning();
  await assert.rejects(
    connection.db
      .update(schema.projects)
      .set({ visibility: "public" })
      .where(eq(schema.projects.id, project.id)),
  );
  await assert.rejects(
    connection.db
      .update(schema.projects)
      .set({
        visibility: "public",
        publishedRevisionId: revision.id,
        publishedAt: new Date(),
      })
      .where(eq(schema.projects.id, other.id)),
  );
  await connection.db
    .update(schema.projects)
    .set({
      visibility: "public",
      publishedRevisionId: revision.id,
      publishedAt: new Date(),
    })
    .where(eq(schema.projects.id, project.id));
  assert.equal(
    (
      await connection.db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, project.id))
    )[0].publishedRevisionId,
    revision.id,
  );
});

test("health, readiness, validation and errors use bounded code envelopes without leaking internals", async () => {
  assert.equal((await app.inject("/api/v1/health")).statusCode, 200);
  assert.equal((await app.inject("/api/v1/ready")).statusCode, 200);
  const bad = await app.inject({
    method: "POST",
    url: "/probe/input",
    payload: { name: "Hi", isAdmin: true },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, "INVALID_INPUT");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/probe/input",
        payload: { name: "Hi" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/probe/input",
        payload: { name: "x".repeat(600000) },
      })
    ).json().error.code,
    "PAYLOAD_TOO_LARGE",
  );
  const error = await app.inject("/probe/failure");
  assert.equal(error.statusCode, 500);
  assert.equal(error.json().error.code, "INTERNAL_ERROR");
  assert.equal(error.body.includes("do-not-leak"), false);
  assert.equal((await app.inject("/unknown")).json().error.code, "NOT_FOUND");
  assert.equal(error.headers["cache-control"], "no-store");
  // A DB/schema outage must fail readiness while liveness remains independent.
  await connection.db.execute(
    sql`alter table users rename to users_unavailable`,
  );
  try {
    assert.equal((await app.inject("/api/v1/ready")).statusCode, 503);
    assert.equal((await app.inject("/api/v1/health")).statusCode, 200);
  } finally {
    await connection.db.execute(
      sql`alter table users_unavailable rename to users`,
    );
  }
});
