import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { hashPassword } from "../auth.js";
import { hashToken, sessionCookie } from "../access.js";
import { users, sessions, projects, projectPreviews } from "../db/schema.js";
import { Mailer, MemoryMail } from "../mail.js";
import { previewPng } from "../preview-image.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  cookie: string,
  p: { id: string; version: number; shortCode: string },
  publicUrl: string;
const roles = ["owner", "stranger", "admin", "unverified"],
  ids: Record<string, string> = {},
  tokens: Record<string, string> = {},
  password = "Preview deletion testing password";
const red = Buffer.alloc(49152, 10).toString("base64"),
  green = Buffer.alloc(49152, 12).toString("base64"),
  blue = Buffer.alloc(49152, 9).toString("base64");
const config = {
  baseUrl: "http://localhost:5173",
  secureCookies: false,
  adminEmail: "admin@example.invalid",
  sessionDays: 14,
  mailer: new Mailer(new MemoryMail(), "http://localhost:5173"),
};
const snapshot = {
  format: "randusr",
  version: 2,
  title: "Private moon",
  sourceCode: 'PRINT "НЕ ПУБЛИКУЙ ЭТОТ КОД"',
  mode: "sandbox",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  storyId: "tower",
  sceneId: 0,
  unlocked: 0,
  exampleId: null,
};
async function request(
  who: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: path.startsWith("/api/") ? path : `/api/v1${path}`,
    payload,
    headers: {
      origin: config.baseUrl,
      "x-csrf-token": csrf,
      cookie: `${cookie}; ${sessionCookie}=${tokens[who] ?? ""}`,
    },
  });
}
async function assetCount(id = p.id) {
  return (
    await pg.db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectPreviews)
      .where(eq(projectPreviews.projectId, id))
  )[0].n;
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
          email: `preview-${role}@example.invalid`,
          displayName: role,
          passwordHash: hash,
          verifiedAt: role === "unverified" ? null : new Date(),
          isAdmin: role === "admin",
        })
        .returning();
      ids[role] = u.id;
      tokens[role] = randomBytes(32).toString("base64url");
      await pg.db
        .insert(sessions)
        .values({
          userId: u.id,
          tokenHash: hashToken(tokens[role]),
          expiresAt: new Date(Date.now() + 600000),
        });
    }
    app = buildApp(pg.db, false, config);
    const r = await app.inject("/api/v1/auth/csrf");
    csrf = r.json().token;
    cookie = `${r.cookies[0].name}=${r.cookies[0].value}`;
    p = (await request("owner", "POST", "/projects", { snapshot })).json();
  },
  { timeout: 150000 },
);
after(async () => {
  await app?.close();
  await pg?.stop();
});
test("palette-only codec generates bounded 256x192 PNG; arbitrary files, dimensions and pixel values are rejected", () => {
  const encoded = Buffer.from(
      Array.from({ length: 49152 }, (_, i) => i % 16),
    ).toString("base64"),
    png = previewPng(encoded);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 192);
  assert.equal(png[25], 3);
  assert.ok(png.length < 60000);
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const n = png.readUInt32BE(offset),
      type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") data.push(png.subarray(offset + 8, offset + 8 + n));
    offset += 12 + n;
  }
  const rows = inflateSync(Buffer.concat(data));
  assert.equal(rows.length, 192 * 257);
  for (let y = 0; y < 192; y++) {
    assert.equal(rows[y * 257], 0);
    assert.deepEqual(
      rows.subarray(y * 257 + 1, (y + 1) * 257),
      Buffer.from(encoded, "base64").subarray(y * 256, (y + 1) * 256),
    );
  }
  for (const value of [
    "<svg onload=evil/>",
    red.slice(1),
    red + "=",
    Buffer.alloc(49152, 16).toString("base64"),
    png.toString("base64"),
  ])
    assert.throws(() => previewPng(value));
});
test("manual preview is owner-only content-free metadata, leaves source version unchanged and denies foreign/admin/unverified access", async () => {
  const r = await request("owner", "POST", `/projects/${p.id}/preview`, {
    version: p.version,
    pixels: red,
  });
  assert.equal(r.statusCode, 200, r.body);
  const url = r.json().previewUrl;
  assert.equal(r.json().version, p.version);
  const own = await request("owner", "GET", url);
  assert.equal(own.statusCode, 200, own.body);
  assert.equal(own.headers["content-type"], "image/png");
  assert.equal(own.headers["cache-control"], "no-store");
  assert.equal(own.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(own.rawPayload, previewPng(red));
  for (const role of ["guest", "stranger", "admin", "unverified"]) {
    const denied = await request(role, "GET", url);
    assert.equal(
      denied.statusCode,
      role === "guest" ? 401 : role === "unverified" ? 403 : 404,
    );
  }
  for (const pixels of [
    red.slice(1),
    Buffer.alloc(49152, 255).toString("base64"),
  ])
    assert.equal(
      (
        await request("owner", "POST", `/projects/${p.id}/preview`, {
          version: p.version,
          pixels,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await request("stranger", "POST", `/projects/${p.id}/preview`, {
        version: p.version,
        pixels: green,
      })
    ).statusCode,
    404,
  );
  const unchanged = (await request("owner", "GET", `/projects/${p.id}`)).json();
  assert.equal(unchanged.version, p.version);
  assert.equal(unchanged.snapshot.sourceCode, snapshot.sourceCode);
  assert.equal(unchanged.previewUrl, url);
  assert.equal(await assetCount(), 1);
  const page = (await request("owner", "GET", "/projects")).json();
  assert.equal(page.projects[0].previewUrl, url);
  assert.equal(JSON.stringify(page).includes("png"), false);
});
test("publication pins its actual image while later private preview changes cannot leak through public URLs", async () => {
  const publication = await request(
    "owner",
    "POST",
    `/projects/${p.id}/share`,
    {
      version: p.version,
      visibility: "public",
      title: "Moon in red",
      description: "Change the colours",
      tags: ["art"],
      previewPixels: green,
    },
  );
  assert.equal(publication.statusCode, 200, publication.body);
  p = publication.json();
  const shared = (
    await request("guest", "GET", `/shared/${p.shortCode}`)
  ).json();
  publicUrl = shared.previewUrl;
  assert.deepEqual(
    (await request("guest", "GET", publicUrl)).rawPayload,
    previewPng(green),
  );
  assert.equal(await assetCount(), 1);
  const gallery = (
    await request("guest", "GET", "/gallery?tag=art&q=Moon")
  ).json();
  assert.equal(gallery.projects[0].previewUrl, publicUrl);
  assert.equal(JSON.stringify(gallery).includes(snapshot.sourceCode), false);
  const newer = await request("owner", "POST", `/projects/${p.id}/preview`, {
    version: p.version,
    pixels: blue,
  });
  assert.equal(newer.statusCode, 200, newer.body);
  const privateKey = newer.json().previewUrl.split("/").at(-1);
  assert.equal(await assetCount(), 2);
  assert.deepEqual(
    (await request("guest", "GET", publicUrl)).rawPayload,
    previewPng(green),
  );
  assert.equal(
    (
      await request(
        "guest",
        "GET",
        `/shared/${p.shortCode}/preview/${privateKey}`,
      )
    ).statusCode,
    404,
  );
  const changed = await request("owner", "PUT", `/projects/${p.id}`, {
    version: p.version,
    snapshot: { ...snapshot, sourceCode: 'PRINT "PRIVATE NEW DRAFT"' },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  p = changed.json();
  const stale = await request("owner", "POST", `/projects/${p.id}/preview`, {
    version: 1,
    pixels: red,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(await assetCount(), 2);
});
test("concurrent private capture cannot replace a publish frame; link rotation and moderation close image access", async () => {
  const results = await Promise.all([
    request("owner", "POST", `/projects/${p.id}/share`, {
      version: p.version,
      visibility: "unlisted",
      title: "Pinned frame",
      tags: ["game"],
      previewPixels: red,
    }),
    request("owner", "POST", `/projects/${p.id}/preview`, {
      version: p.version,
      pixels: blue,
    }),
  ]);
  assert.equal(results[0].statusCode, 200, results[0].body);
  assert.ok([200, 409].includes(results[1].statusCode));
  p = results[0].json();
  const shared = (
    await request("guest", "GET", `/shared/${p.shortCode}`)
  ).json();
  assert.deepEqual(
    (await request("guest", "GET", shared.previewUrl)).rawPayload,
    previewPng(red),
  );
  const old = shared.previewUrl;
  const rotated = await request(
    "owner",
    "POST",
    `/projects/${p.id}/share/rotate`,
    { version: p.version },
  );
  assert.equal(rotated.statusCode, 200, rotated.body);
  p = (await request("owner", "GET", `/projects/${p.id}`)).json();
  assert.equal((await request("guest", "GET", old)).statusCode, 404);
  publicUrl = (await request("guest", "GET", `/shared/${p.shortCode}`)).json()
    .previewUrl;
  assert.equal((await request("guest", "GET", publicUrl)).statusCode, 200);
  await pg.db
    .update(projects)
    .set({ moderationState: "blocked" })
    .where(eq(projects.id, p.id));
  assert.equal((await request("guest", "GET", publicUrl)).statusCode, 404);
  await pg.db
    .update(projects)
    .set({ moderationState: "active" })
    .where(eq(projects.id, p.id));
  await pg.db
    .update(users)
    .set({ state: "suspended" })
    .where(eq(users.id, ids.owner));
  assert.equal((await request("guest", "GET", publicUrl)).statusCode, 404);
  await pg.db
    .update(users)
    .set({ state: "active" })
    .where(eq(users.id, ids.owner));
});
test("new API instance reads persisted PNG; export is owner-only and project/account deletion removes owned image bytes", async () => {
  const before = (await request("guest", "GET", publicUrl)).rawPayload;
  await app.close();
  app = buildApp(pg.db, false, config);
  assert.deepEqual(
    (await request("guest", "GET", publicUrl)).rawPayload,
    before,
  );
  const foreign = (
    await request("stranger", "POST", "/projects", { snapshot })
  ).json();
  const foreignPreview = await request(
    "stranger",
    "POST",
    `/projects/${foreign.id}/preview`,
    { version: foreign.version, pixels: green },
  );
  assert.equal(foreignPreview.statusCode, 200, foreignPreview.body);
  const exported = await request("owner", "GET", "/account/export");
  assert.equal(exported.statusCode, 200, exported.body);
  const rows = exported.body
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x));
  const previews = rows.filter((x) => x.recordType === "projectPreview");
  assert.equal(previews.length, await assetCount());
  assert.ok(previews.length > 0);
  for (const row of previews) {
    assert.equal(row.data.project_id, p.id);
    const png = Buffer.from(row.data.png_base64, "base64");
    assert.equal(png.length, row.data.byte_length);
    assert.equal(
      createHash("sha256").update(png).digest("hex"),
      row.data.sha256,
    );
  }
  assert.equal(exported.body.includes(foreign.id), false);
  const disposable = (
    await request("owner", "POST", "/projects", { snapshot })
  ).json();
  await request("owner", "POST", `/projects/${disposable.id}/preview`, {
    version: disposable.version,
    pixels: blue,
  });
  assert.equal(await assetCount(disposable.id), 1);
  assert.equal(
    (
      await request("owner", "DELETE", `/projects/${disposable.id}`, {
        version: disposable.version,
      })
    ).statusCode,
    200,
  );
  assert.equal(await assetCount(disposable.id), 0);
  const deleted = await request("owner", "POST", "/account/delete", {
    currentPassword: password,
    confirmEmail: "preview-owner@example.invalid",
  });
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(await assetCount(), 0);
  assert.equal(await assetCount(foreign.id), 1);
  assert.equal((await request("guest", "GET", publicUrl)).statusCode, 404);
});
