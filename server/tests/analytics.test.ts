import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { analyticsConfig } from "../analytics.js";
import { users, sessions } from "../db/schema.js";
import { hashToken, sessionCookie } from "../access.js";
import { Mailer, MemoryMail } from "../mail.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  cookie: string;
const accountToken = randomBytes(32).toString("base64url"),
  anon = randomBytes(32).toString("base64url"),
  mail = new MemoryMail();
const config = {
  baseUrl: "http://localhost:5173",
  secureCookies: false,
  adminEmail: "admin@example.invalid",
  sessionDays: 14,
  publicRegistrationEnabled: true,
  mailer: new Mailer(mail, "http://localhost:5173"),
};
const snapshot = {
  format: "randusr",
  version: 2,
  title: "PRIVATE_TITLE",
  sourceCode: 'PRINT "PRIVATE_PROGRAM"',
  mode: "sandbox",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  storyId: "tower",
  sceneId: 0,
  unlocked: 0,
  exampleId: null,
};
async function request(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  payload?: unknown,
  consent = true,
  authenticated: boolean | string = true,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    headers: {
      origin: config.baseUrl,
      "x-csrf-token": csrf,
      cookie: `${cookie}; ${sessionCookie}=${typeof authenticated === "string" ? authenticated : authenticated ? accountToken : ""}`,
      ...(consent
        ? { "x-product-session": anon, "x-product-notice": "test-v1" }
        : {}),
    },
  });
}
async function counts() {
  return (
    await pg.db.execute(
      sql`SELECT event,count(*)::int count FROM product_events GROUP BY event`,
    )
  ).rows;
}
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    const [u] = await pg.db
      .insert(users)
      .values({
        email: "admin@example.invalid",
        displayName: "PRIVATE_NAME",
        passwordHash: "not a login password",
        verifiedAt: new Date(),
        isAdmin: true,
      })
      .returning();
    await pg.db.insert(sessions).values({
      userId: u.id,
      tokenHash: hashToken(accountToken),
      expiresAt: new Date(Date.now() + 600000),
    });
    process.env.PRODUCT_ANALYTICS_ENABLED = "true";
    process.env.PRODUCT_ANALYTICS_NOTICE_VERSION = "test-v1";
    process.env.PRODUCT_ANALYTICS_NOTICE_URL = "https://example.invalid/notice";
    app = buildApp(pg.db, false, config);
    delete process.env.PRODUCT_ANALYTICS_ENABLED;
    delete process.env.PRODUCT_ANALYTICS_NOTICE_VERSION;
    delete process.env.PRODUCT_ANALYTICS_NOTICE_URL;
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
test("analytics fails closed by default and requires a separately configured notice", async () => {
  assert.deepEqual(analyticsConfig({}), {
    enabled: false,
    noticeVersion: null,
    noticeUrl: null,
  });
  for (const env of [
    { PRODUCT_ANALYTICS_ENABLED: "1" },
    { PRODUCT_ANALYTICS_ENABLED: "true" },
    {
      PRODUCT_ANALYTICS_ENABLED: "true",
      PRODUCT_ANALYTICS_NOTICE_VERSION: "v1",
      PRODUCT_ANALYTICS_NOTICE_URL: "http://example.invalid/notice",
    },
  ])
    assert.throws(() => analyticsConfig(env));
  const closed = buildApp(pg.db, false, config);
  try {
    assert.equal(
      (await closed.inject("/api/v1/analytics/config")).json().enabled,
      false,
    );
    const r = await closed.inject("/api/v1/auth/csrf");
    const denied = await closed.inject({
      method: "POST",
      url: "/api/v1/analytics/events",
      payload: {
        sessionToken: anon,
        noticeVersion: "test-v1",
        event: "homepage_viewed",
      },
      headers: {
        origin: config.baseUrl,
        "x-csrf-token": r.json().token,
        cookie: `${r.cookies[0].name}=${r.cookies[0].value}`,
      },
    });
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(await counts(), []);
  } finally {
    await closed.close();
  }
});
test("client events require CSRF, exact consent version and known content-free fields; only hashes persist", async () => {
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/analytics/events",
        payload: {
          sessionToken: anon,
          noticeVersion: "test-v1",
          event: "homepage_viewed",
        },
      })
    ).statusCode,
    403,
  );
  for (const extra of [
    { source: "PRIVATE_PROGRAM" },
    { email: "PRIVATE_EMAIL" },
    { projectId: "PRIVATE_ID" },
    { event: "assignment_reviewed" },
    { noticeVersion: "old" },
  ]) {
    const r = await request("POST", "/analytics/events", {
      sessionToken: anon,
      noticeVersion: "test-v1",
      event: "homepage_viewed",
      ...extra,
    });
    assert.ok([400, 403].includes(r.statusCode), r.body);
  }
  assert.equal(
    (
      await request("POST", "/analytics/events", {
        sessionToken: anon,
        noticeVersion: "test-v1",
        event: "homepage_viewed",
      })
    ).statusCode,
    200,
  );
  const rows = (await pg.db.execute(sql`SELECT * FROM product_events`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_hash, hashToken(anon));
  const text = JSON.stringify(rows);
  for (const value of [
    anon,
    accountToken,
    "PRIVATE_PROGRAM",
    "PRIVATE_EMAIL",
    "PRIVATE_ID",
  ])
    assert.equal(text.includes(value), false);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "created_at",
    "event",
    "id",
    "session_hash",
  ]);
});
test("ordered anonymous funnel records only successful consenting server actions; aggregates never expose private content", async () => {
  const event = async (event: string) => {
    const r = await request("POST", "/analytics/events", {
      event,
      sessionToken: anon,
      noticeVersion: "test-v1",
    });
    assert.equal(r.statusCode, 200, r.body);
  };
  await event("program_run");
  await event("signup_started");
  const registered = await request(
    "POST",
    "/auth/register",
    {
      email: "analytics-new@example.invalid",
      password: "A strong analytics testing password",
      displayName: "PRIVATE_NEW_NAME",
      locale: "en",
    },
    true,
    false,
  );
  assert.equal(registered.statusCode, 200, registered.body);
  const token = new URL(
    mail.outbox[0].text.match(/https?:\/\/[^\s]+/)![0],
  ).hash.slice(1);
  assert.equal(
    (
      await request(
        "POST",
        "/auth/verify",
        { token: new URLSearchParams(token).get("token") },
        true,
        false,
      )
    ).statusCode,
    200,
  );
  const uncounted = await request("POST", "/projects", { snapshot }, false);
  assert.equal(uncounted.statusCode, 200, uncounted.body);
  let saved = await request("POST", "/projects", { snapshot });
  assert.equal(saved.statusCode, 200, saved.body);
  let project = saved.json();
  const changed = await request("PUT", `/projects/${project.id}`, {
    version: project.version,
    snapshot,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  project = changed.json();
  const published = await request("POST", `/projects/${project.id}/share`, {
    version: project.version,
    visibility: "public",
    title: "PUBLIC_TITLE",
    description: "",
    tags: [],
  });
  assert.equal(published.statusCode, 200, published.body);
  const health = await request("GET", "/admin/product-health");
  assert.equal(health.statusCode, 200, health.body);
  const data = health.json();
  assert.equal(data.accounts.total, 2);
  assert.equal(data.accounts.verified, 2);
  assert.equal(data.projects.total, 2);
  assert.equal(data.projects.public, 1);
  assert.deepEqual(
    data.analytics.funnel.map((x: { sessions: number }) => x.sessions),
    [1, 1, 1, 1, 1],
  );
  assert.equal(
    data.analytics.events.find(
      (x: { event: string }) => x.event === "cloud_project_created",
    ).count,
    1,
  );
  for (const event of [
    "signup_completed",
    "signup_verified",
    "project_published",
  ])
    assert.ok(
      data.analytics.events.some((x: { event: string }) => x.event === event),
    );
  for (const value of [
    "PRIVATE_",
    anon,
    accountToken,
    "@example.invalid",
    project.id,
  ])
    assert.equal(health.body.includes(value), false, value);
  assert.equal(
    (await request("GET", "/admin/product-health", undefined, true, false))
      .statusCode,
    401,
  );
});
test("same-tab cohort excludes out-of-order stages; revocation removes that anonymous tab only", async () => {
  const other = randomBytes(32).toString("base64url");
  await pg.db.execute(
    sql`INSERT INTO product_events(session_hash,event,created_at) VALUES (${hashToken(other)},'signup_completed',now()-interval '2 hours'),(${hashToken(other)},'homepage_viewed',now()-interval '1 hour'),(${hashToken(other)},'program_run',now())`,
  );
  const h = (await request("GET", "/admin/product-health")).json();
  assert.deepEqual(
    h.analytics.funnel.map((x: { sessions: number }) => x.sessions),
    [2, 2, 1, 1, 1],
  );
  const removed = await request(
    "DELETE",
    "/analytics/session",
    { sessionToken: anon },
    false,
  );
  assert.equal(removed.statusCode, 200, removed.body);
  const left = (
    await pg.db.execute(sql`SELECT DISTINCT session_hash FROM product_events`)
  ).rows;
  assert.deepEqual(
    left.map((x) => x.session_hash),
    [hashToken(other)],
  );
});
test("event ingestion caps a consenting tab behind CSRF and IP throttling", async () => {
  const token = randomBytes(32).toString("base64url");
  for (let i = 0; i < 121; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/analytics/events",
      remoteAddress: "192.0.2.81",
      headers: { origin: config.baseUrl, cookie, "x-csrf-token": csrf },
      payload: {
        sessionToken: token,
        noticeVersion: "test-v1",
        event: "program_run",
      },
    });
    assert.equal(r.statusCode, i === 120 ? 429 : 200, r.body);
  }
});
