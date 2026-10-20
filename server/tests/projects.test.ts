import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { hashToken, sessionCookie } from "../access.js";
import {
  users,
  sessions,
  projects,
  projectRevisions,
  auditLog,
} from "../db/schema.js";
import { Mailer, MemoryMail } from "../mail.js";
import { rotateShareLink } from "../sharing.js";
import { pruneHistory, historyLimits } from "../revisions.js";
import type { ProjectSnapshot } from "../../shared/project.js";
import { instructionsMax } from "../../shared/limits.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  csrfCookie: string;
const identities: Record<string, string> = {};
const snapshot: ProjectSnapshot = {
  format: "randusr",
  version: 2,
  title: "Moon",
  instructions: "← → — движение\n日本語 🎮 <script>alert(1)</script>",
  sourceCode: 'TEXT 20,30,"Привет、日本語"',
  mode: "sandbox",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  storyId: "tower",
  sceneId: 0,
  unlocked: 0,
  exampleId: null,
};
let saved: { id: string; version: number };
async function request(
  role: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "x-csrf-token": csrf,
      cookie: `${csrfCookie}; ${sessionCookie}=${identities[role] ?? ""}`,
    },
  });
}
before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    for (const [name, verified] of [
      ["owner", true],
      ["other", true],
      ["unverified", false],
      ["admin", true],
    ] as const) {
      const [u] = await pg.db
        .insert(users)
        .values({
          email: `${name}@example.invalid`,
          displayName: name,
          passwordHash: "not-used-by-test",
          verifiedAt: verified ? new Date() : null,
          isAdmin: name === "admin",
        })
        .returning();
      const token = randomBytes(32).toString("base64url");
      identities[name] = token;
      await pg.db.insert(sessions).values({
        userId: u.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 600000),
      });
    }
    app = buildApp(pg.db, false, {
      baseUrl: "http://localhost:5173",
      secureCookies: false,
      adminEmail: "admin@example.invalid",
      sessionDays: 14,
      publicRegistrationEnabled: true,
      mailer: new Mailer(new MemoryMail(), "http://localhost:5173"),
    });
    const response = await app.inject("/api/v1/auth/csrf");
    csrf = response.json().token;
    csrfCookie = `${response.cookies[0].name}=${response.cookies[0].value}`;
  },
  { timeout: 150000 },
);
after(async () => {
  await app?.close();
  await pg?.stop();
});
test("private cloud snapshots preserve Unicode and reject guests/unverified/foreign accounts", async () => {
  assert.equal(
    (await request("guest", "POST", "/projects", { snapshot })).statusCode,
    401,
  );
  assert.equal(
    (await request("unverified", "POST", "/projects", { snapshot })).statusCode,
    403,
  );
  const result = await request("owner", "POST", "/projects", { snapshot });
  assert.equal(result.statusCode, 200, result.body);
  saved = result.json();
  assert.equal(result.json().visibility, "private");
  assert.deepEqual(result.json().snapshot, snapshot);
  assert.equal(
    (await request("other", "GET", `/projects/${saved.id}`)).statusCode,
    404,
  );
  assert.equal(
    (
      await request("other", "PUT", `/projects/${saved.id}`, {
        version: saved.version,
        snapshot,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request("owner", "POST", "/projects", {
        snapshot: { ...snapshot, exampleId: "unknown-example" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("owner", "POST", "/projects", {
        snapshot: { ...snapshot, sourceCode: "x".repeat(100001) },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("owner", "POST", "/projects", {
        snapshot: {
          ...snapshot,
          instructions: "🎮".repeat(instructionsMax + 1),
        },
      })
    ).statusCode,
    400,
  );

  const legacySnapshot = { ...snapshot } as Partial<ProjectSnapshot>;
  delete legacySnapshot.instructions;
  const legacyCreated = await request("owner", "POST", "/projects", {
    snapshot: legacySnapshot,
  });
  assert.equal(legacyCreated.statusCode, 200, legacyCreated.body);
  assert.equal(legacyCreated.json().snapshot.instructions, "");

  const current = await request("owner", "POST", "/projects", { snapshot });
  const oldClientSave = await request(
    "owner",
    "PUT",
    "/projects/" + current.json().id,
    {
      version: current.json().version,
      snapshot: legacySnapshot,
    },
  );
  assert.equal(oldClientSave.statusCode, 200, oldClientSave.body);
  assert.equal(
    oldClientSave.json().snapshot.instructions,
    snapshot.instructions,
  );
});
test("save version is atomic under concurrent changes; duplicate/rename/archive/delete are auditable", async () => {
  const updates = await Promise.all([
    request("owner", "PUT", `/projects/${saved.id}`, {
      version: 1,
      snapshot: { ...snapshot, title: "Rename A" },
    }),
    request("owner", "PUT", `/projects/${saved.id}`, {
      version: 1,
      snapshot: { ...snapshot, title: "Rename B" },
    }),
  ]);
  assert.deepEqual(updates.map((r) => r.statusCode).sort(), [200, 409]);
  saved = updates.find((r) => r.statusCode === 200)!.json();
  const copy = await request(
    "owner",
    "POST",
    `/projects/${saved.id}/duplicate`,
    { version: saved.version },
  );
  assert.equal(copy.statusCode, 200);
  assert.notEqual(copy.json().id, saved.id);
  assert.equal(copy.json().visibility, "private");
  const archived = await request("owner", "PATCH", `/projects/${saved.id}`, {
    version: saved.version,
    archived: true,
  });
  assert.equal(archived.statusCode, 200);
  saved = archived.json();
  assert.equal(
    (
      await request("owner", "PUT", `/projects/${saved.id}`, {
        version: saved.version,
        snapshot,
      })
    ).json().error.code,
    "PROJECT_ARCHIVED",
  );
  const restored = await request("owner", "PATCH", `/projects/${saved.id}`, {
    version: saved.version,
    archived: false,
  });
  saved = restored.json();
  assert.equal(
    (
      await request("owner", "DELETE", `/projects/${saved.id}`, {
        version: saved.version,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("owner", "GET", `/projects/${saved.id}`)).statusCode,
    404,
  );
  const [row] = await pg.db
    .select()
    .from(projects)
    .where(eq(projects.id, saved.id));
  assert.ok(row.deletedAt);
  assert.equal(row.visibility, "private");
  const events = await pg.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.targetId, saved.id));
  for (const action of [
    "project.created",
    "project.saved",
    "project.duplicated",
    "project.archived",
    "project.unarchived",
    "project.deleted",
  ])
    assert.ok(
      events.some((e) => e.action === action),
      action,
    );
});
test("library paginates metadata only without losing equal-timestamp rows; source and limits are bounded", async () => {
  const [owner] = await pg.db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.invalid"));
  await pg.db.insert(projects).values(
    Array.from({ length: 65 }, (_, i) => ({
      ownerId: owner.id,
      title: `Test ${i}`,
      snapshot: { ...snapshot },
      mode: "sandbox" as const,
      shortCode: `pagination-${i}`,
    })),
  );
  await pg.db.execute(
    sql`update projects set updated_at = '2026-10-18T00:01:02.123456Z' where title like 'Test %'`,
  );
  let cursor: string | null = null;
  const ids = new Set<string>();
  do {
    const response = await request(
      "owner",
      "GET",
      `/projects?q=Test${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    assert.equal(response.statusCode, 200, response.body);
    const page = response.json();
    assert.ok(page.projects.length <= 30);
    for (const p of page.projects) {
      assert.equal(p.snapshot, undefined);
      assert.equal(ids.has(p.id), false);
      ids.add(p.id);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.size, 65);
  assert.equal(
    (await request("owner", "GET", "/projects?cursor=bad")).statusCode,
    400,
  );
  assert.equal(
    (await request("owner", "GET", "/limits")).json().sourceCharacters,
    100000,
  );
  assert.equal(
    (await request("other", "GET", "/projects")).json().projects.length,
    0,
  );
});

test("history is owner-only/read-only, restores into new revision and copies without changing original", async () => {
  const created = await request("owner", "POST", "/projects", { snapshot });
  const p = created.json();
  const saved = await request("owner", "PUT", `/projects/${p.id}`, {
    version: p.version,
    snapshot: {
      ...snapshot,
      sourceCode: 'PRINT "SECOND"',
      instructions: "Changed controls\n🎮",
    },
  });
  assert.equal(saved.statusCode, 200);
  const history = await request("owner", "GET", `/projects/${p.id}/revisions`);
  assert.equal(history.statusCode, 200);
  const revisions = history.json().revisions;
  assert.equal(revisions.length, 2);
  const first = revisions.find((r: any) => r.number === 1);
  assert.equal(
    (await request("other", "GET", `/projects/${p.id}/revisions`)).statusCode,
    404,
  );
  assert.equal(
    (
      await request("owner", "GET", `/projects/${p.id}/revisions/${first.id}`)
    ).json().snapshot.sourceCode,
    snapshot.sourceCode,
  );
  assert.equal(
    (
      await request(
        "owner",
        "GET",
        "/projects/" + p.id + "/revisions/" + first.id,
      )
    ).json().snapshot.instructions,
    snapshot.instructions,
  );
  const restore = await request(
    "owner",
    "POST",
    `/projects/${p.id}/revisions/${first.id}/restore`,
    { version: 2 },
  );
  assert.equal(restore.statusCode, 200, restore.body);
  assert.equal(restore.json().version, 3);
  assert.equal(restore.json().snapshot.sourceCode, snapshot.sourceCode);
  assert.equal(restore.json().snapshot.instructions, snapshot.instructions);
  assert.equal(
    (
      await request(
        "owner",
        "POST",
        `/projects/${p.id}/revisions/${first.id}/restore`,
        { version: 2 },
      )
    ).json().error.code,
    "VERSION_CONFLICT",
  );
  const old = await pg.db
    .select()
    .from(projectRevisions)
    .where(eq(projectRevisions.id, first.id));
  assert.equal(old[0].number, 1);
  await assert.rejects(
    pg.db
      .update(projectRevisions)
      .set({ snapshot: { sourceCode: "rewritten" } })
      .where(eq(projectRevisions.id, first.id)),
  );
  const copy = await request(
    "owner",
    "POST",
    `/projects/${p.id}/revisions/${first.id}/copy`,
    {},
  );
  assert.equal(copy.statusCode, 200, copy.body);
  assert.notEqual(copy.json().id, p.id);
  assert.equal(copy.json().visibility, "private");
  assert.equal(copy.json().snapshot.sourceCode, snapshot.sourceCode);
  assert.equal(copy.json().snapshot.instructions, snapshot.instructions);
  assert.equal(
    (await request("owner", "GET", `/projects/${p.id}`)).json().version,
    3,
  );
});
test("retention bounds ordinary revisions while preserving publication and remix pins", async () => {
  const p = (await request("owner", "POST", "/projects", { snapshot })).json();
  const [owner] = await pg.db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.invalid"));
  await pg.db.insert(projectRevisions).values(
    Array.from({ length: 79 }, (_, i) => ({
      projectId: p.id,
      actorId: owner.id,
      number: i + 2,
      snapshot: { ...snapshot },
      reason: "save",
    })),
  );
  const all = await pg.db
    .select()
    .from(projectRevisions)
    .where(eq(projectRevisions.projectId, p.id));
  const ids = [1, 2].map((n) => all.find((r) => r.number === n)!.id);
  await pg.db
    .update(projects)
    .set({
      publishedRevisionId: ids[0],
      publishedAt: new Date(),
      visibility: "public",
    })
    .where(eq(projects.id, p.id));
  const copy = (
    await request("owner", "POST", "/projects", { snapshot })
  ).json();
  await pg.db
    .update(projects)
    .set({ remixedFromRevisionId: ids[1] })
    .where(eq(projects.id, copy.id));
  await pg.db.transaction((tx) => pruneHistory(tx, p.id));
  const kept = await pg.db
    .select()
    .from(projectRevisions)
    .where(eq(projectRevisions.projectId, p.id));
  assert.equal(kept.length, historyLimits.count + 2);
  for (const id of ids) assert.ok(kept.some((r) => r.id === id));
  assert.ok(kept.some((r) => r.number === 80));
});

test("private/unlisted/public links pin snapshots, rotate/revoke safely and reject removed/suspended content", async () => {
  const p = (await request("owner", "POST", "/projects", { snapshot })).json();
  const originalCode = p.shortCode;
  assert.equal(originalCode.length, 16);
  assert.equal(
    (await request("guest", "GET", `/shared/${originalCode}`)).statusCode,
    404,
  );
  assert.equal(
    (
      await request("other", "POST", `/projects/${p.id}/share`, {
        version: 1,
        visibility: "public",
        title: "Hijack",
      })
    ).statusCode,
    404,
  );
  const published = await request("owner", "POST", `/projects/${p.id}/share`, {
    version: 1,
    visibility: "unlisted",
    title: "Shared moon",
    description: "Try it",
    tags: ["art"],
  });
  assert.equal(published.statusCode, 200, published.body);
  let shared = await request("guest", "GET", `/shared/${originalCode}`);
  assert.equal(shared.statusCode, 200);
  assert.equal(shared.json().snapshot.sourceCode, snapshot.sourceCode);
  assert.equal(shared.json().snapshot.instructions, snapshot.instructions);
  assert.equal(shared.json().author.email, undefined);
  assert.equal(shared.json().ownerProjectId, undefined);
  assert.ok(shared.headers["x-robots-tag"]?.includes("noindex"));
  const draft = await request("owner", "PUT", `/projects/${p.id}`, {
    version: 2,
    snapshot: {
      ...snapshot,
      title: "Private draft title",
      sourceCode: 'PRINT "NEW DRAFT"',
      instructions: "Draft controls\nновые кнопки",
    },
  });
  assert.equal(draft.statusCode, 200);
  shared = await request("guest", "GET", `/shared/${originalCode}`);
  assert.equal(shared.json().snapshot.sourceCode, snapshot.sourceCode);
  assert.equal(shared.json().snapshot.instructions, snapshot.instructions);
  assert.equal(shared.json().title, "Shared moon");
  assert.equal(
    (
      await request("owner", "POST", `/projects/${p.id}/share`, {
        version: 2,
        visibility: "private",
      })
    ).json().error.code,
    "VERSION_CONFLICT",
  );
  const rotated = await request(
    "owner",
    "POST",
    `/projects/${p.id}/share/rotate`,
    { version: 3 },
  );
  assert.equal(rotated.statusCode, 200);
  const code = rotated.json().shortCode;
  assert.notEqual(code, originalCode);
  assert.equal(
    (await request("guest", "GET", `/shared/${originalCode}`)).statusCode,
    404,
  );
  assert.equal(
    (await request("guest", "GET", `/shared/${code}`)).statusCode,
    200,
  );
  assert.equal(
    (
      await request("owner", "POST", `/projects/${p.id}/share`, {
        version: 4,
        visibility: "private",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("guest", "GET", `/shared/${code}`)).statusCode,
    404,
  );
  assert.equal(
    (await request("owner", "GET", `/projects/${p.id}`)).json().snapshot
      .sourceCode,
    'PRINT "NEW DRAFT"',
  );
  assert.equal(
    (
      await request("owner", "POST", `/projects/${p.id}/share`, {
        version: 5,
        visibility: "public",
        title: "<script>",
      })
    ).statusCode,
    400,
  );
  const publicResult = await request(
    "owner",
    "POST",
    `/projects/${p.id}/share`,
    { version: 5, visibility: "public", title: "Public moon", tags: ["game"] },
  );
  assert.equal(publicResult.statusCode, 200);
  shared = await request("guest", "GET", `/shared/${code}`);
  assert.equal(shared.json().visibility, "public");
  assert.equal(shared.json().snapshot.sourceCode, 'PRINT "NEW DRAFT"');
  assert.equal(
    shared.json().snapshot.instructions,
    "Draft controls\nновые кнопки",
  );
  await pg.db
    .update(projects)
    .set({ moderationState: "blocked" })
    .where(eq(projects.id, p.id));
  assert.equal(
    (await request("guest", "GET", `/shared/${code}`)).statusCode,
    404,
  );
  await pg.db
    .update(projects)
    .set({ moderationState: "active" })
    .where(eq(projects.id, p.id));
  const [owner] = await pg.db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.invalid"));
  await pg.db
    .update(users)
    .set({ state: "suspended" })
    .where(eq(users.id, owner.id));
  assert.equal(
    (await request("guest", "GET", `/shared/${code}`)).statusCode,
    404,
  );
  await pg.db
    .update(users)
    .set({ state: "active" })
    .where(eq(users.id, owner.id));
});
test("link collision retries are bounded and do not roll back unrelated projects", async () => {
  const a = (await request("owner", "POST", "/projects", { snapshot })).json(),
    b = (await request("owner", "POST", "/projects", { snapshot })).json();
  let attempts = 0;
  const [original] = await pg.db
    .select()
    .from(projects)
    .where(eq(projects.id, a.id));
  const rotated = await pg.db.transaction((tx) =>
    rotateShareLink(tx, original, () =>
      ++attempts === 1 ? b.shortCode : "TESTcollisionXYZ",
    ),
  );
  assert.equal(attempts, 2);
  assert.equal(rotated.shortCode, "TESTcollisionXYZ");
  await assert.rejects(
    pg.db.transaction((tx) => rotateShareLink(tx, rotated, () => b.shortCode)),
    /UNAVAILABLE/,
  );
  assert.equal(
    (await request("owner", "GET", `/projects/${a.id}`)).json().shortCode,
    "TESTcollisionXYZ",
  );
});

test("public gallery excludes private/unlisted/draft metadata and curation requires verified admin with audit", async () => {
  const privateProject = (
    await request("owner", "POST", "/projects", {
      snapshot: { ...snapshot, title: "HIDDEN PRIVATE WORD" },
    })
  ).json();
  const unlisted = (
    await request("owner", "POST", "/projects", { snapshot })
  ).json();
  await request("owner", "POST", `/projects/${unlisted.id}/share`, {
    version: 1,
    visibility: "unlisted",
    title: "HIDDEN LINK WORD",
    tags: ["art"],
  });
  const p = (await request("owner", "POST", "/projects", { snapshot })).json();
  await request("owner", "POST", `/projects/${p.id}/share`, {
    version: 1,
    visibility: "public",
    title: "Visible gallery title",
    tags: ["art"],
  });
  await request("owner", "PUT", `/projects/${p.id}`, {
    version: 2,
    snapshot: { ...snapshot, title: "SECRET DRAFT WORD", mode: "story" },
  });
  for (const q of [
    "HIDDEN PRIVATE WORD",
    "HIDDEN LINK WORD",
    "SECRET DRAFT WORD",
  ])
    assert.equal(
      (
        await request("guest", "GET", `/gallery?q=${encodeURIComponent(q)}`)
      ).json().projects.length,
      0,
    );
  const result = await request(
    "guest",
    "GET",
    "/gallery?q=Visible%20gallery%20title",
  );
  assert.equal(result.statusCode, 200, result.body);
  const visible = result.json().projects[0];
  assert.equal(visible.title, "Visible gallery title");
  assert.equal(visible.mode, "sandbox");
  assert.equal(visible.snapshot, undefined);
  assert.equal(result.body.includes("owner@example.invalid"), false);
  const body = { featured: true, revisionId: visible.revisionId };
  assert.equal(
    (await request("guest", "PATCH", `/admin/featured/${p.shortCode}`, body))
      .statusCode,
    401,
  );
  assert.equal(
    (await request("other", "PATCH", `/admin/featured/${p.shortCode}`, body))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "admin",
        "PATCH",
        `/admin/featured/${privateProject.shortCode}`,
        body,
      )
    ).statusCode,
    404,
  );
  const featured = await request(
    "admin",
    "PATCH",
    `/admin/featured/${p.shortCode}`,
    body,
  );
  assert.equal(featured.statusCode, 200, featured.body);
  assert.ok(
    (await request("guest", "GET", "/gallery?sort=featured"))
      .json()
      .projects.some((row: any) => row.shortCode === p.shortCode),
  );
  assert.equal(
    (
      await request("admin", "PATCH", `/admin/featured/${p.shortCode}`, {
        ...body,
        featured: false,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await pg.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, p.id),
            sql`${auditLog.action} like 'gallery.%'`,
          ),
        )
    ).length,
    2,
  );
  await request("owner", "POST", `/projects/${p.id}/share`, {
    version: 3,
    visibility: "public",
    title: "New public edition",
    tags: ["art"],
  });
  assert.equal(
    (
      await request("admin", "PATCH", `/admin/featured/${p.shortCode}`, body)
    ).json().error.code,
    "VERSION_CONFLICT",
  );
});
test("gallery metadata paginates equal timestamps without executing or returning source", async () => {
  const [owner] = await pg.db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.invalid"));
  const rows = await pg.db
    .insert(projects)
    .values(
      Array.from({ length: 65 }, (_, i) => ({
        ownerId: owner.id,
        title: `Gallery page ${i}`,
        snapshot: { ...snapshot },
        mode: "sandbox" as const,
        shortCode: `gallery-page-${String(i).padStart(3, "0")}`,
      })),
    )
    .returning();
  const revisions = await pg.db
    .insert(projectRevisions)
    .values(
      rows.map((p) => ({
        projectId: p.id,
        actorId: owner.id,
        number: 1,
        snapshot: { ...snapshot },
        reason: "publish",
      })),
    )
    .returning();
  for (const p of rows) {
    const r = revisions.find((r) => r.projectId === p.id)!;
    await pg.db
      .update(projects)
      .set({
        visibility: "public",
        publishedRevisionId: r.id,
        publishedAt: sql`'2026-10-18T01:02:03.123456Z'::timestamptz`,
        publishedMetadata: {
          title: p.title,
          description: "test",
          tags: ["art"],
          previewKey: null,
        },
      })
      .where(eq(projects.id, p.id));
  }
  let cursor: string | null = null;
  const codes = new Set<string>();
  do {
    const result = await request(
      "guest",
      "GET",
      `/gallery?q=Gallery%20page${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    assert.equal(result.statusCode, 200, result.body);
    const page = result.json();
    for (const p of page.projects) {
      assert.equal(p.snapshot, undefined);
      assert.equal(codes.has(p.shortCode), false);
      codes.add(p.shortCode);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(codes.size, 65);
});
test("remix pins the actual publication, creates private provenance and never grants original edit access", async () => {
  const original = (
    await request("owner", "POST", "/projects", {
      snapshot: { ...snapshot, title: "Original moon" },
    })
  ).json();
  for (const role of ["guest", "unverified"])
    assert.equal(
      (await request(role, "POST", `/shared/${original.shortCode}/remix`, {}))
        .statusCode,
      role === "guest" ? 401 : 403,
    );
  assert.equal(
    (await request("other", "POST", `/shared/${original.shortCode}/remix`, {}))
      .statusCode,
    404,
  );
  await request("owner", "POST", `/projects/${original.id}/share`, {
    version: 1,
    visibility: "unlisted",
    title: "Published moon",
    description: "Pinned description",
    tags: ["art"],
  });
  const publication = (
    await request("guest", "GET", `/shared/${original.shortCode}`)
  ).json();
  await request("owner", "PUT", `/projects/${original.id}`, {
    version: 2,
    snapshot: {
      ...snapshot,
      title: "Secret draft",
      sourceCode: 'PRINT "SECRET DRAFT"',
    },
  });
  const response = await request(
    "other",
    "POST",
    `/shared/${original.shortCode}/remix`,
    {},
  );
  assert.equal(response.statusCode, 200, response.body);
  const copy = response.json();
  assert.equal(copy.visibility, "private");
  assert.equal(copy.description, "Pinned description");
  assert.equal(copy.snapshot.sourceCode, snapshot.sourceCode);
  assert.equal(copy.snapshot.instructions, publication.snapshot.instructions);
  assert.equal(copy.title, "Published moon");
  assert.notEqual(copy.shortCode, original.shortCode);
  const [stored] = await pg.db
    .select()
    .from(projects)
    .where(eq(projects.id, copy.id));
  assert.equal(stored.remixedFromRevisionId, publication.revisionId);
  assert.equal(stored.publishedRevisionId, null);
  assert.equal(
    (await request("owner", "GET", `/projects/${copy.id}`)).statusCode,
    404,
  );
  assert.equal(
    (
      await request("other", "PUT", `/projects/${original.id}`, {
        version: 3,
        snapshot,
      })
    ).statusCode,
    404,
  );
  await request("other", "PUT", `/projects/${copy.id}`, {
    version: 1,
    snapshot: { ...copy.snapshot, sourceCode: 'PRINT "MY REMIX"' },
  });
  assert.equal(
    (await request("owner", "GET", `/projects/${original.id}`)).json().snapshot
      .sourceCode,
    'PRINT "SECRET DRAFT"',
  );
  await request("owner", "POST", `/projects/${original.id}/share`, {
    version: 3,
    visibility: "private",
  });
  assert.equal(
    (await request("other", "POST", `/shared/${original.shortCode}/remix`, {}))
      .statusCode,
    404,
  );
  await pg.db.transaction((tx) => pruneHistory(tx, original.id));
  assert.equal(
    (
      await pg.db
        .select()
        .from(projectRevisions)
        .where(eq(projectRevisions.id, publication.revisionId))
    ).length,
    1,
  );
  assert.equal(
    (await request("other", "GET", `/projects/${copy.id}`)).json().snapshot
      .sourceCode,
    'PRINT "MY REMIX"',
  );
});
test("viewer moderation blocks links/gallery/remix, requires admin and retains reason/audit", async () => {
  const p = (await request("owner", "POST", "/projects", { snapshot })).json();
  await request("owner", "POST", `/projects/${p.id}/share`, {
    version: 1,
    visibility: "public",
    title: "Moderated moon",
  });
  const publication = (
    await request("guest", "GET", `/shared/${p.shortCode}`)
  ).json();
  const body = {
    revisionId: publication.revisionId,
    reason: "Human review of unsafe content",
  };
  for (const role of ["guest", "other", "unverified"])
    assert.equal(
      (await request(role, "POST", `/admin/shared/${p.shortCode}/block`, body))
        .statusCode,
      role === "guest" ? 401 : 403,
    );
  assert.equal(
    (
      await request("admin", "POST", `/admin/shared/${p.shortCode}/block`, {
        ...body,
        reason: "  ",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("admin", "POST", `/admin/shared/${p.shortCode}/block`, {
        ...body,
        revisionId: p.id,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await request("admin", "POST", `/admin/shared/${p.shortCode}/block`, body))
      .statusCode,
    200,
  );
  assert.equal(
    (await request("guest", "GET", `/shared/${p.shortCode}`)).statusCode,
    404,
  );
  assert.equal(
    (await request("other", "POST", `/shared/${p.shortCode}/remix`, {}))
      .statusCode,
    404,
  );
  assert.equal(
    (await request("guest", "GET", "/gallery?q=Moderated%20moon")).json()
      .projects.length,
    0,
  );
  assert.equal(
    (await request("owner", "GET", `/projects/${p.id}`)).statusCode,
    200,
  );
  assert.equal(
    (
      await pg.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, p.id),
            eq(auditLog.action, "project.blocked"),
          ),
        )
    ).length,
    1,
  );
  const { moderationActions } = await import("../db/schema.js");
  assert.equal(
    (
      await pg.db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.projectId, p.id))
    )[0].reason,
    body.reason,
  );
});

test("titles, credit, pictures and restore: duplicate/remix take a client title, visibility never changes the picture, restore keeps the title", async () => {
  const created = await request("owner", "POST", "/projects", { snapshot });
  const p = created.json();
  const drawn = Buffer.alloc(256 * 192, 0);
  drawn.fill(6, 2000, 9000);
  const published = await request("owner", "POST", `/projects/${p.id}/share`, {
    version: p.version,
    visibility: "public",
    title: "Garden",
    tags: ["art"],
    previewPixels: drawn.toString("base64"),
  });
  assert.equal(published.statusCode, 200, published.body);
  let version = published.json().version;
  const key = published.json().previewUrl;
  assert.ok(key);
  const blank = Buffer.alloc(256 * 192, 0).toString("base64");
  for (const visibility of ["unlisted", "public", "unlisted"] as const) {
    const next = await request("owner", "POST", `/projects/${p.id}/share`, {
      version,
      visibility,
      title: "Garden",
      previewPixels: blank,
    });
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(
      next.json().previewUrl,
      key,
      "a blank SCREEN never replaces the picture",
    );
    version = next.json().version;
  }
  const info = (
    await request("owner", "GET", `/projects/${p.id}/share`)
  ).json();
  assert.equal(info.previewUrl, key);

  const dup = await request("owner", "POST", `/projects/${p.id}/duplicate`, {
    version,
    title: "Copy of Garden",
  });
  assert.equal(dup.statusCode, 200, dup.body);
  assert.equal(dup.json().title, "Copy of Garden");
  assert.equal(dup.json().snapshot.sourceCode, snapshot.sourceCode);
  assert.equal(dup.json().snapshot.instructions, snapshot.instructions);

  const shortCode = published.json().shortCode;
  const remix = await request("other", "POST", `/shared/${shortCode}/remix`, {
    title: "Remix of Garden",
  });
  assert.equal(remix.statusCode, 200, remix.body);
  assert.equal(remix.json().title, "Remix of Garden");
  assert.ok(
    remix.json().previewUrl,
    "the remix starts with the source picture",
  );
  assert.deepEqual(remix.json().remixedFrom, {
    title: "Garden",
    author: "owner",
    shortCode,
  });
  const reopened = (
    await request("other", "GET", `/projects/${remix.json().id}`)
  ).json();
  assert.equal(reopened.remixedFrom.title, "Garden");
  // Once the source is private again the credit no longer reveals it.
  await request("owner", "POST", `/projects/${p.id}/share`, {
    version,
    visibility: "private",
  });
  const hidden = (
    await request("other", "GET", `/projects/${remix.json().id}`)
  ).json();
  assert.deepEqual(hidden.remixedFrom, {
    title: null,
    author: null,
    shortCode: null,
  });

  // Restore brings back code, not the title.
  const history = (
    await request("owner", "GET", `/projects/${p.id}/revisions`)
  ).json();
  const oldest = history.revisions.at(-1);
  const current = (await request("owner", "GET", `/projects/${p.id}`)).json();
  const renamed = await request("owner", "PUT", `/projects/${p.id}`, {
    version: current.version,
    snapshot: {
      ...current.snapshot,
      title: "Renamed on purpose",
      sourceCode: 'PRINT "NEW"',
    },
  });
  const restored = await request(
    "owner",
    "POST",
    `/projects/${p.id}/revisions/${oldest.id}/restore`,
    { version: renamed.json().version },
  );
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().title, "Renamed on purpose");
  assert.equal(restored.json().snapshot.title, "Renamed on purpose");
  assert.equal(restored.json().snapshot.sourceCode, snapshot.sourceCode);
});
