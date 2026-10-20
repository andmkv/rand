import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { and, eq, sql } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { hashPassword } from "../auth.js";
import { hashToken, sessionCookie } from "../access.js";
import {
  users,
  sessions,
  projects,
  projectRevisions,
  auditLog,
  emailVerificationTokens,
  passwordResetTokens,
} from "../db/schema.js";
import { Mailer, MemoryMail } from "../mail.js";
import type { ProjectSnapshot } from "../../shared/project.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  csrfCookie: string,
  scenario = 0;
const roles = ["admin", "spare", "member", "unverified"],
  ids: Record<string, string> = {},
  tokens: Record<string, string> = {},
  password = "Admin testing password 123",
  sink = new MemoryMail();
const snapshot: ProjectSnapshot = {
  format: "randusr",
  version: 2,
  title: "Moon",
  sourceCode: 'PRINT "PRIVATE SOURCE"',
  mode: "sandbox",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  storyId: "tower",
  sceneId: 0,
  unlocked: 0,
  exampleId: null,
};
async function fresh(role: string) {
  tokens[role] = randomBytes(32).toString("base64url");
  await pg.db.insert(sessions).values({
    userId: ids[role],
    tokenHash: hashToken(tokens[role]),
    expiresAt: new Date(Date.now() + 600000),
  });
}
async function request(
  role: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    remoteAddress: `192.2.${scenario}.${roles.indexOf(role) + 2}`,
    headers: {
      origin: "http://localhost:5173",
      "x-csrf-token": csrf,
      cookie: `${csrfCookie}; ${sessionCookie}=${tokens[role] ?? ""}`,
    },
  });
}
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    const hash = await hashPassword(password);
    for (const role of roles) {
      const [u] = await pg.db
        .insert(users)
        .values({
          email: `admin-test-${role}@example.invalid`,
          displayName: `${role} display`,
          passwordHash: hash,
          verifiedAt: role === "unverified" ? null : new Date(),
          isAdmin: ["admin", "spare"].includes(role),
        })
        .returning();
      ids[role] = u.id;
      await fresh(role);
    }
    app = buildApp(pg.db, false, {
      baseUrl: "http://localhost:5173",
      secureCookies: false,
      adminEmail: "bootstrap@example.invalid",
      sessionDays: 14,
      publicRegistrationEnabled: true,
      mailer: new Mailer(sink, "http://localhost:5173"),
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
test("all admin surfaces deny guests, unverified accounts and non-admins independently of frontend", async () => {
  scenario++;
  const paths = [
    "/admin/users",
    `/admin/users/${ids.member}`,
    "/admin/projects",
    `/admin/projects/${ids.member}`,
    `/admin/projects/${ids.member}/history`,
    `/admin/projects/${ids.member}/reports`,
    "/admin/audit",
    "/admin/operations",
    "/admin/product-health",
  ];
  for (const role of ["guest", "member", "unverified"])
    for (const path of paths)
      assert.equal(
        (await request(role, "GET", path)).statusCode,
        role === "guest" ? 401 : 403,
        `${role} ${path}`,
      );
  for (const path of ["admin", "state", "logout", "mail", "delete"]) {
    const body =
      path === "admin"
        ? { enabled: true, currentPassword: password, reason: "test" }
        : path === "delete"
          ? { currentPassword: password, reason: "test" }
          : path === "state"
            ? { state: "suspended", reason: "test" }
            : path === "mail"
              ? { kind: "reset", reason: "test" }
              : { reason: "test" };
    assert.equal(
      (
        await request(
          "member",
          "POST",
          `/admin/users/${ids.member}/${path}`,
          body,
        )
      ).statusCode,
      403,
    );
  }
});
test("user search/detail are bounded metadata only; role changes are gone and session/mail actions audit", async () => {
  scenario++;
  const result = await request(
    "admin",
    "GET",
    "/admin/users?q=member&verified=true&state=active&after=2000-01-01T00%3A00%3A00Z",
  );
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().users.length, 1);
  assert.equal(result.json().users[0].id, ids.member);
  assert.equal(result.body.includes("passwordHash"), false);
  assert.equal(result.body.includes("tokenHash"), false);
  const detail = await request("admin", "GET", `/admin/users/${ids.member}`);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().activeSessions, 1);
  assert.equal(detail.json().projectCount, 0);
  assert.equal(
    (
      await request("admin", "POST", `/admin/users/${ids.member}/role`, {
        role: "teacher",
        reason: "Support",
      })
    ).statusCode,
    404,
  );
  const [u] = await pg.db.select().from(users).where(eq(users.id, ids.member));
  assert.equal(u.isAdmin, false);
  await request("admin", "POST", `/admin/users/${ids.member}/mail`, {
    kind: "reset",
    reason: "Recovery support",
  });
  await request("admin", "POST", `/admin/users/${ids.unverified}/mail`, {
    kind: "verify",
    reason: "Delivery support",
  });
  assert.equal(sink.outbox.length, 2);
  assert.equal(
    (
      await pg.db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, ids.member))
    ).length,
    1,
  );
  assert.equal(
    (
      await pg.db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.userId, ids.unverified))
    ).length,
    1,
  );
  const audit = (
    await request("admin", "GET", `/admin/audit?targetId=${ids.member}`)
  ).json().events;
  assert.ok(
    audit.some((a: { action: string }) => a.action === "admin.reset_requested"),
  );
  assert.equal(JSON.stringify(audit).includes("token="), false);
  await request("admin", "POST", `/admin/users/${ids.member}/logout`, {
    reason: "Lost device",
  });
  assert.equal(
    (await request("member", "GET", "/session")).json().principal,
    null,
  );
  await fresh("member");
});
test("admin grant/revoke requires current password, verified active target and invalidates prior sessions", async () => {
  scenario++;
  assert.equal(
    (
      await request("admin", "POST", `/admin/users/${ids.member}/admin`, {
        enabled: true,
        reason: "Support operator",
        currentPassword: "Wrong password",
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/users/${ids.unverified}/admin`, {
        enabled: true,
        reason: "Support operator",
        currentPassword: password,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/users/${ids.member}/admin`, {
        enabled: true,
        reason: "Support operator",
        currentPassword: password,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("member", "GET", "/session")).json().principal,
    null,
  );
  await fresh("member");
  assert.equal(
    (await request("member", "GET", "/admin/users")).statusCode,
    200,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/users/${ids.member}/admin`, {
        enabled: false,
        reason: "Operator rotation",
        currentPassword: password,
      })
    ).statusCode,
    200,
  );
  await fresh("member");
  assert.equal(
    (await request("member", "GET", "/admin/users")).statusCode,
    403,
  );
});
test("admin source inspection/moderation is explicit, audited and preserves drafts; suspension closes shared URLs", async () => {
  scenario++;
  const p = (await request("member", "POST", "/projects", { snapshot })).json();
  await request("member", "POST", `/projects/${p.id}/share`, {
    version: 1,
    visibility: "public",
    title: "Public moon",
  });
  assert.equal(
    (await request("admin", "GET", `/projects/${p.id}`)).statusCode,
    404,
    "ordinary owner API has no bypass",
  );
  const source = await request("admin", "GET", `/admin/projects/${p.id}`);
  assert.equal(source.statusCode, 200, source.body);
  assert.equal(source.json().snapshot.sourceCode, snapshot.sourceCode);
  assert.equal(source.json().publishedSnapshot.sourceCode, snapshot.sourceCode);
  const body = { revisionId: source.json().revisionId, featured: true };
  assert.equal(
    (await request("admin", "PATCH", `/admin/featured/${p.shortCode}`, body))
      .statusCode,
    200,
  );
  assert.ok(
    (await request("guest", "GET", "/gallery?sort=featured"))
      .json()
      .projects.some(
        (p2: { shortCode: string }) => p2.shortCode === p.shortCode,
      ),
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/projects/${p.id}/moderate`, {
        version: 1,
        action: "unpublish",
        reason: "Review",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/projects/${p.id}/moderate`, {
        version: 2,
        action: "block",
        reason: "Unsafe publication",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("guest", "GET", `/shared/${p.shortCode}`)).statusCode,
    404,
  );
  await request("admin", "POST", `/admin/projects/${p.id}/moderate`, {
    version: 3,
    action: "unblock",
    reason: "Reviewed corrected context",
  });
  assert.equal(
    (await request("guest", "GET", `/shared/${p.shortCode}`)).statusCode,
    200,
  );
  await request("admin", "POST", `/admin/users/${ids.member}/state`, {
    state: "suspended",
    reason: "Support safety hold",
  });
  assert.equal(
    (await request("guest", "GET", `/shared/${p.shortCode}`)).statusCode,
    404,
  );
  assert.equal(
    (await request("member", "GET", "/session")).json().principal,
    null,
  );
  await request("admin", "POST", `/admin/users/${ids.member}/state`, {
    state: "active",
    reason: "Hold resolved",
  });
  await fresh("member");
  await request("admin", "POST", `/admin/projects/${p.id}/moderate`, {
    version: 4,
    action: "unpublish",
    reason: "Remove from public gallery",
  });
  assert.equal(
    (await request("guest", "GET", `/shared/${p.shortCode}`)).statusCode,
    404,
  );
  assert.equal(
    (await request("member", "GET", `/projects/${p.id}`)).json().snapshot
      .sourceCode,
    snapshot.sourceCode,
  );
  assert.equal(
    (await request("admin", "GET", `/admin/projects/${p.id}/history`)).json()
      .actions.length,
    3,
  );
  assert.equal(
    (
      await request(
        "admin",
        "GET",
        `/admin/audit?targetId=${p.id}&action=admin.project_unpublish`,
      )
    ).json().events.length,
    1,
  );
});
test("admin cursors preserve equal timestamps and return bounded metadata", async () => {
  scenario++;
  const rows = await pg.db
    .insert(users)
    .values(
      Array.from({ length: 65 }, (_, i) => ({
        email: `admin-page-${i}@example.invalid`,
        displayName: `Page ${i}`,
        passwordHash: "not used",
        createdAt: sql`'2026-10-18T01:02:03.123456Z'::timestamptz`,
      })),
    )
    .returning();
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const result = await request(
      "admin",
      "GET",
      `/admin/users?q=admin-page-${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    const page = result.json();
    assert.ok(page.users.length <= 30);
    for (const u of page.users) {
      assert.equal(seen.has(u.id), false);
      seen.add(u.id);
      assert.equal(u.passwordHash, undefined);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, rows.length);
});
test("concurrent self-suspensions cannot remove the last verified active administrator", async () => {
  scenario++;
  const responses = await Promise.all([
    request("admin", "POST", `/admin/users/${ids.admin}/state`, {
      state: "suspended",
      reason: "Concurrent operator hold",
    }),
    request("spare", "POST", `/admin/users/${ids.spare}/state`, {
      state: "suspended",
      reason: "Concurrent operator hold",
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  const active = responses[0].statusCode === 409 ? "admin" : "spare";
  const response = await request(
    active,
    "POST",
    `/admin/users/${ids[active]}/admin`,
    {
      enabled: false,
      reason: "Do not strand administration",
      currentPassword: password,
    },
  );
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, "LAST_ADMIN");
  const [{ count }] = await pg.db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.isAdmin, true), eq(users.state, "active")));
  assert.equal(count, 1);
});
test("verified admin sees a fresh protected operations snapshot; missing snapshot is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "randusr-admin-ops-"));
  const old = process.env.OPS_STATUS_FILE;
  process.env.OPS_STATUS_FILE = join(dir, "status.json");
  try {
    const [active] = await pg.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isAdmin, true), eq(users.state, "active")))
      .limit(1);
    const actor = active.id === ids.admin ? "admin" : "spare";
    await fresh(actor);
    const missing = await request(actor, "GET", "/admin/operations");
    assert.equal(missing.statusCode, 503, missing.body);
    await writeFile(
      process.env.OPS_STATUS_FILE,
      JSON.stringify({
        version: 1,
        checkedAt: Date.now(),
        ok: true,
        checks: { backend: { ok: true } },
      }),
    );
    const r = await request(actor, "GET", "/admin/operations");
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().stale, false);
    assert.equal(r.json().checks.backend.ok, true);
    assert.equal(r.headers["cache-control"], "no-store");
  } finally {
    if (old === undefined) delete process.env.OPS_STATUS_FILE;
    else process.env.OPS_STATUS_FILE = old;
    await rm(dir, { recursive: true, force: true });
  }
});
