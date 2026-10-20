import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { Mailer, MemoryMail } from "../mail.js";
import { hashToken } from "../access.js";
import { hashPassword } from "../auth.js";
import { auditLog, registrationInvitations, users } from "../db/schema.js";
import { closedTestNoticeVersion } from "../../shared/registration.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  cookie: string,
  sequence = 0;
const sink = new MemoryMail(),
  owner = "owner@example.invalid",
  origin = "http://localhost:5173";
async function bootstrap(includeCsrf = true) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap-invite",
    remoteAddress: `192.0.2.${++sequence}`,
    headers: includeCsrf
      ? { origin, "x-csrf-token": csrf, cookie }
      : { origin },
  });
}
async function register(email: string, token: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    remoteAddress: `192.0.2.${++sequence}`,
    headers: { origin, "x-csrf-token": csrf, cookie },
    payload: {
      email,
      password: "A very secret testing password",
      displayName: "Invited owner",
      locale: "en",
      inviteToken: token,
      testNoticeVersion: closedTestNoticeVersion,
    },
  });
}
const linkToken = (text: string) => {
  const link = text.match(/https?:\/\/[^\s]+/)![0];
  const url = new URL(link);
  assert.equal(url.pathname, "/invite");
  const token = new URLSearchParams(url.hash.slice(1)).get("token")!;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  return { token, link };
};
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    app = buildApp(pg.db, false, {
      baseUrl: origin,
      secureCookies: false,
      adminEmail: owner,
      sessionDays: 14,
      mailer: new Mailer(sink, origin),
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
test("first-admin email onboarding is CSRF-protected, one-time, resendable and stops after an admin exists", async () => {
  assert.equal((await bootstrap(false)).statusCode, 403);
  assert.equal(sink.outbox.length, 0);

  const first = await bootstrap();
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(sink.outbox.length, 1);
  const firstMail = sink.outbox[0];
  assert.equal(firstMail.to, owner);
  assert.match(firstMail.subject, /administrator invitation/i);
  assert.match(firstMail.html, /Create your account/);
  const firstToken = linkToken(firstMail.text).token;
  const firstRows = await pg.db.select().from(registrationInvitations);
  assert.equal(firstRows.length, 1);
  assert.equal(firstRows[0].tokenHash, hashToken(firstToken));
  assert.notEqual(firstRows[0].tokenHash, firstToken);
  assert.equal(firstRows[0].usedAt, null);
  assert.equal(firstRows[0].revokedAt, null);

  const second = await bootstrap();
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(sink.outbox.length, 2);
  const secondToken = linkToken(sink.outbox[1].text).token;
  assert.notEqual(secondToken, firstToken);
  const rows = await pg.db.select().from(registrationInvitations);
  assert.equal(rows.length, 2);
  assert.ok(
    rows.find((r) => r.tokenHash === hashToken(firstToken))!.revokedAt,
    "old invitation must be revoked",
  );
  assert.ok(
    rows.find((r) => r.tokenHash === hashToken(secondToken))!.revokedAt === null,
  );
  assert.equal((await register(owner, firstToken)).statusCode, 403);

  // An existing unverified account gets a normal verification email, not a new invitation.
  await pg.db.insert(users).values({
    email: owner,
    displayName: "Owner",
    passwordHash: await hashPassword("A very secret testing password"),
  });
  const beforeVerify = sink.outbox.length;
  const verify = await bootstrap();
  assert.equal(verify.statusCode, 200, verify.body);
  assert.equal(sink.outbox.length, beforeVerify + 1);
  assert.match(sink.outbox.at(-1)!.subject, /Confirm your email/);
  assert.match(sink.outbox.at(-1)!.text, /\/verify#/);

  // Once a verified admin exists, the public bootstrap endpoint becomes a no-op.
  await pg.db
    .update(users)
    .set({ verifiedAt: new Date(), isAdmin: true })
    .where(eq(users.email, owner));
  await pg.db.insert(auditLog).values({
    actorId: null,
    action: "admin.bootstrap",
    targetType: "user",
    targetId: (await pg.db.select({ id: users.id }).from(users).where(eq(users.email, owner)))[0].id,
    metadata: { mechanism: "verified_email" },
  });
  const beforeAdmin = sink.outbox.length;
  const disabled = await bootstrap();
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(sink.outbox.length, beforeAdmin);
  await pg.db
    .update(users)
    .set({ isAdmin: false })
    .where(eq(users.email, owner));
  assert.equal((await bootstrap()).statusCode, 200);
  assert.equal(sink.outbox.length, beforeAdmin, "bootstrap stays locked after first use");
  const [lockedOwner] = await pg.db.select().from(users).where(eq(users.email, owner));
  assert.equal(lockedOwner.isAdmin, false, "locked bootstrap never re-grants admin");
});
