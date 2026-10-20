import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { hashToken, sessionCookie } from "../access.js";
import {
  users,
  sessions,
  projectReports,
  moderationActions,
  auditLog,
} from "../db/schema.js";
import { Mailer, MemoryMail } from "../mail.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  cookie: string;
const ids: Record<string, string> = {},
  tokens: Record<string, string> = {};
let scenario = 0,
  ipSequence = 10;
const snapshot = {
  format: "randusr",
  version: 2,
  title: "Safe Moon",
  sourceCode: 'PRINT "<script>data, never HTML</script>"',
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
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
  ip?: string,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    remoteAddress: ip ?? `192.3.${scenario}.${(++ipSequence % 240) + 1}`,
    headers: {
      origin: "http://localhost:5173",
      "x-csrf-token": csrf,
      cookie: `${cookie}; ${sessionCookie}=${tokens[role] ?? ""}`,
    },
  });
}
async function published(title = "Safe Moon", visibility = "public") {
  const created = await request("owner", "POST", "/projects", {
    snapshot: { ...snapshot, title },
  });
  assert.equal(created.statusCode, 200, created.body);
  const r = await request(
    "owner",
    "POST",
    `/projects/${created.json().id}/share`,
    { version: created.json().version, visibility, title },
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    for (const role of [
      "owner",
      "reporter",
      "admin",
      "unverified",
      "quota",
      "ip",
    ]) {
      const [u] = await pg.db
        .insert(users)
        .values({
          email: `${role}@example.invalid`,
          displayName: `${role} display`,
          passwordHash: "not a login hash",
          verifiedAt: role === "unverified" ? null : new Date(),
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
test("verified reports are idempotent, private, non-destructive and visible only in audited admin queue", async () => {
  scenario++;
  const p = await published();
  for (const role of ["guest", "unverified"])
    assert.equal(
      (
        await request(role, "POST", `/shared/${p.shortCode}/report`, {
          reason: "spam",
        })
      ).statusCode,
      role === "guest" ? 401 : 403,
    );
  for (const role of ["guest", "owner", "unverified"])
    assert.equal(
      (await request(role, "GET", "/admin/reports")).statusCode,
      role === "guest" ? 401 : 403,
    );
  const detail = '<img src=x onerror="alert(1)">';
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await request("reporter", "POST", `/shared/${p.shortCode}/report`, {
          reason: "personal_info",
          detail,
        })
      ).statusCode,
      200,
    );
  const queue = await request("admin", "GET", "/admin/reports");
  assert.equal(queue.statusCode, 200, queue.body);
  const item = queue.json().reports.find((r: any) => r.project.id === p.id);
  assert.equal(item.openCount, 1);
  assert.equal(item.detail, detail);
  assert.equal(item.owner.displayName, "owner display");
  assert.equal(queue.body.includes("reporter@example"), false);
  assert.equal(queue.body.includes("reporterId"), false);
  const shared = await request("guest", "GET", `/shared/${p.shortCode}`);
  assert.equal(shared.statusCode, 200);
  assert.equal(shared.json().snapshot.sourceCode, snapshot.sourceCode);
  for (const path of [`/shared/${p.shortCode}`, "/gallery"]) {
    const r = await request("guest", "GET", path);
    assert.equal(r.body.includes("@example.invalid"), false);
    assert.equal(r.body.includes("classMembership"), false);
  }
  assert.ok(
    (
      await pg.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "admin.reports_inspected"))
    ).length,
  );
});
test("dismissal is retained with reason in history; block makes previous links unavailable and reports can be resolved", async () => {
  scenario++;
  const p = await published("Review Moon", "unlisted");
  await request("reporter", "POST", `/shared/${p.shortCode}/report`, {
    reason: "copyright",
  });
  let [r] = await pg.db
    .select()
    .from(projectReports)
    .where(eq(projectReports.projectId, p.id));
  assert.equal(
    (
      await request("owner", "POST", `/admin/reports/${r.id}/review`, {
        action: "dismiss",
        reason: "Reviewed",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/reports/${r.id}/review`, {
        action: "dismiss",
        reason: " ",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/reports/${r.id}/review`, {
        action: "dismiss",
        reason: "Original artwork confirmed",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/reports/${r.id}/review`, {
        action: "dismiss",
        reason: "Again",
      })
    ).statusCode,
    409,
  );
  assert.ok(
    (await request("admin", "GET", "/admin/reports?state=dismissed"))
      .json()
      .reports.some((i: any) => i.id === r.id),
  );
  const history = await pg.db
    .select()
    .from(moderationActions)
    .where(eq(moderationActions.reportId, r.id));
  assert.equal(history[0].reason, "Original artwork confirmed");
  await request("reporter", "POST", `/shared/${p.shortCode}/report`, {
    reason: "personal_info",
  });
  const queue = (await request("admin", "GET", "/admin/reports"))
    .json()
    .reports.find((i: any) => i.project.id === p.id);
  const blocked = await request(
    "admin",
    "POST",
    `/admin/projects/${p.id}/moderate`,
    { version: p.version, action: "block", reason: "Accidental personal data" },
  );
  assert.equal(blocked.statusCode, 200, blocked.body);
  assert.equal(
    (await request("guest", "GET", `/shared/${p.shortCode}`)).statusCode,
    404,
  );
  assert.equal(
    (
      await request("reporter", "POST", `/shared/${p.shortCode}/report`, {
        reason: "spam",
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/reports/${queue.id}/review`, {
        action: "resolve",
        reason: "Blocked sharing",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("owner", "GET", `/projects/${p.id}`)).json().snapshot
      .sourceCode,
    snapshot.sourceCode,
  );
});
test("IP throttles report requests and durable account quota survives IP changes", async () => {
  scenario++;
  const list = [];
  for (let i = 0; i < 6; i++) list.push(await published(`Quota Moon ${i}`));
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request("quota", "POST", `/shared/${list[i].shortCode}/report`, {
          reason: "spam",
        })
      ).statusCode,
      200,
    );
  assert.equal(
    (
      await request("quota", "POST", `/shared/${list[5].shortCode}/report`, {
        reason: "spam",
      })
    ).statusCode,
    429,
  );
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request(
          "ip",
          "POST",
          `/shared/${list[0].shortCode}/report`,
          { reason: "spam" },
          "192.0.2.10",
        )
      ).statusCode,
      200,
    );
  assert.equal(
    (
      await request(
        "ip",
        "POST",
        `/shared/${list[0].shortCode}/report`,
        { reason: "spam" },
        "192.0.2.10",
      )
    ).statusCode,
    429,
  );
});
test("publication metadata rejects HTML and durable publication quota throttles changing IPs", async () => {
  scenario++;
  const created = await request("owner", "POST", "/projects", { snapshot });
  const p = created.json();
  for (const title of ["<script>alert(1)</script>", " "])
    assert.equal(
      (
        await request("owner", "POST", `/projects/${p.id}/share`, {
          version: p.version,
          visibility: "public",
          title,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await request("unverified", "POST", `/projects/${p.id}/share`, {
        version: p.version,
        visibility: "public",
        title: "Moon",
      })
    ).statusCode,
    403,
  );
  // Existing publications count against this same account despite different client IPs.
  let version = p.version,
    limited = false;
  for (let i = 0; i < 21; i++) {
    const r = await request("owner", "POST", `/projects/${p.id}/share`, {
      version,
      visibility: "public",
      title: "Moon",
    });
    if (r.statusCode === 429) {
      limited = true;
      break;
    }
    assert.equal(r.statusCode, 200, r.body);
    version = r.json().version;
  }
  assert.equal(limited, true);
});
test("report queue pagination preserves microsecond order without duplicate or missing records", async () => {
  scenario++;
  const p = (await request("owner", "POST", "/projects", { snapshot })).json();
  const inserted = await pg.db
    .insert(projectReports)
    .values(
      Array.from({ length: 65 }, (_, i) => ({
        projectId: p.id,
        reporterId: ids.reporter,
        reason: "other",
        state: "dismissed" as const,
        detail: `Pagination ${i}`,
      })),
    )
    .returning({ id: projectReports.id });
  const expected = new Set(inserted.map((r) => r.id)),
    seen = new Set<string>();
  let cursor = "";
  do {
    const r = await request(
      "admin",
      "GET",
      `/admin/reports?state=dismissed${cursor ? `&cursor=${cursor}` : ""}`,
    );
    assert.equal(r.statusCode, 200, r.body);
    for (const item of r.json().reports) {
      assert.equal(seen.has(item.id), false);
      seen.add(item.id);
    }
    cursor = r.json().nextCursor ?? "";
  } while (cursor);
  for (const id of expected) assert.equal(seen.has(id), true);
});
