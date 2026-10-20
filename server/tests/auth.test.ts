import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { MemoryMail, Mailer } from "../mail.js";
import {
  users,
  sessions,
  emailVerificationTokens,
  passwordResetTokens,
  auditLog,
} from "../db/schema.js";
import { hashToken, sessionCookie, requirePermission } from "../access.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>;
const sink = new MemoryMail();
const origin = "http://localhost:5173";
let cookies: Record<string, string> = {},
  csrf: string;
const password = "A secret test password 123";
function remember(response: any) {
  for (const item of response.cookies ?? []) cookies[item.name] = item.value;
}
async function post(
  path: string,
  payload: unknown = {},
  remoteAddress = "127.0.0.1",
  method: "POST" | "PATCH" = "POST",
) {
  const response = await app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    remoteAddress,
    headers: {
      origin,
      "x-csrf-token": csrf,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });
  remember(response);
  return response;
}
function lastToken(kind: "verify" | "reset") {
  const mail = [...sink.outbox]
    .reverse()
    .find((m) =>
      m.text.includes(`/${kind === "verify" ? "verify" : "reset-password"}#`),
    )!;
  const url = mail.text.match(/https?:\/\/[^\s]+/)![0];
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
}
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    app = buildApp(pg.db, false, {
      baseUrl: origin,
      secureCookies: false,
      adminEmail: "admin@example.invalid",
      sessionDays: 14,
      publicRegistrationEnabled: true,
      mailer: new Mailer(sink, origin),
    });
    app.post(
      "/api/v1/protected",
      { preHandler: requirePermission(pg.db, "cloudProjects") },
      async () => ({ ok: true }),
    );
    await app.ready();
    const response = await app.inject("/api/v1/auth/csrf");
    remember(response);
    csrf = response.json().token;
  },
  { timeout: 150000 },
);
after(async () => {
  await app?.close();
  await pg?.stop();
});

test("register → verification → rotated login → logout, with hashed password/token and private identity", async () => {
  const registered = await post("/auth/register", {
    email: "ADMIN@example.invalid",
    password,
    displayName: "Pixel",
    locale: "ru",
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const cookie = registered.cookies.find((c) => c.name === sessionCookie)!;
  assert.ok(cookie.httpOnly);
  assert.equal(cookie.sameSite, "Lax");
  let [user] = await pg.db
    .select()
    .from(users)
    .where(eq(users.email, "admin@example.invalid"));
  assert.ok(user.passwordHash.startsWith("$argon2id$"));
  assert.equal(user.isAdmin, false);
  assert.equal(user.verifiedAt, null);
  assert.equal((await app.inject({ url: "/api/v1/auth/me", headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } })).json().canLearn, undefined);
  assert.equal(
    (await post("/protected")).json().error.code,
    "EMAIL_UNVERIFIED",
  );
  const value = lastToken("verify");
  const [stored] = await pg.db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, user.id));
  assert.equal(stored.tokenHash, hashToken(value));
  assert.ok(!JSON.stringify(stored).includes(value));
  assert.equal(sink.outbox[0].from, "no-reply@example.invalid");
  assert.ok(sink.outbox[0].subject.includes("Подтверди"));
  assert.ok(sink.outbox[0].html.includes("<a href="));
  assert.equal((await post("/auth/verify", { token: value })).statusCode, 200);
  assert.equal(
    (await post("/auth/verify", { token: value })).json().error.code,
    "INVALID_TOKEN",
  );
  [user] = await pg.db.select().from(users).where(eq(users.id, user.id));
  assert.equal(user.isAdmin, true);
  assert.equal((await post("/protected")).statusCode, 200);
  const old = cookies[sessionCookie];
  assert.equal(
    (await post("/auth/login", { email: user.email, password })).statusCode,
    200,
  );
  assert.notEqual(cookies[sessionCookie], old);
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/session",
        headers: { cookie: `${sessionCookie}=${old}` },
      })
    ).json().principal,
    null,
  );
  const me = await app.inject({
    url: "/api/v1/auth/me",
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });
  assert.equal(me.json().email, user.email);
  assert.equal(me.json().passwordHash, undefined);
  assert.equal((await post("/auth/logout")).statusCode, 200);
  assert.equal((await post("/protected")).statusCode, 401);
  const log = await pg.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "admin.bootstrap"));
  assert.equal(log.length, 1);
});

test("duplicate email, wrong credentials, CSRF and role escalation are rejected", async () => {
  assert.equal(
    (
      await post("/auth/register", {
        email: "admin@example.invalid",
        password,
        displayName: "Duplicate",
        locale: "en",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await post("/auth/login", {
        email: "admin@example.invalid",
        password: "wrong wrong wrong",
      })
    ).json().error.code,
    "INVALID_CREDENTIALS",
  );
  assert.equal(
    (
      await post("/auth/login", {
        email: "missing@example.invalid",
        password: "wrong wrong wrong",
      })
    ).json().error.code,
    "INVALID_CREDENTIALS",
  );
  const result = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "admin@example.invalid", password },
    headers: { origin: "https://attacker.invalid" },
  });
  assert.equal(result.json().error.code, "CSRF_FAILED");
  assert.equal(
    (
      await post("/auth/register", {
        email: "escalate@example.invalid",
        password,
        displayName: "Bad",
        locale: "en",
        isAdmin: true,
      })
    ).statusCode,
    400,
  );
});

test("reset request is generic; expired and used links fail; success revokes all sessions", async () => {
  assert.equal(
    (await post("/auth/login", { email: "admin@example.invalid", password }))
      .statusCode,
    200,
  );
  const old = cookies[sessionCookie];
  const known = await post("/auth/forgot", { email: "admin@example.invalid" });
  const unknown = await post("/auth/forgot", {
    email: "unknown@example.invalid",
  });
  assert.deepEqual(known.json(), unknown.json());
  const expired = lastToken("reset");
  await pg.db
    .update(passwordResetTokens)
    .set({ expiresAt: new Date(0) })
    .where(eq(passwordResetTokens.tokenHash, hashToken(expired)));
  assert.equal(
    (
      await post("/auth/reset", {
        token: expired,
        password: "An entirely new password",
      })
    ).json().error.code,
    "INVALID_TOKEN",
  );
  await post("/auth/forgot", { email: "admin@example.invalid" });
  const fresh = lastToken("reset");
  assert.equal(
    (
      await post("/auth/reset", {
        token: fresh,
        password: "An entirely new password",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await post("/auth/reset", {
        token: fresh,
        password: "Another new password",
      })
    ).json().error.code,
    "INVALID_TOKEN",
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/session",
        headers: { cookie: `${sessionCookie}=${old}` },
      })
    ).json().principal,
    null,
  );
  assert.equal(
    (await post("/auth/login", { email: "admin@example.invalid", password }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await post("/auth/login", {
        email: "admin@example.invalid",
        password: "An entirely new password",
      })
    ).statusCode,
    200,
  );
});

test("expired verification, resend invalidation, secure cookies and route throttling", async () => {
  const registered = await post(
    "/auth/register",
    {
      email: "student@example.invalid",
      password,
      displayName: "Student",
      locale: "ja",
    },
    "127.0.0.2",
  );
  assert.equal(registered.statusCode, 200);
  const first = lastToken("verify");
  await pg.db
    .update(emailVerificationTokens)
    .set({ expiresAt: new Date(0) })
    .where(eq(emailVerificationTokens.tokenHash, hashToken(first)));
  assert.equal(
    (await post("/auth/verify", { token: first })).json().error.code,
    "INVALID_TOKEN",
  );
  assert.equal((await post("/auth/resend")).statusCode, 200);
  const second = lastToken("verify");
  assert.notEqual(second, first);
  assert.equal((await post("/auth/resend")).statusCode, 200);
  assert.equal((await post("/auth/verify", { token: second })).statusCode, 400);
  assert.equal((await post("/auth/resend")).statusCode, 200);
  assert.equal((await post("/auth/resend")).statusCode, 429);
  const secure = buildApp(pg.db, false, {
    baseUrl: "https://instance.example.invalid",
    secureCookies: true,
    adminEmail: "admin@example.invalid",
    sessionDays: 14,
    publicRegistrationEnabled: true,
    mailer: new Mailer(sink, origin),
  });
  const response = await secure.inject("/api/v1/auth/csrf");
  assert.equal(response.cookies[0].secure, true);
  await secure.close();
});

test("profile changes persist locale, reject role/admin fields and password change revokes sessions", async () => {
  const updated = await post(
    "/account",
    { displayName: "New display", locale: "de" },
    "127.0.0.1",
    "PATCH",
  );
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().locale, "de");
  assert.equal(updated.json().canLearn, undefined);
  assert.equal(updated.json().canTeach, undefined);
  assert.equal(
    (await post("/account", { isAdmin: true }, "127.0.0.1", "PATCH"))
      .statusCode,
    400,
  );
  const [user] = await pg.db
    .select()
    .from(users)
    .where(eq(users.email, "student@example.invalid"));
  assert.equal(user.isAdmin, false);
  assert.equal(user.displayName, "New display");
  const current = cookies[sessionCookie];
  assert.equal(
    (
      await post("/account/password", {
        currentPassword: "wrong old password",
        password: "New very secret password",
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await post("/account/password", {
        currentPassword: password,
        password: "New very secret password",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/session",
        headers: { cookie: `${sessionCookie}=${current}` },
      })
    ).json().principal,
    null,
  );
  assert.equal(
    (
      await post("/auth/login", {
        email: user.email,
        password: "New very secret password",
      })
    ).statusCode,
    200,
  );
  assert.equal((await post("/account/sign-out-all")).statusCode, 200);
  assert.equal((await post("/protected")).statusCode, 401);
});
