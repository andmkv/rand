import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { hashPassword } from "../auth.js";
import { hashToken, sessionCookie } from "../access.js";
import { users, sessions, projects } from "../db/schema.js";
import { Mailer, MemoryMail } from "../mail.js";
import { authConfig } from "../auth-config.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  cookie: string,
  scenario = 0;
const ids: Record<string, string> = {},
  tokens: Record<string, string> = {},
  password = "Private lifecycle testing password";
const snapshot = {
  format: "randusr",
  version: 2,
  title: "Export Moon",
  sourceCode: 'PRINT "PRIVATE EXPORT"',
  mode: "sandbox",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  storyId: "tower",
  sceneId: 0,
  unlocked: 0,
  exampleId: null,
};
async function request(
  role: string,
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    remoteAddress: `192.7.${scenario}.${["teacher", "student", "other", "unverified", "admin"].indexOf(role) + 2}`,
    headers: {
      origin: "http://localhost:5173",
      "x-csrf-token": csrf,
      cookie: `${cookie}; ${sessionCookie}=${tokens[role] ?? ""}`,
    },
  });
}
async function records(role: string) {
  const r = await request(role, "GET", "/account/export");
  assert.equal(r.statusCode, 200, r.body);
  assert.match(String(r.headers["content-type"]), /application\/x-ndjson/);
  assert.match(String(r.headers["content-disposition"]), /attachment/);
  assert.equal(r.headers["cache-control"], "no-store");
  const lines = r.body
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.equal(lines.at(-1).recordType, "complete");
  assert.equal(r.body.includes("passwordHash"), false);
  assert.equal(r.body.includes("token_hash"), false);
  assert.equal(r.body.includes("join_code_hash"), false);
  return lines;
}
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    const hash = await hashPassword(password);
    for (const role of ["teacher", "student", "other", "unverified", "admin"]) {
      const [u] = await pg.db
        .insert(users)
        .values({
          email: `privacy-${role}@example.invalid`,
          displayName: `Private ${role}`,
          passwordHash: hash,
          verifiedAt: role === "unverified" ? null : new Date(),
          canLearn: true,
          canTeach: role === "teacher",
          isAdmin: role === "admin",
        })
        .returning();
      ids[role] = u.id;
      tokens[role] = randomBytes(32).toString("base64url");
      await pg.db.insert(sessions).values({
        userId: u.id,
        tokenHash: hashToken(tokens[role]),
        expiresAt: new Date(Date.now() + 600000),
      });
    }
    app = buildApp(pg.db, false, {
      baseUrl: "http://localhost:5173",
      secureCookies: false,
      adminEmail: "bootstrap@example.invalid",
      sessionDays: 14,
      publicRegistrationEnabled: true,
      mailer: new Mailer(new MemoryMail(), "http://localhost:5173"),
      termsVersion: "terms-test-v1",
      privacyVersion: "privacy-test-v1",
      termsUrl: "https://example.invalid/terms-v1",
      privacyUrl: "https://example.invalid/privacy-v1",
      supportEmail: "support@example.invalid",
    });
    const r = await app.inject("/api/v1/auth/csrf");
    csrf = r.json().token;
    cookie = `${r.cookies[0].name}=${r.cookies[0].value}`;
  },
  { timeout: 150000 },
);
after(async () => {
  await app?.close();
  await pg?.stop();
});
test("policy configuration fails closed on unmatched versions/unsafe URLs and registration records actual configured versions", async () => {
  scenario++;
  for (const env of [
    { TERMS_VERSION: "v1" },
    { PRIVACY_URL: "https://example.invalid/privacy" },
    { TERMS_VERSION: "v1", TERMS_URL: "javascript:alert(1)" },
    { TERMS_VERSION: "v1", TERMS_URL: "https://secret@example.invalid/terms" },
    { SUPPORT_EMAIL: "bad\nemail@example.invalid" },
  ])
    assert.throws(() => authConfig(env));
  const valid = authConfig({
    TERMS_VERSION: "v1",
    TERMS_URL: "https://example.invalid/terms",
    SUPPORT_EMAIL: "help@example.invalid",
  });
  assert.equal(valid.termsVersion, "v1");
  const policy = await request("guest", "GET", "/auth/policy");
  assert.equal(policy.json().supportEmail, "support@example.invalid");
  assert.equal(policy.body.includes("suitedm"), false);
  const body = {
    email: "policy-signup@example.invalid",
    password,
    displayName: "Policy tester",
    locale: "en",
  };
  assert.equal(
    (await request("guest", "POST", "/auth/register", body)).json().error.code,
    "POLICY_REQUIRED",
  );
  assert.equal(
    (
      await request("guest", "POST", "/auth/register", {
        ...body,
        termsVersion: "outdated",
        privacyVersion: "privacy-test-v1",
      })
    ).json().error.code,
    "POLICY_REQUIRED",
  );
  const r = await request("guest", "POST", "/auth/register", {
    ...body,
    termsVersion: "terms-test-v1",
    privacyVersion: "privacy-test-v1",
  });
  assert.equal(r.statusCode, 200, r.body);
  const [u] = await pg.db
    .select()
    .from(users)
    .where(eq(users.email, body.email));
  assert.equal(u.termsVersion, "terms-test-v1");
  assert.equal(u.privacyVersion, "privacy-test-v1");
  assert.ok(u.acceptedAt);
});
test("streamed export includes own projects and excludes other owners; deletion removes access", async () => {
  scenario++;
  const mine = await pg.db
    .insert(projects)
    .values(
      Array.from({ length: 105 }, (_, i) => ({
        ownerId: ids.student,
        title: `Export page ${i}`,
        snapshot,
        mode: "sandbox" as const,
        shortCode: `export-${scenario}-${i}`,
      })),
    )
    .returning();
  const [foreign] = await pg.db
    .insert(projects)
    .values({
      ownerId: ids.other,
      title: "Other private project",
      snapshot,
      mode: "sandbox" as const,
      shortCode: `export-${scenario}-foreign`,
    })
    .returning();
  const student = await records("student");
  const projectsOut = student.filter((r) => r.recordType === "project");
  assert.equal(projectsOut.length, 105);
  assert.ok(projectsOut.some((r) => r.data.id === mine[0].id));
  assert.equal(projectsOut.some((r) => r.data.id === foreign.id), false);
  assert.equal(JSON.stringify(student).includes("passwordHash"), false);
  assert.equal(JSON.stringify(student).includes("token_hash"), false);

  const removed = await request("student", "POST", "/account/delete", {
    currentPassword: password,
    confirmEmail: "privacy-student@example.invalid",
  });
  assert.equal(removed.statusCode, 200, removed.body);
  const after = await request("student", "GET", "/account/export");
  assert.equal(after.statusCode, 401);
  const [row] = await pg.db
    .select()
    .from(users)
    .where(eq(users.id, ids.student));
  assert.equal(row.state, "deleted");
  assert.equal(row.displayName, "Deleted user");
});
