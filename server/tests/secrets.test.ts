import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretValue } from "../secrets.js";
import { readConfig } from "../config.js";
import { authConfig } from "../auth-config.js";
test("mounted DB/SMTP secrets are usable without environment credentials and reject conflicts/invalid files safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "randusr-secret-test-"));
  try {
    const db = join(dir, "db"),
      smtp = join(dir, "smtp"),
      empty = join(dir, "empty"),
      large = join(dir, "large");
    const dbUrl = "postgresql://fixture:PRIVATE_FILE_SECRET@db:5432/randusr";
    await writeFile(db, dbUrl + "\n", { mode: 0o600 });
    await writeFile(
      smtp,
      "smtp://fixture:PRIVATE_FILE_SECRET@mail.example.invalid:587\n",
      { mode: 0o600 },
    );
    await writeFile(empty, "\n");
    await writeFile(large, "x".repeat(8193));
    assert.equal(readConfig({ DATABASE_URL_FILE: db }).databaseUrl, dbUrl);
    assert.equal(
      authConfig({
        NODE_ENV: "production",
        APP_BASE_URL: "https://instance.example.invalid",
        ADMIN_BOOTSTRAP_EMAIL: "owner@example.org",
        SMTP_FROM_EMAIL: "noreply@example.org",
        MAIL_MODE: "smtp",
        SMTP_URL_FILE: smtp,
      }).secureCookies,
      true,
    );
    for (const env of [
      { DATABASE_URL: dbUrl, DATABASE_URL_FILE: db },
      { DATABASE_URL_FILE: empty },
      { DATABASE_URL_FILE: large },
      { DATABASE_URL_FILE: dir },
      { DATABASE_URL_FILE: join(dir, "not-found") },
    ])
      assert.throws(
        () => secretValue(env, "DATABASE_URL"),
        (e) => e instanceof Error && !e.message.includes("PRIVATE_FILE_SECRET"),
      );
    assert.throws(
      () =>
        authConfig({
          MAIL_MODE: "smtp",
          MAIL_ALLOW_REAL_SEND: "1",
          SMTP_URL: "smtp://one:PRIVATE_FILE_SECRET@mail.example.invalid",
          SMTP_URL_FILE: smtp,
        }),
      (e) => e instanceof Error && !e.message.includes("PRIVATE_FILE_SECRET"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
