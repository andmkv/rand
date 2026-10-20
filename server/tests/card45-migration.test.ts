import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disposablePostgres } from "./database.js";
import { migrateDatabase, migrationsFolder } from "../db/migrate.js";

test(
  "card 45 migration preserves authored submission source and removes the classroom schema",
  { timeout: 150000 },
  async () => {
    const pg = await disposablePostgres();
    const temporary = await mkdtemp(join(tmpdir(), "randusr-card45-"));
    const q = (text: string, values?: unknown[]) =>
      pg.pool.query(text, values as never[]);
    try {
      await mkdir(join(temporary, "meta"));
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      );
      const throughPreviews = journal.entries.slice(0, 9); // 0000–0008
      await writeFile(
        join(temporary, "meta/_journal.json"),
        JSON.stringify({ ...journal, entries: throughPreviews }),
      );
      for (const entry of throughPreviews)
        await copyFile(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(temporary, `${entry.tag}.sql`),
        );
      await migrateDatabase(pg.db, temporary);

      const [student] = (
        await q(
          `insert into users (email,display_name,password_hash,can_learn,can_teach,verified_at,is_admin)
           values ('student@example.invalid','Legacy student','test-only',true,false,now(),true)
           returning id`,
        )
      ).rows;
      const [teacher] = (
        await q(
          `insert into users (email,display_name,password_hash,can_learn,can_teach,verified_at)
           values ('teacher@example.invalid','Legacy teacher','test-only',false,true,now())
           returning id`,
        )
      ).rows;
      const [existing] = (
        await q(
          `insert into projects (owner_id,title,snapshot,mode,short_code)
           values ($1,'Existing project','{"sourceCode":"EXISTING"}'::jsonb,'sandbox','existing-code')
           returning id`,
          [student.id],
        )
      ).rows;
      const [revision] = (
        await q(
          `insert into project_revisions (project_id,actor_id,number,snapshot,reason)
           values ($1,$2,1,'{"sourceCode":"STUDENT UNIQUE SOURCE"}'::jsonb,'submission')
           returning id`,
          [existing.id, student.id],
        )
      ).rows;
      const [classroom] = (
        await q(
          `insert into classes (teacher_id,name) values ($1,'Legacy class') returning id`,
          [teacher.id],
        )
      ).rows;
      await q(
        `insert into class_memberships (class_id,student_id) values ($1,$2)`,
        [classroom.id, student.id],
      );
      const [assignment] = (
        await q(
          `insert into assignments (class_id,title,state) values ($1,'Legacy task','published') returning id`,
          [classroom.id],
        )
      ).rows;
      await q(
        `insert into assignment_submissions (class_id,assignment_id,student_id,revision_id,attempt)
         values ($1,$2,$3,$4,1)`,
        [classroom.id, assignment.id, student.id, revision.id],
      );

      await migrateDatabase(pg.db);

      const projects = await q(
        `select title,snapshot,visibility from projects where owner_id=$1 order by title`,
        [student.id],
      );
      assert.equal(projects.rows.length, 2);
      const migrated = projects.rows.find((row) =>
        String(row.title).startsWith("Legacy submission"),
      );
      assert.ok(migrated, "submission source must become a private project");
      assert.equal(migrated.snapshot.sourceCode, "STUDENT UNIQUE SOURCE");
      assert.equal(migrated.visibility, "private");

      const tables = await q(
        `select tablename from pg_tables where schemaname='public'`,
      );
      for (const name of [
        "classes",
        "class_memberships",
        "assignments",
        "assignment_workspaces",
        "assignment_submissions",
      ])
        assert.ok(
          !tables.rows.some((row) => row.tablename === name),
          `${name} must be removed`,
        );
      const columns = await q(
        `select column_name from information_schema.columns where table_name='users'`,
      );
      assert.ok(!columns.rows.some((row) => row.column_name === "can_learn"));
      assert.ok(!columns.rows.some((row) => row.column_name === "can_teach"));

      const [account] = (
        await q(
          `select state,verified_at,is_admin from users where id=$1`,
          [student.id],
        )
      ).rows;
      assert.equal(account.state, "active");
      assert.ok(account.verified_at);
      assert.equal(account.is_admin, true);
    } finally {
      await pg.stop();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
