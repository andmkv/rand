import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { DemoStore } from "../demo-store.js";
import { readDemoConfig } from "../demo-config.js";
import { demoCookie } from "../demo.js";
import { users, sessions, projects } from "../db/schema.js";
import { hashToken, sessionCookie } from "../access.js";
import { Mailer, MemoryMail } from "../mail.js";
import type { ProjectSnapshot } from "../../shared/project.js";
import { instructionsMax } from "../../shared/limits.js";

let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  store: DemoStore,
  csrf: string,
  csrfCookie: string;
const time = { value: 1_700_000_000_000 };
const origin = "http://localhost:5173";

const snapshot = (
  title = "Demo project",
  instructions = "← → — движение\n日本語 🎮 <script>alert(1)</script>",
): ProjectSnapshot => {
  const at = new Date(time.value).toISOString();
  return {
    format: "randusr",
    version: 2,
    title,
    instructions,
    sourceCode: 'CLS\nPAPER 1\nTEXT 10,20,"Привет"',
    mode: "sandbox",
    createdAt: at,
    updatedAt: at,
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: null,
  };
};

async function call(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: {
    demo?: string;
    prod?: string;
    payload?: unknown;
    csrf?: boolean;
  } = {},
) {
  const cookie = [
    csrfCookie,
    options.demo ? `${demoCookie}=${options.demo}` : "",
    options.prod ? `${sessionCookie}=${options.prod}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return app.inject({
    method,
    url: path,
    payload: options.payload,
    headers: {
      origin,
      ...(options.csrf === false ? {} : { "x-csrf-token": csrf }),
      cookie,
    },
  });
}

async function loginDemo(body: Record<string, string> = {}) {
  const response = await call("POST", "/api/v1/auth/demo", { payload: body });
  assert.equal(response.statusCode, 200, response.body);
  const session = response.cookies.find((c) => c.name === demoCookie);
  assert.ok(session, "demo session cookie set");
  assert.ok(
    response.cookies.some((c) => c.name === "randusr_demo"),
    "readable demo marker set",
  );
  return { token: session!.value, body: response.json() };
}

before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    store = new DemoStore(
      readDemoConfig({
        DEMO_LOGIN_PER_15_MINUTES: "100",
        DEMO_MAX_SESSIONS: "100",
        DEMO_MAX_SESSIONS_PER_IP: "50",
      }),
      () => time.value,
      0,
    );
    app = buildApp(
      pg.db,
      false,
      {
        baseUrl: origin,
        secureCookies: false,
        adminEmail: "admin@example.invalid",
        sessionDays: 14,
        publicRegistrationEnabled: false,
        mailer: new Mailer(new MemoryMail(), origin),
      },
      undefined,
      store,
    );
    const response = await app.inject("/api/v1/auth/csrf");
    csrf = response.json().token;
    const cookie = response.cookies.find((c) => c.name === "randusr_csrf")!;
    csrfCookie = `${cookie.name}=${cookie.value}`;
  },
  { timeout: 150000 },
);
after(async () => {
  await app?.close();
  await pg?.stop();
});

test("demo login: Try Demo, demo/demo, wrong password, CSRF and disabled admin", async () => {
  const first = await loginDemo();
  assert.equal(first.body.principal.demo, true);
  assert.equal(first.body.principal.verified, true);
  assert.equal(first.body.principal.isAdmin, false);

  const explicit = await loginDemo({ username: "demo", password: "demo" });
  assert.equal(explicit.body.principal.demo, true);

  const wrong = await call("POST", "/api/v1/auth/demo", {
    payload: { username: "demo", password: "wrong" },
  });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().error.code, "INVALID_CREDENTIALS");

  const noCsrf = await call("POST", "/api/v1/auth/demo", {
    payload: {},
    csrf: false,
  });
  assert.equal(noCsrf.statusCode, 403);
  assert.equal(noCsrf.json().error.code, "CSRF_FAILED");

  const session = await call("GET", "/api/v1/demo/session", {
    demo: first.token,
  });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().principal.isAdmin, false);
});

test("demo keeps the chosen language in the session and rejects unknown ones", async () => {
  const { token } = await loginDemo({ locale: "en" });
  const before = await call("GET", "/api/v1/demo/auth/me", { demo: token });
  assert.equal(before.json().locale, "en");

  const updated = await call("PATCH", "/api/v1/demo/account", {
    demo: token,
    payload: { locale: "ru" },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().locale, "ru");
  const me = await call("GET", "/api/v1/demo/auth/me", { demo: token });
  assert.equal(me.json().locale, "ru", "the session, not the client, holds the choice");

  const unsupported = await call("PATCH", "/api/v1/demo/account", {
    demo: token,
    payload: { locale: "zz" },
  });
  assert.equal(unsupported.statusCode, 400);
  const unknownField = await call("PATCH", "/api/v1/demo/account", {
    demo: token,
    payload: { displayName: "Someone else" },
  });
  assert.equal(unknownField.statusCode, 400);
  const noCsrf = await call("PATCH", "/api/v1/demo/account", {
    demo: token,
    payload: { locale: "de" },
    csrf: false,
  });
  assert.equal(noCsrf.statusCode, 403);
  const anonymous = await call("PATCH", "/api/v1/demo/account", {
    payload: { locale: "de" },
  });
  assert.equal(anonymous.statusCode, 401);
});

test("demo project lifecycle: create, autosave, reopen, list, duplicate, archive", async () => {
  const { token } = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: token,
    payload: { snapshot: snapshot("First", "Original controls\n日本語 🎮") },
  });
  assert.equal(created.statusCode, 200, created.body);
  const project = created.json();
  assert.equal(project.visibility, "private");
  assert.equal(project.version, 1);
  assert.match(project.id, /^[0-9a-f-]{36}$/);
  assert.match(project.shortCode, /^[A-Za-z0-9_-]{16}$/);

  const saved = await call("PUT", `/api/v1/demo/projects/${project.id}`, {
    demo: token,
    payload: {
      version: 1,
      snapshot: snapshot("Saved", "Changed controls\n<img src=x>"),
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().version, 2);
  assert.equal(saved.json().title, "Saved");
  assert.equal(
    saved.json().snapshot.instructions,
    "Changed controls\n<img src=x>",
  );

  const stale = await call("PUT", `/api/v1/demo/projects/${project.id}`, {
    demo: token,
    payload: { version: 1, snapshot: snapshot("Stale") },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, "VERSION_CONFLICT");

  const reopened = await call("GET", `/api/v1/demo/projects/${project.id}`, {
    demo: token,
  });
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.json().title, "Saved");
  assert.equal(reopened.json().snapshot.sourceCode.includes("Привет"), true);
  assert.equal(
    reopened.json().snapshot.instructions,
    "Changed controls\n<img src=x>",
  );

  const list = await call("GET", "/api/v1/demo/projects?archived=false", {
    demo: token,
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().projects.length, 1);

  const duplicate = await call(
    "POST",
    `/api/v1/demo/projects/${project.id}/duplicate`,
    { demo: token, payload: { version: 2 } },
  );
  assert.equal(duplicate.statusCode, 200);
  assert.notEqual(duplicate.json().id, project.id);
  assert.equal(duplicate.json().version, 1);
  assert.equal(
    duplicate.json().snapshot.instructions,
    "Changed controls\n<img src=x>",
  );

  const archived = await call("PATCH", `/api/v1/demo/projects/${project.id}`, {
    demo: token,
    payload: { version: 2, archived: true },
  });
  assert.equal(archived.statusCode, 200);
  assert.equal(archived.json().archived, true);
});

test("legacy demo snapshots default instructions and enforce the shared length limit", async () => {
  const { token } = await loginDemo();
  const legacySnapshot = {
    ...snapshot("Old format"),
  } as Partial<ProjectSnapshot>;
  delete legacySnapshot.instructions;
  const legacy = await call("POST", "/api/v1/demo/projects", {
    demo: token,
    payload: { snapshot: legacySnapshot },
  });
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(legacy.json().snapshot.instructions, "");

  const oversized = await call("POST", "/api/v1/demo/projects", {
    demo: token,
    payload: {
      snapshot: {
        ...snapshot(),
        instructions: "🎮".repeat(instructionsMax + 1),
      },
    },
  });
  assert.equal(oversized.statusCode, 400);
});

test("revision history and restore", async () => {
  const { token } = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: token,
    payload: { snapshot: snapshot("v1", "v1 controls") },
  });
  const id = created.json().id;
  await call("PUT", `/api/v1/demo/projects/${id}`, {
    demo: token,
    payload: { version: 1, snapshot: snapshot("v2", "v2 controls") },
  });
  await call("PUT", `/api/v1/demo/projects/${id}`, {
    demo: token,
    payload: { version: 2, snapshot: snapshot("v3", "v3 controls") },
  });
  const history = await call("GET", `/api/v1/demo/projects/${id}/revisions`, {
    demo: token,
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().revisions.length, 3);
  const oldest = history.json().revisions.at(-1);
  const restored = await call(
    "POST",
    `/api/v1/demo/projects/${id}/revisions/${oldest.id}/restore`,
    { demo: token, payload: { version: 3 } },
  );
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().title, "v3");
  assert.equal(restored.json().snapshot.title, "v3");
  assert.equal(restored.json().snapshot.instructions, "v1 controls");
  assert.equal(restored.json().version, 4);
  const after = await call("GET", `/api/v1/demo/projects/${id}/revisions`, {
    demo: token,
  });
  assert.equal(after.json().revisions[0].summary.startsWith("CLS"), true);
});

test("unlisted share opens anonymously and its preview is temporary", async () => {
  const { token } = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: token,
    payload: { snapshot: snapshot("Share me") },
  });
  const p = created.json();
  const frame = Buffer.alloc(256 * 192, 0);
  frame.fill(4, 200, 900);
  const pixels = frame.toString("base64");
  const shared = await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
    demo: token,
    payload: {
      version: 1,
      visibility: "unlisted",
      title: "Share me",
      description: "temporary",
      tags: ["art"],
      previewPixels: pixels,
    },
  });
  assert.equal(shared.statusCode, 200, shared.body);
  const code = shared.json().shortCode;
  assert.equal(shared.json().visibility, "unlisted");

  const anonymous = await call("GET", `/api/v1/shared/${code}`);
  assert.equal(anonymous.statusCode, 200);
  const body = anonymous.json();
  assert.equal(body.demo, true);
  assert.equal(body.visibility, "unlisted");
  assert.equal(body.title, "Share me");
  assert.equal(body.author.displayName, "Demo tester");
  assert.equal(body.snapshot.title, "Share me");
  assert.equal(
    body.snapshot.instructions,
    "← → — движение\n日本語 🎮 <script>alert(1)</script>",
  );

  const draft = await call("PUT", "/api/v1/demo/projects/" + p.id, {
    demo: token,
    payload: {
      version: 2,
      snapshot: snapshot("Draft", "Draft instructions\n🎮"),
    },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  const stillPublished = await call("GET", "/api/v1/shared/" + code);
  assert.equal(
    stillPublished.json().snapshot.instructions,
    body.snapshot.instructions,
  );
  assert.match(body.previewUrl, new RegExp(`/api/v1/shared/${code}/preview/`));
  assert.equal(anonymous.headers["x-robots-tag"], "noindex, nofollow");

  const key = body.previewUrl.split("/").at(-1);
  const preview = await call("GET", `/api/v1/shared/${code}/preview/${key}`);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.headers["content-type"], "image/png");
  assert.equal(preview.rawPayload.length > 100, true);

  // The same publication is visible through the demo-scoped route to its owner.
  const ownerView = await call("GET", `/api/v1/demo/shared/${code}`, {
    demo: token,
  });
  assert.equal(ownerView.statusCode, 200);
  assert.equal(ownerView.json().ownerProjectId, p.id);
});

test("private demo shares do not leak and public demo projects stay out of the real gallery", async () => {
  const a = await loginDemo();
  const b = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: a.token,
    payload: { snapshot: snapshot("Private") },
  });
  const p = created.json();
  assert.equal(
    (await call("GET", `/api/v1/shared/${p.shortCode}`)).statusCode,
    404,
  );
  assert.equal(
    (await call("GET", `/api/v1/demo/shared/${p.shortCode}`, { demo: b.token }))
      .statusCode,
    404,
  );

  const published = await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
    demo: a.token,
    payload: {
      version: 1,
      visibility: "public",
      title: "Public demo",
      tags: ["game"],
    },
  });
  assert.equal(published.statusCode, 200, published.body);
  const code = published.json().shortCode;
  assert.equal((await call("GET", `/api/v1/shared/${code}`)).statusCode, 200);

  const gallery = await call("GET", "/api/v1/demo/gallery", { demo: a.token });
  assert.equal(gallery.statusCode, 200);
  assert.equal(gallery.json().projects.length, 1);
  assert.equal(gallery.json().projects[0].shortCode, code);
  assert.equal(gallery.json().projects[0].author, "Demo tester");

  // The real public gallery is PostgreSQL-only.
  const real = await call("GET", "/api/v1/gallery");
  assert.equal(real.statusCode, 200);
  assert.equal(
    real
      .json()
      .projects.some((row: { shortCode: string }) => row.shortCode === code),
    false,
  );

  // Another demo session sees its own empty gallery.
  const other = await call("GET", "/api/v1/demo/gallery", { demo: b.token });
  assert.equal(other.json().projects.length, 0);
});

test("remix creates an independent copy and cross-session remix is refused", async () => {
  const a = await loginDemo();
  const b = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: a.token,
    payload: { snapshot: snapshot("Original") },
  });
  const p = created.json();
  await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
    demo: a.token,
    payload: { version: 1, visibility: "public", title: "Original" },
  });
  const copy = await call("POST", `/api/v1/demo/shared/${p.shortCode}/remix`, {
    demo: a.token,
    payload: {},
  });
  assert.equal(copy.statusCode, 200, copy.body);
  assert.notEqual(copy.json().id, p.id);
  assert.equal(copy.json().visibility, "private");
  assert.equal(copy.json().snapshot.title, "Original");
  assert.equal(
    copy.json().snapshot.instructions,
    "← → — движение\n日本語 🎮 <script>alert(1)</script>",
  );

  const foreign = await call(
    "POST",
    `/api/v1/demo/shared/${p.shortCode}/remix`,
    { demo: b.token, payload: {} },
  );
  assert.equal(foreign.statusCode, 403);
  assert.equal(foreign.json().error.code, "DEMO_FOREIGN_REMIX");
  const view = await call("GET", `/api/v1/demo/shared/${p.shortCode}`, {
    demo: b.token,
  });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().remixable, false);
  assert.equal(
    (
      await call("GET", `/api/v1/demo/shared/${p.shortCode}`, { demo: a.token })
    ).json().remixable,
    true,
  );
  assert.equal(
    (await call("GET", "/api/v1/demo/projects", { demo: b.token })).json()
      .projects.length,
    0,
  );
});

test("remix and duplicate accept a localized title, credit the source and copy its picture", async () => {
  const a = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: a.token,
    payload: { snapshot: snapshot("Garden") },
  });
  const p = created.json();
  const pixels = Buffer.alloc(256 * 192, 3);
  pixels[100] = 5;
  await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
    demo: a.token,
    payload: {
      version: 1,
      visibility: "public",
      title: "Garden",
      previewPixels: pixels.toString("base64"),
    },
  });
  const copy = await call("POST", `/api/v1/demo/shared/${p.shortCode}/remix`, {
    demo: a.token,
    payload: { title: "Remix of Garden" },
  });
  assert.equal(copy.statusCode, 200, copy.body);
  assert.equal(copy.json().title, "Remix of Garden");
  assert.ok(copy.json().previewUrl, "remix starts with the source picture");
  const reopened = await call(
    "GET",
    `/api/v1/demo/projects/${copy.json().id}`,
    {
      demo: a.token,
    },
  );
  assert.deepEqual(reopened.json().remixedFrom, {
    title: "Garden",
    author: "Demo tester",
    shortCode: p.shortCode,
  });
  const dup = await call("POST", `/api/v1/demo/projects/${p.id}/duplicate`, {
    demo: a.token,
    payload: { version: 2, title: "Copy of Garden" },
  });
  assert.equal(dup.statusCode, 200, dup.body);
  assert.equal(dup.json().title, "Copy of Garden");
  assert.equal(dup.json().snapshot.sourceCode, snapshot().sourceCode);
  // The source keeps its title; unpublishing it degrades the credit gracefully.
  await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
    demo: a.token,
    payload: { version: 2, visibility: "private" },
  });
  const gone = await call("GET", `/api/v1/demo/projects/${copy.json().id}`, {
    demo: a.token,
  });
  assert.deepEqual(gone.json().remixedFrom, {
    title: null,
    author: null,
    shortCode: null,
  });
});

test("changing visibility never replaces the published picture and a blank SCREEN is ignored", async () => {
  const a = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: a.token,
    payload: { snapshot: snapshot("Moon") },
  });
  const p = created.json();
  const drawn = Buffer.alloc(256 * 192, 0);
  drawn.fill(6, 1000, 5000);
  const first = await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
    demo: a.token,
    payload: {
      version: 1,
      visibility: "unlisted",
      title: "Moon",
      previewPixels: drawn.toString("base64"),
    },
  });
  assert.equal(first.statusCode, 200, first.body);
  const key = first.json().previewUrl;
  assert.ok(key);
  let version = first.json().version;
  const blank = Buffer.alloc(256 * 192, 0).toString("base64");
  for (const visibility of ["public", "unlisted", "public"] as const) {
    const next = await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
      demo: a.token,
      payload: { version, visibility, title: "Moon", previewPixels: blank },
    });
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(next.json().previewUrl, key);
    version = next.json().version;
  }
  const info = await call("GET", `/api/v1/demo/projects/${p.id}/share`, {
    demo: a.token,
  });
  assert.equal(info.json().previewUrl, key);
});

test("an expired demo link is expired for other demo sessions too", async () => {
  const a = await loginDemo();
  const b = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: a.token,
    payload: { snapshot: snapshot("Gone soon") },
  });
  const p = created.json();
  await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
    demo: a.token,
    payload: { version: 1, visibility: "unlisted", title: "Gone soon" },
  });
  await call("POST", "/api/v1/demo/auth/logout", { demo: a.token });
  const other = await call("GET", `/api/v1/demo/shared/${p.shortCode}`, {
    demo: b.token,
  });
  assert.equal(other.statusCode, 410);
  assert.equal(other.json().error.code, "DEMO_EXPIRED");
  const never = await call("GET", "/api/v1/demo/shared/AAAAAAAAAAAAAAAA", {
    demo: b.token,
  });
  assert.equal(never.statusCode, 404);
});

test("three demo sessions work concurrently without sharing data", async () => {
  const sessions = await Promise.all([loginDemo(), loginDemo(), loginDemo()]);
  const created = await Promise.all(
    sessions.map((session, index) =>
      call("POST", "/api/v1/demo/projects", {
        demo: session.token,
        payload: { snapshot: snapshot(`Concurrent ${index}`) },
      }),
    ),
  );
  assert.equal(
    created.every((r) => r.statusCode === 200),
    true,
  );
  for (const [index, session] of sessions.entries()) {
    const list = await call("GET", "/api/v1/demo/projects", {
      demo: session.token,
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().projects.length, 1);
    assert.equal(list.json().projects[0].title, `Concurrent ${index}`);
    // Another session's project id is not readable.
    const foreign = created[(index + 1) % sessions.length].json();
    const read = await call("GET", `/api/v1/demo/projects/${foreign.id}`, {
      demo: session.token,
    });
    assert.equal(read.statusCode, 404);
    const gallery = await call("GET", "/api/v1/demo/gallery", {
      demo: session.token,
    });
    assert.equal(gallery.json().projects.length, 0);
  }
});

test("demo cannot reach admin or production project APIs", async () => {
  const { token } = await loginDemo();
  const admin = await call("GET", "/api/v1/admin/users", { demo: token });
  assert.equal(admin.statusCode, 401);
  for (const [method, path] of [
    ["GET", "/api/v1/admin/invitations"],
    ["POST", "/api/v1/admin/invitations"],
  ] as const)
    assert.equal(
      (
        await call(method, path, {
          demo: token,
          payload:
            method === "POST"
              ? { email: "a@example.invalid", adultTester: true }
              : undefined,
        })
      ).statusCode,
      401,
    );
  const prod = await call("GET", "/api/v1/projects", { demo: token });
  assert.equal(prod.statusCode, 401);
  const session = await call("GET", "/api/v1/session", { demo: token });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().principal, null);
  const demoAdmin = await call("GET", "/api/v1/demo/admin/users", {
    demo: token,
  });
  assert.equal(demoAdmin.statusCode, 404);
});

test("DEMO_MODE_ENABLED=false removes the login endpoint and demo routes", async () => {
  const disabled = buildApp(
    pg.db,
    false,
    {
      baseUrl: origin,
      secureCookies: false,
      adminEmail: "admin@example.invalid",
      sessionDays: 14,
      publicRegistrationEnabled: false,
      mailer: new Mailer(new MemoryMail(), origin),
    },
    undefined,
    null,
  );
  try {
    const policy = await disabled.inject("/api/v1/auth/policy");
    assert.equal(policy.statusCode, 200);
    assert.equal(policy.json().demoEnabled, false);
    const login = await disabled.inject({
      method: "POST",
      url: "/api/v1/auth/demo",
      payload: {},
      headers: {
        origin,
        "x-csrf-token": csrf,
        cookie: csrfCookie,
      },
    });
    assert.equal(login.statusCode, 404);
    const demo = await disabled.inject({
      method: "GET",
      url: "/api/v1/demo/session",
      headers: { origin, cookie: csrfCookie },
    });
    assert.equal(demo.statusCode, 404);
  } finally {
    await disabled.close();
  }
});

test("a real registered owner is unaffected and demo rows never reach PostgreSQL", async () => {
  const token = randomBytes(32).toString("base64url");
  const [owner] = await pg.db
    .insert(users)
    .values({
      email: "owner@example.invalid",
      displayName: "Real owner",
      passwordHash: "not-used",
      verifiedAt: new Date(),
    })
    .returning();
  await pg.db.insert(sessions).values({
    userId: owner.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 600000),
  });
  const created = await call("POST", "/api/v1/projects", {
    prod: token,
    payload: { snapshot: snapshot("Real project") },
  });
  assert.equal(created.statusCode, 200, created.body);
  const realId = created.json().id;

  const demo = await loginDemo();
  const demoList = await call("GET", "/api/v1/demo/projects", {
    demo: demo.token,
  });
  assert.equal(
    demoList.json().projects.some((p: { id: string }) => p.id === realId),
    false,
  );
  const demoRead = await call("GET", `/api/v1/demo/projects/${realId}`, {
    demo: demo.token,
  });
  assert.equal(demoRead.statusCode, 404);

  const prodWithDemo = await call("GET", "/api/v1/projects", {
    prod: demo.token,
  });
  assert.equal(prodWithDemo.statusCode, 401);
  // A production session cannot authenticate demo routes either.
  const demoWithProd = await call("GET", "/api/v1/demo/projects", {
    prod: token,
  });
  assert.equal(demoWithProd.statusCode, 401);

  const [counts] = await pg.db
    .select({
      demoUsers: sql<number>`count(*) filter (where ${users.email} like 'demo%')::int`,
      allUsers: sql<number>`count(*)::int`,
    })
    .from(users);
  assert.equal(counts.demoUsers, 0);
  assert.equal(counts.allUsers, 1); // only the real owner inserted above
  const [projectCount] = await pg.db
    .select({ n: sql<number>`count(*)::int` })
    .from(projects);
  assert.equal(projectCount.n, 1);
});

test("logout and expiry revoke access to data and links", async () => {
  const a = await loginDemo();
  const created = await call("POST", "/api/v1/demo/projects", {
    demo: a.token,
    payload: { snapshot: snapshot("Disposable") },
  });
  const p = created.json();
  await call("POST", `/api/v1/demo/projects/${p.id}/share`, {
    demo: a.token,
    payload: { version: 1, visibility: "public", title: "Disposable" },
  });
  const logout = await call("POST", "/api/v1/demo/auth/logout", {
    demo: a.token,
  });
  assert.equal(logout.statusCode, 200);
  assert.equal(
    (await call("GET", "/api/v1/demo/projects", { demo: a.token })).statusCode,
    401,
  );
  assert.equal(
    (await call("GET", `/api/v1/shared/${p.shortCode}`)).statusCode,
    410,
  );

  const b = await loginDemo();
  const second = await call("POST", "/api/v1/demo/projects", {
    demo: b.token,
    payload: { snapshot: snapshot("Expires") },
  });
  await call("POST", `/api/v1/demo/projects/${second.json().id}/share`, {
    demo: b.token,
    payload: { version: 1, visibility: "public", title: "Expires" },
  });
  time.value += readDemoConfig({}).idleMs + 1000;
  store.sweep();
  assert.equal(
    (await call("GET", "/api/v1/demo/session", { demo: b.token })).statusCode,
    401,
  );
  const expired = await call(
    "GET",
    `/api/v1/shared/${second.json().shortCode}`,
  );
  assert.equal(expired.statusCode, 410);
  assert.equal(expired.json().error.code, "DEMO_EXPIRED");
});
