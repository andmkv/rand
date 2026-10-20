import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { users, sessions, auditLog, registrationInvitations } from "../db/schema.js";
import { hashToken, sessionCookie } from "../access.js";
import { Mailer, MemoryMail } from "../mail.js";
import { closedTestNoticeVersion } from "../../shared/registration.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  csrfCookie: string,
  seq = 0,
  failMail = false;
const sink = new MemoryMail(),
  tokens: Record<string, string> = {},
  base = "http://localhost:5173";
const mailer = new Mailer(
  {
    send: async (mail) => {
      if (failMail) throw new Error("smtp down");
      await sink.send(mail);
    },
  },
  base,
);
async function call(
  role: string,
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
  csrfOk = true,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    remoteAddress: `10.9.0.${++seq}`,
    headers: {
      origin: base,
      ...(csrfOk ? { "x-csrf-token": csrf } : {}),
      cookie: `${csrfCookie}; ${sessionCookie}=${tokens[role] ?? ""}`,
    },
  });
}
function inviteToken(to: string) {
  const mail = [...sink.outbox].reverse().find((m) => m.to === to && m.text.includes("/invite#"))!;
  const url = mail.text.match(/https?:\/\/[^\s]+/)![0];
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
}
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    for (const [name, isAdmin] of [["admin", true], ["member", false]] as const) {
      const [u] = await pg.db
        .insert(users)
        .values({ email: `${name}@example.invalid`, displayName: name, passwordHash: "x", verifiedAt: new Date(), isAdmin })
        .returning();
      const token = randomBytes(32).toString("base64url");
      tokens[name] = token;
      await pg.db.insert(sessions).values({ userId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600000) });
    }
    app = buildApp(pg.db, false, {
      baseUrl: base,
      secureCookies: false,
      adminEmail: "owner@example.invalid",
      sessionDays: 14,
      mailer,
    });
    const r = await app.inject("/api/v1/auth/csrf");
    csrf = r.json().token;
    csrfCookie = `${r.cookies[0].name}=${r.cookies[0].value}`;
  },
  { timeout: 150000 },
);
after(async () => {
  await app?.close();
  await pg?.stop();
});
test("only verified administrators can use the invitation API; CSRF is required; no token is ever returned", async () => {
  for (const role of ["guest", "member"])
    for (const [method, path] of [
      ["GET", "/admin/invitations"],
      ["POST", "/admin/invitations"],
    ] as const) {
      const r = await call(role, method, path, method === "POST" ? { email: "a@example.invalid", adultTester: true } : undefined);
      assert.ok([401, 403].includes(r.statusCode), `${role} ${method} ${r.statusCode}`);
    }
  assert.equal((await call("admin", "POST", "/admin/invitations", { email: "x@example.invalid", adultTester: true }, false)).statusCode, 403);
  const r = await call("admin", "POST", "/admin/invitations", { email: "  Friend@Example.Invalid ", adultTester: true });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().email, "friend@example.invalid");
  const token = inviteToken("friend@example.invalid");
  assert.equal(r.body.includes(token), false);
  const listed = await call("admin", "GET", "/admin/invitations");
  assert.equal(listed.body.includes(token), false);
  assert.equal(listed.body.includes(hashToken(token)), false);
  assert.equal(listed.json().invitations[0].status, "active");
  assert.equal(listed.json().invitations[0].mechanism, "admin");
  assert.equal((await call("admin", "POST", "/admin/invitations", { email: "y@example.invalid", adultTester: false })).statusCode, 400);
  assert.equal((await call("admin", "POST", "/admin/invitations", { email: "not-an-email", adultTester: true })).statusCode, 400);
});
test("invitee registers while public signup stays closed; used invitation is listed; existing accounts are refused", async () => {
  const token = inviteToken("friend@example.invalid");
  const body = { email: "friend@example.invalid", password: "Closed test password 12345", displayName: "Friend", locale: "en" };
  assert.equal((await call("guest", "POST", "/auth/register", body)).statusCode, 403);
  const ok = await call("guest", "POST", "/auth/register", { ...body, inviteToken: token, testNoticeVersion: closedTestNoticeVersion });
  assert.equal(ok.statusCode, 200, ok.body);
  const used = (await call("admin", "GET", "/admin/invitations?status=used")).json();
  assert.equal(used.invitations[0].email, "friend@example.invalid");
  const again = await call("admin", "POST", "/admin/invitations", { email: "friend@example.invalid", adultTester: true });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, "ACCOUNT_EXISTS");
  assert.equal((await call("admin", "POST", `/admin/invitations/${used.invitations[0].id}/resend`, {})).statusCode, 404);
});
test("resend revokes the old link, revoke is immediate, failed mail is never reported as success, all audited", async () => {
  const first = (await call("admin", "POST", "/admin/invitations", { email: "two@example.invalid", adultTester: true })).json();
  const oldToken = inviteToken("two@example.invalid");
  const re = await call("admin", "POST", `/admin/invitations/${first.id}/resend`, { locale: "ru" });
  assert.equal(re.statusCode, 200, re.body);
  const newToken = inviteToken("two@example.invalid");
  assert.notEqual(oldToken, newToken);
  const body = { email: "two@example.invalid", password: "Closed test password 12345", displayName: "Two", locale: "en", testNoticeVersion: closedTestNoticeVersion };
  assert.equal((await call("guest", "POST", "/auth/register", { ...body, inviteToken: oldToken })).statusCode, 403);
  assert.equal((await call("admin", "GET", "/admin/invitations?status=revoked")).json().invitations.some((i: { id: string }) => i.id === first.id), true);
  assert.equal((await call("admin", "POST", `/admin/invitations/${re.json().id}/revoke`, {})).statusCode, 200);
  assert.equal((await call("guest", "POST", "/auth/register", { ...body, inviteToken: newToken })).statusCode, 403);
  assert.equal((await call("admin", "POST", `/admin/invitations/${re.json().id}/revoke`, {})).statusCode, 404);
  failMail = true;
  const failed = await call("admin", "POST", "/admin/invitations", { email: "three@example.invalid", adultTester: true });
  failMail = false;
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json().error.code, "MAIL_UNAVAILABLE");
  const [row] = await pg.db.select().from(registrationInvitations).where(eq(registrationInvitations.email, "three@example.invalid"));
  assert.ok(row.revokedAt, "an unsent invitation is withdrawn");
  const actions = (await pg.db.select().from(auditLog)).map((a) => a.action);
  for (const a of ["registration.invited", "registration.revoked"]) assert.ok(actions.includes(a), a);
  const invited = (await pg.db.select().from(auditLog)).filter((a) => a.action === "registration.invited");
  assert.ok(invited.every((a) => a.actorId), "admin invitations record the actor");
});
