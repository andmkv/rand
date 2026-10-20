import { previewUrl } from "../shared/preview.js";
import { prunePreviews } from "./preview-store.js";
import { platformLimits } from "./limits.js";
import { resolvePrincipal, sessionCookie } from "./access.js";
import { decodeCursor, encodeCursor, cursorTime } from "./cursor.js";
import { checkpoint } from "./revisions.js";
import { examples } from "../src/content/examples.js";
import { randomBytes } from "node:crypto";
import {
  and,
  desc,
  eq,
  isNull,
  isNotNull,
  ilike,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "./db/client.js";
import { projects, projectRevisions, users, auditLog } from "./db/schema.js";
import { currentUser } from "./auth.js";
import { can } from "../shared/permissions.js";
import {
  instructionsMax,
  isValidProjectInstructions,
} from "../shared/limits.js";
import { normalizeProjectSnapshot } from "../shared/project.js";
import {
  assertProjectAssetManifest,
  projectAssetManifestSchema,
} from "../shared/assets.js";
import { assertOwnedSoundBindings, assertOwnedSpriteBindings } from "./project-assets.js";
import { ApiError } from "./errors.js";
import type {
  CloudProject,
  ProjectSnapshot,
  RemixCredit,
} from "../shared/project.js";
export const projectLimits = {
  sourceCharacters: platformLimits.sourceCharacters,
  projectsPerUser: platformLimits.projectsPerUser,
  pageSize: 30,
};
export const snapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "format",
    "version",
    "title",
    "sourceCode",
    "mode",
    "createdAt",
    "updatedAt",
    "storyId",
    "sceneId",
    "unlocked",
    "exampleId",
  ],
  properties: {
    format: { const: "randusr" },
    version: { const: 2 },
    title: { type: "string", maxLength: 120 },
    instructions: { type: "string", maxLength: instructionsMax },
    assetManifest: projectAssetManifestSchema,
    sourceCode: { type: "string", maxLength: projectLimits.sourceCharacters },
    mode: { enum: ["story", "sandbox"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    storyId: { const: "tower" },
    sceneId: { type: "integer", minimum: 0, maximum: 8 },
    unlocked: { type: "integer", minimum: 0, maximum: 9 },
    exampleId: {
      anyOf: [
        { type: "null" },
        { type: "string", enum: examples.map((example) => example.id) },
      ],
    },
  },
};
export const projectParams = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", format: "uuid" } },
};
const versionSchema = { type: "integer", minimum: 1 };
export async function cloudUser(db: Database, request: FastifyRequest) {
  const u = await currentUser(db, request);
  if (
    !can(
      {
        id: u.id,
        active: u.state === "active",
        verified: !!u.verifiedAt,
        isAdmin: u.isAdmin,
      },
      "cloudProjects",
    )
  )
    throw new ApiError(403, "EMAIL_UNVERIFIED");
  return u;
}
export function cloudDto(p: typeof projects.$inferSelect): CloudProject {
  return {
    id: p.id,
    shortCode: p.shortCode,
    version: p.version,
    title: p.title,
    description: p.description,
    mode: p.mode,
    visibility: p.visibility,
    updatedAt: p.updatedAt.toISOString(),
    archived: !!p.archivedAt,
    previewUrl: previewUrl("projects", p.id, p.previewKey),
    snapshot: normalizeProjectSnapshot(
      p.snapshot as unknown as ProjectSnapshot,
    ),
  };
}
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const titleSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  pattern: "^[^<>\\x00-\\x1F]+$",
} as const;
export { titleSchema };
export async function remixCredit(
  tx: Database | Tx,
  p: typeof projects.$inferSelect,
): Promise<RemixCredit | null> {
  if (!p.remixedFromRevisionId) return null;
  const [row] = await tx
    .select({ src: projects, author: users.displayName })
    .from(projectRevisions)
    .innerJoin(projects, eq(projects.id, projectRevisions.projectId))
    .innerJoin(users, eq(users.id, projects.ownerId))
    .where(eq(projectRevisions.id, p.remixedFromRevisionId));
  const gone = { title: null, author: null, shortCode: null };
  const src = row?.src;
  if (
    !src ||
    src.visibility === "private" ||
    src.moderationState !== "active" ||
    src.deletedAt ||
    src.archivedAt ||
    !src.publishedMetadata
  )
    return gone;
  return {
    title: src.publishedMetadata.title,
    author: row.author,
    shortCode: src.shortCode,
  };
}
export async function ownProject(
  tx: Database | Tx,
  id: string,
  userId: string,
  lock = false,
) {
  const query = tx
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, id),
        eq(projects.ownerId, userId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  const [project] = await (lock ? query.for("update") : query);
  if (!project) throw new ApiError(404, "NOT_FOUND");
  return project;
}
export async function projectAudit(
  tx: Tx,
  actorId: string,
  action: string,
  id: string,
) {
  await tx
    .insert(auditLog)
    .values({ actorId, action, targetType: "project", targetId: id });
}
export async function lockCloudUser(tx: Database | Tx, id: string) {
  const [u] = await tx
    .select()
    .from(users)
    .where(eq(users.id, id))
    .for("no key update");
  if (!u || u.state !== "active") throw new ApiError(401, "AUTH_REQUIRED");
  if (!u.verifiedAt) throw new ApiError(403, "EMAIL_UNVERIFIED");
  return u;
}
export async function createProject(
  tx: Tx,
  userId: string,
  snapshot: ProjectSnapshot,
  description = "",
) {
  if (
    snapshot.sceneId > snapshot.unlocked ||
    (snapshot.instructions !== undefined &&
      !isValidProjectInstructions(snapshot.instructions))
  )
    throw new ApiError(400, "INVALID_INPUT");
  assertValidAssetManifest(snapshot.assetManifest);
  const capture = normalizeProjectSnapshot(snapshot);
  await lockCloudUser(tx, userId);
  await assertOwnedSpriteBindings(tx, userId, capture.assetManifest);
  await assertOwnedSoundBindings(tx, userId, capture.assetManifest);
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt)));
  if (count >= projectLimits.projectsPerUser)
    throw new ApiError(409, "QUOTA_EXCEEDED");
  for (let attempt = 0; attempt < 3; attempt++) {
    const [p] = await tx
      .insert(projects)
      .values({
        ownerId: userId,
        title: capture.title,
        description,
        snapshot: { ...capture },
        snapshotVersion: capture.version,
        mode: capture.mode,
        storyId: capture.storyId,
        sceneId: capture.sceneId,
        shortCode: randomBytes(12).toString("base64url"),
      })
      .onConflictDoNothing({ target: projects.shortCode })
      .returning();
    if (!p) continue;
    await checkpoint(tx, p.id, userId, 1, capture, "create");
    await projectAudit(tx, userId, "project.created", p.id);
    return p;
  }
  throw new ApiError(503, "UNAVAILABLE");
}

function assertValidAssetManifest(
  manifest: ProjectSnapshot["assetManifest"],
) {
  if (manifest === undefined) return;
  try {
    assertProjectAssetManifest(manifest);
  } catch {
    throw new ApiError(400, "INVALID_INPUT");
  }
}
export function assertVersion(p: { version: number }, version: number) {
  if (p.version !== version) throw new ApiError(409, "VERSION_CONFLICT");
}
export function registerProjects(app: FastifyInstance, db: Database) {
  app.get("/api/v1/limits", async () => ({
    ...platformLimits,
    ...projectLimits,
  }));
  app.get<{
    Querystring: {
      cursor?: string;
      q?: string;
      mode?: "story" | "sandbox";
      visibility?: "private" | "unlisted" | "public";
      archived?: string;
    };
  }>(
    "/api/v1/projects",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: "string", maxLength: 200 },
            q: { type: "string", maxLength: 120 },
            mode: { enum: ["story", "sandbox"] },
            visibility: { enum: ["private", "unlisted", "public"] },
            archived: { enum: ["true", "false"] },
          },
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      const q = request.query;
      const cursor = decodeCursor(q.cursor);
      const rows = await db
        .select({
          id: projects.id,
          version: projects.version,
          title: projects.title,
          description: projects.description,
          mode: projects.mode,
          visibility: projects.visibility,
          updatedAt: projects.updatedAt,
          archivedAt: projects.archivedAt,
          previewKey: projects.previewKey,
          cursorAt: cursorTime(projects.updatedAt),
        })
        .from(projects)
        .where(
          and(
            eq(projects.ownerId, u.id),
            isNull(projects.deletedAt),
            q.archived === "true"
              ? isNotNull(projects.archivedAt)
              : isNull(projects.archivedAt),
            q.q
              ? ilike(projects.title, `%${q.q.replace(/[\\%_]/g, "\\$&")}%`)
              : undefined,
            q.mode ? eq(projects.mode, q.mode) : undefined,
            q.visibility ? eq(projects.visibility, q.visibility) : undefined,
            cursor
              ? or(
                  lt(projects.updatedAt, sql`${cursor.at}::timestamptz`),
                  and(
                    eq(projects.updatedAt, sql`${cursor.at}::timestamptz`),
                    lt(projects.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(projects.updatedAt), desc(projects.id))
        .limit(projectLimits.pageSize + 1);
      const more = rows.length > projectLimits.pageSize;
      const page = rows.slice(0, projectLimits.pageSize);
      const last = page.at(-1);
      return {
        projects: page.map((p) => {
          return {
            id: p.id,
            version: p.version,
            title: p.title,
            description: p.description,
            mode: p.mode,
            visibility: p.visibility,
            updatedAt: p.updatedAt.toISOString(),
            archived: !!p.archivedAt,
            previewUrl: previewUrl("projects", p.id, p.previewKey),
          };
        }),
        nextCursor:
          more && last
            ? Buffer.from(JSON.stringify([last.cursorAt, last.id])).toString(
                "base64url",
              )
            : null,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/projects/:id",
    { schema: { params: projectParams } },
    async (request) => {
      const p = await ownProject(
        db,
        request.params.id,
        (await cloudUser(db, request)).id,
      );
      return { ...cloudDto(p), remixedFrom: await remixCredit(db, p) };
    },
  );
  app.post<{ Body: { snapshot: ProjectSnapshot; description?: string } }>(
    "/api/v1/projects",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["snapshot"],
          properties: {
            snapshot: snapshotSchema,
            description: { type: "string", maxLength: 2000 },
          },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      return cloudDto(
        await db.transaction((tx) =>
          createProject(
            tx,
            u.id,
            request.body.snapshot,
            request.body.description,
          ),
        ),
      );
    },
  );
  app.put<{
    Params: { id: string };
    Body: { version: number; snapshot: ProjectSnapshot; description?: string };
  }>(
    "/api/v1/projects/:id",
    {
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version", "snapshot"],
          properties: {
            version: versionSchema,
            snapshot: snapshotSchema,
            description: { type: "string", maxLength: 2000 },
          },
        },
      },
      config: {
        rateLimit: {
          max: platformLimits.autosavesPerMinute,
          timeWindow: "1 minute",
          keyGenerator: async (request) => {
            const p = await resolvePrincipal(
              db,
              request.cookies[sessionCookie],
            );
            return p ? `autosave:${p.id}` : `autosave-ip:${request.ip}`;
          },
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      const b = request.body;
      if (b.snapshot.sceneId > b.snapshot.unlocked)
        throw new ApiError(400, "INVALID_INPUT");
      return db.transaction(async (tx) => {
        const p = await ownProject(tx, request.params.id, u.id, true);
        assertVersion(p, b.version);
        if (p.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
        const currentSnapshot = p.snapshot as unknown as ProjectSnapshot;
        const assetManifest =
          b.snapshot.assetManifest ?? currentSnapshot.assetManifest;
        assertValidAssetManifest(assetManifest);
        const snapshot = normalizeProjectSnapshot({
          ...b.snapshot,
          // Older clients omitted the field; their save must not erase newer metadata.
          instructions:
            b.snapshot.instructions ?? currentSnapshot.instructions ?? "",
          assetManifest,
        });
        await assertOwnedSpriteBindings(tx, u.id, snapshot.assetManifest);
        await assertOwnedSoundBindings(tx, u.id, snapshot.assetManifest);
        const [updated] = await tx
          .update(projects)
          .set({
            snapshot: { ...snapshot },
            title: snapshot.title,
            mode: snapshot.mode,
            storyId: snapshot.storyId,
            sceneId: snapshot.sceneId,
            ...(b.description !== undefined
              ? { description: b.description }
              : {}),
            version: p.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, p.id))
          .returning();
        await checkpoint(tx, p.id, u.id, updated.version, snapshot, "save");
        await projectAudit(tx, u.id, "project.saved", p.id);
        return cloudDto(updated);
      });
    },
  );
  app.post<{
    Params: { id: string };
    Body: { version: number; title?: string };
  }>(
    "/api/v1/projects/:id/duplicate",
    {
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version"],
          properties: { version: versionSchema, title: titleSchema },
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      return db.transaction(async (tx) => {
        const p = await ownProject(tx, request.params.id, u.id, true);
        assertVersion(p, request.body.version);
        const copy = await createProject(
          tx,
          u.id,
          {
            ...(p.snapshot as unknown as ProjectSnapshot),
            ...(request.body.title ? { title: request.body.title.trim() } : {}),
          },
          p.description,
        );
        await projectAudit(tx, u.id, "project.duplicated", p.id);
        return cloudDto(copy);
      });
    },
  );
  app.patch<{
    Params: { id: string };
    Body: { version: number; archived: boolean };
  }>(
    "/api/v1/projects/:id",
    {
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version", "archived"],
          properties: { version: versionSchema, archived: { type: "boolean" } },
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      return db.transaction(async (tx) => {
        const p = await ownProject(tx, request.params.id, u.id, true);
        assertVersion(p, request.body.version);
        const [updated] = await tx
          .update(projects)
          .set({
            archivedAt: request.body.archived ? new Date() : null,
            version: p.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, p.id))
          .returning();
        await projectAudit(
          tx,
          u.id,
          request.body.archived ? "project.archived" : "project.unarchived",
          p.id,
        );
        return cloudDto(updated);
      });
    },
  );
  app.delete<{ Params: { id: string }; Body: { version: number } }>(
    "/api/v1/projects/:id",
    {
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version"],
          properties: { version: versionSchema },
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      await db.transaction(async (tx) => {
        const p = await ownProject(tx, request.params.id, u.id, true);
        assertVersion(p, request.body.version);
        await tx
          .update(projects)
          .set({
            deletedAt: new Date(),
            previewKey: null,
            visibility: "private",
            publishedRevisionId: null,
            publishedMetadata: null,
            publishedAt: null,
            version: p.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, p.id));
        await projectAudit(tx, u.id, "project.deleted", p.id);
        await prunePreviews(tx, p.id);
      });
      return { ok: true };
    },
  );
}
