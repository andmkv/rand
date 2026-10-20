import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { authConfig } from "../auth-config.js";
import { createInvitation } from "../invitations.js";
import {
  registrationInvitations,
  users,
  emailVerificationTokens,
} from "../db/schema.js";
import { hashToken } from "../access.js";
import { Mailer, MemoryMail } from "../mail.js";
import { closedTestNoticeVersion } from "../../shared/registration.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  cookie: string,
  sequence = 0;
const sink = new MemoryMail(),
  password = "Closed test password 12345";
async function request(
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    remoteAddress: `192.10.1.${++sequence}`,
    headers: { origin: "http://localhost:5173", "x-csrf-token": csrf, cookie },
  });
}
const body = (email: string, token?: string) => ({
  email,
  password,
  displayName: "Adult tester",
  locale: "en",
  ...(token
    ? { inviteToken: token, testNoticeVersion: closedTestNoticeVersion }
    : {}),
});
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    app = buildApp(pg.db, false, {
      baseUrl: "http://localhost:5173",
      secureCookies: false,
      adminEmail: "invited-admin@example.invalid",
      sessionDays: 14,
      mailer: new Mailer(sink, "http://localhost:5173"),
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
test("public registration defaults closed, is enforced without UI and cannot be enabled without policy/contact configuration", async () => {
  assert.equal(authConfig({}).publicRegistrationEnabled, false);
  assert.throws(() => authConfig({ PUBLIC_REGISTRATION_ENABLED: "1" }));
  assert.throws(() => authConfig({ PUBLIC_REGISTRATION_ENABLED: "true" }));
  assert.equal(
    authConfig({
      PUBLIC_REGISTRATION_ENABLED: "true",
      TERMS_VERSION: "v1",
      TERMS_URL: "https://example.invalid/terms",
      PRIVACY_VERSION: "v1",
      PRIVACY_URL: "https://example.invalid/privacy",
      SUPPORT_EMAIL: "help@example.invalid",
    }).publicRegistrationEnabled,
    true,
  );
  const r = await request(
    "POST",
    "/auth/register",
    body("stranger@example.invalid"),
  );
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().error.code, "REGISTRATION_CLOSED");
  assert.equal(sink.outbox.length, 0);
  const policy = await request("GET", "/auth/policy");
  assert.equal(policy.json().publicRegistrationEnabled, false);
  assert.equal(policy.json().closedTestNoticeVersion, closedTestNoticeVersion);
  assert.equal(policy.body.includes("invited-admin@"), false);
});
test("one-use email-bound invitation requires factual notice acknowledgement and still requires real email verification", async () => {
  const email = "invited-admin@example.invalid",
    invite = await createInvitation(pg.db, email);
  let r = await request("POST", "/auth/register", {
    ...body(email, invite.token),
    testNoticeVersion: "old-notice",
  });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error.code, "POLICY_REQUIRED");
  r = await request(
    "POST",
    "/auth/register",
    body("someone-else@example.invalid", invite.token),
  );
  assert.equal(r.statusCode, 403);
  r = await request("POST", "/auth/register", body(email, invite.token));
  assert.equal(r.statusCode, 200, r.body);
  const session = r.cookies.find((c) => c.name === "randusr_session")!;
  const authCookie = cookie + `; ${session.name}=${session.value}`;
  const [u] = await pg.db.select().from(users).where(eq(users.email, email));
  assert.equal(u.verifiedAt, null);
  assert.equal(u.isAdmin, false);
  assert.equal(u.testNoticeVersion, closedTestNoticeVersion);
  assert.ok(u.testNoticeAcknowledgedAt);
  assert.equal(u.termsVersion, null);
  assert.equal(u.privacyVersion, null);
  assert.equal(u.acceptedAt, null);
  const denied = await app.inject({
    url: "/api/v1/projects",
    headers: { cookie: authCookie },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(
    (await request("POST", "/auth/register", body(email, invite.token)))
      .statusCode,
    403,
  );
  const mail = sink.outbox.find((m) => m.to === email)!;
  const raw = new URL(mail.text.match(/https?:\/\/[^\s]+/)![0]);
  const verifyToken = new URLSearchParams(raw.hash.slice(1)).get("token")!;
  assert.equal(
    (await request("POST", "/auth/verify", { token: verifyToken })).statusCode,
    200,
  );
  const [verified] = await pg.db.select().from(users).where(eq(users.id, u.id));
  assert.ok(verified.verifiedAt);
  assert.equal(verified.isAdmin, true);
  const exported = await app.inject({
    url: "/api/v1/account/export",
    headers: { cookie: authCookie },
  });
  assert.equal(exported.statusCode, 200);
  assert.ok(exported.body.includes(closedTestNoticeVersion));
  assert.equal(exported.body.includes(invite.token), false);
  const deleted = await app.inject({
    method: "POST",
    url: "/api/v1/account/delete",
    payload: { confirmEmail: email, currentPassword: password },
    headers: {
      origin: "http://localhost:5173",
      cookie: authCookie,
      "x-csrf-token": csrf,
    },
  });
  assert.equal(deleted.json().error.code, "LAST_ADMIN");
  const row = (
    await pg.db
      .select()
      .from(registrationInvitations)
      .where(eq(registrationInvitations.email, email))
  )[0];
  assert.equal(row.tokenHash, hashToken(invite.token));
  assert.ok(row.usedAt);
});
test("expired, revoked and forged invitations fail, while concurrent registration consumes exactly once", async () => {
  const email = "concurrent@example.invalid",
    old = await createInvitation(pg.db, email),
    current = await createInvitation(pg.db, email);
  assert.equal(
    (await request("POST", "/auth/register", body(email, old.token)))
      .statusCode,
    403,
  );
  const expired = await createInvitation(pg.db, "expired@example.invalid");
  await pg.db
    .update(registrationInvitations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(registrationInvitations.tokenHash, hashToken(expired.token)));
  assert.equal(
    (
      await request(
        "POST",
        "/auth/register",
        body("expired@example.invalid", expired.token),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/register",
        body("forged@example.invalid", randomBytes(32).toString("base64url")),
      )
    ).statusCode,
    403,
  );
  const results = await Promise.all([
    request("POST", "/auth/register", body(email, current.token)),
    request("POST", "/auth/register", body(email, current.token)),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 403]);
});
test("deletion erases invitation identity/notice and invited accounts retain login/reset/account management", async () => {
  const email = "lifecycle-invite@example.invalid",
    invite = await createInvitation(pg.db, email);
  const registered = await request(
    "POST",
    "/auth/register",
    body(email, invite.token),
  );
  assert.equal(registered.statusCode, 200);
  assert.equal(
    (await request("POST", "/auth/forgot", { email })).statusCode,
    200,
  );
  const logged = await request("POST", "/auth/login", { email, password });
  assert.equal(logged.statusCode, 200);
  const session = logged.cookies.find((c) => c.name === "randusr_session")!;
  const deletion = await app.inject({
    method: "POST",
    url: "/api/v1/account/delete",
    payload: { confirmEmail: email, currentPassword: password },
    headers: {
      origin: "http://localhost:5173",
      cookie: cookie + `; ${session.name}=${session.value}`,
      "x-csrf-token": csrf,
    },
  });
  assert.equal(deletion.statusCode, 200, deletion.body);
  assert.equal(
    (
      await pg.db
        .select()
        .from(registrationInvitations)
        .where(eq(registrationInvitations.email, email))
    ).length,
    0,
  );
  const [u] = await pg.db.select().from(users).where(eq(users.email, email));
  assert.equal(u, undefined);
  assert.equal(
    (await request("POST", "/auth/login", { email, password })).statusCode,
    401,
  );
});

test("operator CLI writes an exclusive private invitation file and never prints its token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "randusr-invite-cli-"));
  try {
    const out = join(dir, "tester.invite.json"),
      run = promisify(execFile),
      env = {
        ...process.env,
        DATABASE_URL: pg.pool.options.connectionString,
        APP_BASE_URL: "http://localhost:5173",
      };
    const result = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "server/invite-cli.ts",
        "--email",
        "cli@example.invalid",
        "--out",
        out,
        "--adult-tester",
      ],
      { env },
    );
    const data = JSON.parse(await readFile(out, "utf8"));
    assert.equal(data.email, "cli@example.invalid");
    assert.equal((await stat(out)).mode & 0o077, 0);
    const token = new URLSearchParams(new URL(data.url).hash.slice(1)).get(
      "token",
    )!;
    assert.equal(token.length, 43);
    assert.equal(result.stdout.includes(token), false);
    assert.equal(result.stderr.includes(token), false);
    await assert.rejects(
      run(
        process.execPath,
        [
          "--import",
          "tsx",
          "server/invite-cli.ts",
          "--email",
          "cli@example.invalid",
          "--out",
          out,
          "--adult-tester",
        ],
        { env },
      ),
    );
    assert.equal(JSON.parse(await readFile(out, "utf8")).url, data.url);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
