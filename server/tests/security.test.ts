import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { users, sessions } from "../db/schema.js";
import { hashToken, sessionCookie } from "../access.js";
import { Mailer, MemoryMail, SmtpMail } from "../mail.js";
import { readLimits, platformLimits } from "../limits.js";
import { readTrustProxy } from "../config.js";
import { authConfig } from "../auth-config.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  cookie: string,
  logs = "";
const tokens: Record<string, string> = {},
  ids: Record<string, string> = {};
const config = {
  baseUrl: "http://localhost:5173",
  secureCookies: false,
  adminEmail: "bootstrap@example.invalid",
  sessionDays: 14,
  publicRegistrationEnabled: true,
  mailer: new Mailer(new MemoryMail(), "http://localhost:5173"),
};
const snapshot = {
  format: "randusr",
  version: 2,
  title: "Normal autosave",
  sourceCode: 'PRINT "MOON"',
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
  method: "GET" | "POST" | "PUT",
  path: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    remoteAddress: "192.0.2.11",
    headers: {
      origin: "http://localhost:5173",
      "x-csrf-token": csrf,
      cookie: `${cookie}; ${sessionCookie}=${tokens[role] ?? ""}`,
    },
  });
}
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    for (const role of ["one", "two"]) {
      const [u] = await pg.db
        .insert(users)
        .values({
          email: `security-${role}@example.invalid`,
          displayName: role,
          passwordHash: "not a login hash",
          verifiedAt: new Date(),
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
    const sink = new Writable({
      write(chunk, _encoding, next) {
        logs += chunk.toString();
        next();
      },
    });
    app = buildApp(pg.db, true, config, sink);
    app.get("/api/v1/test-log-failure", async () => {
      throw new Error("PRIVATE_SQL_SECRET_STACK");
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
test("configuration rejects non-finite, fractional, negative and excessive quotas without echoing secrets", () => {
  for (const name of [
    "MAX_PROJECTS_PER_USER",
    "MAX_SOURCE_CHARACTERS",
    "REVISION_KEEP_COUNT",
    "MAX_PUBLICATIONS_PER_15_MINUTES",
    "MAX_AUTOSAVES_PER_MINUTE",
    "MAX_PROJECT_PAYLOAD_BYTES",
  ])
    for (const value of [
      "Infinity",
      "NaN",
      "1.5",
      "-1",
      "0",
      "9999999999999999999999",
      "PRIVATE_QUOTA_SECRET",
    ])
      assert.throws(
        () => readLimits({ [name]: value }),
        (e) =>
          e instanceof Error && !e.message.includes("PRIVATE_QUOTA_SECRET"),
      );
  assert.equal(
    readLimits({ MAX_SOURCE_CHARACTERS: "2000" }).sourceCharacters,
    2000,
  );
  assert.equal(readTrustProxy({ TRUST_PROXY_HOPS: "1" }), 1);
  assert.throws(() => readTrustProxy({ TRUST_PROXY_HOPS: "true" }));
  for (const raw of [
    "PRIVATE_SMTP_SECRET",
    "http://secret@example.invalid",
    "smtp://user:PRIVATE_SMTP_SECRET@example.invalid?tls.rejectUnauthorized=false",
  ])
    assert.throws(
      () => new SmtpMail(raw),
      (e) => e instanceof Error && !e.message.includes("PRIVATE_SMTP_SECRET"),
    );
  assert.throws(
    () => authConfig({ APP_BASE_URL: "PRIVATE_BASE_SECRET" }),
    (e) => e instanceof Error && !e.message.includes("PRIVATE_BASE_SECRET"),
  );
  assert.throws(() =>
    authConfig({
      MAIL_FROM: "secret@example.invalid\r\nBcc:other@example.invalid",
    }),
  );
});
test("security headers, no permissive CORS and normalized bounded-input errors", async () => {
  const r = await request("guest", "GET", "/limits");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().sourceCharacters, platformLimits.sourceCharacters);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["referrer-policy"], "no-referrer");
  assert.equal(r.headers["x-frame-options"], "DENY");
  assert.match(
    String(r.headers["content-security-policy"]),
    /frame-ancestors 'none'/,
  );
  const cross = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: { snapshot },
    headers: {
      origin: "https://evil.example.invalid",
      cookie,
      "x-csrf-token": csrf,
    },
  });
  assert.equal(cross.statusCode, 403);
  assert.equal(cross.json().error.code, "CSRF_FAILED");
  assert.equal(cross.headers["access-control-allow-origin"], undefined);
  const unsupported = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: "<source/>",
    headers: {
      origin: config.baseUrl,
      cookie,
      "x-csrf-token": csrf,
      "content-type": "text/xml",
    },
  });
  assert.equal(unsupported.statusCode, 400);
  assert.equal(unsupported.json().error.code, "INVALID_INPUT");
  const huge = await request("one", "POST", "/projects", {
    snapshot: {
      ...snapshot,
      sourceCode: "x".repeat(platformLimits.payloadBytes),
    },
  });
  assert.equal(huge.statusCode, 413);
  assert.equal(huge.json().error.code, "PAYLOAD_TOO_LARGE");
  const query = await request(
    "one",
    "GET",
    "/projects?q=%27%3B%20DROP%20TABLE%20users%3B--",
  );
  assert.equal(query.statusCode, 200);
  assert.equal(query.json().projects.length, 0);
  assert.equal(
    (await request("one", "POST", "/projects", { snapshot, isAdmin: true }))
      .statusCode,
    400,
  );
});
test("normal autosave budget is isolated per account behind one classroom IP and repeated writes are throttled", async () => {
  for (const role of ["one", "two"]) {
    let p = (await request(role, "POST", "/projects", { snapshot })).json();
    for (let n = 0; n < 90; n++) {
      const r = await request(role, "PUT", `/projects/${p.id}`, {
        version: p.version,
        snapshot: { ...snapshot, sourceCode: `PRINT "${n}"` },
      });
      assert.equal(r.statusCode, 200, r.body);
      p = r.json();
    }
    if (role === "one") {
      for (let n = 90; n < platformLimits.autosavesPerMinute; n++) {
        const r = await request(role, "PUT", `/projects/${p.id}`, {
          version: p.version,
          snapshot,
        });
        assert.equal(r.statusCode, 200, r.body);
        p = r.json();
      }
      const r = await request(role, "PUT", `/projects/${p.id}`, {
        version: p.version,
        snapshot,
      });
      assert.equal(r.statusCode, 429);
      assert.equal(r.json().error.code, "RATE_LIMITED");
    }
  }
});
test("logs contain route/status/request id but never bodies, cookies, token queries or raw internal errors", async () => {
  await app.inject({
    url: "/api/v1/health?token=PRIVATE_QUERY_SECRET",
    headers: {
      cookie: `${sessionCookie}=PRIVATE_COOKIE_SECRET`,
      authorization: "Bearer PRIVATE_HEADER_SECRET",
    },
  });
  const r = await request("one", "GET", "/test-log-failure");
  assert.equal(r.statusCode, 500);
  assert.equal(r.json().error.code, "INTERNAL_ERROR");
  await request("two", "POST", "/projects", {
    snapshot: { ...snapshot, title: "PRIVATE_SOURCE_BODY_SECRET" },
  });
  for (const secret of [
    "PRIVATE_QUERY_SECRET",
    "PRIVATE_COOKIE_SECRET",
    "PRIVATE_HEADER_SECRET",
    "PRIVATE_SOURCE_BODY_SECRET",
    "PRIVATE_SQL_SECRET_STACK",
    tokens.one,
  ])
    assert.equal(logs.includes(secret), false, secret.slice(0, 20));
  assert.ok(logs.includes("request_complete"));
  assert.ok(logs.includes("request_failed"));
  assert.ok(logs.includes("statusCode"));
  assert.ok(logs.includes("requestId"));
});
test("untrusted forwarded IP headers cannot evade authentication throttling", async () => {
  for (let i = 0; i < 11; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "192.0.2.12",
      payload: {
        email: "unknown@example.invalid",
        password: "A sufficiently long password",
      },
      headers: {
        origin: config.baseUrl,
        cookie,
        "x-csrf-token": csrf,
        "x-forwarded-for": `198.51.100.${i + 1}`,
      },
    });
    assert.equal(r.statusCode, i === 10 ? 429 : 401, r.body);
    if (i === 10) assert.equal(r.json().error.code, "RATE_LIMITED");
  }
});
test("operational browser reports reject private payloads and cross-origin requests, cap abuse and log only counters", async () => {
  const cross = await app.inject({
    method: "POST",
    url: "/api/v1/operations/client-error",
    payload: { kind: "error" },
  });
  assert.equal(cross.statusCode, 403);
  const invalid = await request("one", "POST", "/operations/client-error", {
    kind: "error",
    source: "PRIVATE_PROGRAM_NEVER_LOG",
  });
  assert.equal(invalid.statusCode, 400);
  for (let i = 0; i < 5; i++) {
    const r = await request("one", "POST", "/operations/client-error", {
      kind: "unhandledrejection",
    });
    // Rejected schema payload consumed one rate-limit attempt.
    assert.equal(r.statusCode, i === 4 ? 429 : 200, r.body);
  }
  assert.ok(logs.includes("frontend_fatal"));
  assert.ok(logs.includes("durationMs"));
  assert.equal(logs.includes("PRIVATE_PROGRAM_NEVER_LOG"), false);
  for (const who of ["guest", "one"])
    assert.equal(
      (await request(who, "GET", "/admin/operations")).statusCode,
      who === "guest" ? 401 : 403,
    );
});
test("maintenance blocks mutations while guest reads and readiness continue", async () => {
  process.env.READ_ONLY_MODE = "true";
  const maintenance = buildApp(pg.db, false, config);
  delete process.env.READ_ONLY_MODE;
  try {
    assert.equal((await maintenance.inject("/api/v1/ready")).statusCode, 200);
    assert.equal(
      (
        await maintenance.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: {},
        })
      ).statusCode,
      503,
    );
    assert.equal(
      (await maintenance.inject("/api/v1/auth/policy")).statusCode,
      200,
    );
  } finally {
    await maintenance.close();
  }
});
