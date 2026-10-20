import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
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
  userAssets,
  userAssetVersions,
} from "../db/schema.js";
import { Mailer, MemoryMail } from "../mail.js";
import type { ProjectSnapshot } from "../../shared/project.js";
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  csrfCookie: string,
  scenario = 0;
const roles = ["admin", "spare", "teacher", "student"],
  ids: Record<string, string> = {},
  tokens: Record<string, string> = {},
  password = "Lifecycle test password 123";
const snapshot: ProjectSnapshot = {
  format: "randusr",
  version: 2,
  title: "Private original",
  sourceCode: 'PRINT "ERASE THIS"',
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
    remoteAddress: `192.3.${scenario}.${roles.indexOf(role) + 2}`,
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
          email: `lifecycle-${role}@example.invalid`,
          displayName: `${role} private name`,
          passwordHash: hash,
          verifiedAt: new Date(),
          isAdmin: ["admin", "spare"].includes(role),
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
    csrfCookie = `${r.cookies[0].name}=${r.cookies[0].value}`;
  },
  { timeout: 150000 },
);
after(async () => {
  await app?.close();
  await pg?.stop();
});
test("account deletion cannot remove the last active verified admin, even concurrently", async () => {
  scenario++;
  await request("admin", "POST", `/admin/users/${ids.spare}/state`, {
    state: "suspended",
    reason: "Test guard",
  });
  const denied = await request(
    "admin",
    "POST",
    `/admin/users/${ids.admin}/delete`,
    { currentPassword: password, reason: "Must retain administration" },
  );
  assert.equal(denied.statusCode, 409, denied.body);
  assert.equal(denied.json().error.code, "LAST_ADMIN");
  await request("admin", "POST", `/admin/users/${ids.spare}/state`, {
    state: "active",
    reason: "Restore spare",
  });
  tokens.spare = randomBytes(32).toString("base64url");
  await pg.db.insert(sessions).values({
    userId: ids.spare,
    tokenHash: hashToken(tokens.spare),
    expiresAt: new Date(Date.now() + 600000),
  });
  const results = await Promise.all([
    request("admin", "POST", `/admin/users/${ids.admin}/delete`, {
      currentPassword: password,
      reason: "Concurrent operator deletion",
    }),
    request("spare", "POST", `/admin/users/${ids.spare}/delete`, {
      currentPassword: password,
      reason: "Concurrent operator deletion",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
});

test("self-service account deletion erases private sprite versions and asset audit targets", async () => {
  scenario++;
  const [asset] = await pg.db
    .insert(userAssets)
    .values({
      ownerId: ids.student,
      name: "Private sprite",
      alias: "@private-sprite",
    })
    .returning();
  await pg.db.insert(userAssetVersions).values({
    assetId: asset.id,
    number: 1,
    sprite: {
      format: "randusr.indexed-sprite",
      version: 1,
      width: 1,
      height: 1,
      pixels: [0],
      palette: [0],
      transparentIndex: null,
    },
    sha256: "0".repeat(64),
  });
  await pg.db.insert(auditLog).values({
    actorId: ids.student,
    action: "asset.created",
    targetType: "asset",
    targetId: asset.id,
  });

  const removed = await request("student", "POST", "/account/delete", {
    currentPassword: password,
    confirmEmail: "lifecycle-student@example.invalid",
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(
    (await pg.db.select().from(userAssets).where(eq(userAssets.id, asset.id)))
      .length,
    0,
  );
  assert.equal(
    (
      await pg.db
        .select()
        .from(userAssetVersions)
        .where(eq(userAssetVersions.assetId, asset.id))
    ).length,
    0,
  );
  assert.equal(
    (
      await pg.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.targetId, asset.id))
    ).length,
    0,
  );
});
