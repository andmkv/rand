import { platformLimits } from "./limits.js";
import {
  isBlackFrame,
  previewPixelsSchema,
  previewUrl,
} from "../shared/preview.js";
import { previewPng } from "./preview-image.js";
import { storePreview, prunePreviews } from "./preview-store.js";
import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "./db/client.js";
import type { AuthConfig } from "./auth-config.js";
import {
  projects,
  projectRevisions,
  users,
  projectTags,
  tags,
  auditLog,
} from "./db/schema.js";
import {
  cloudUser,
  lockCloudUser,
  ownProject,
  projectParams,
  assertVersion,
  cloudDto,
  projectAudit,
  remixCredit,
} from "./projects.js";
import { checkpoint, pruneHistory } from "./revisions.js";
import { resolvePrincipal, sessionCookie } from "./access.js";
import { projectTagIds } from "../shared/tags.js";
import { ApiError } from "./errors.js";
import {
  normalizeProjectSnapshot,
  portableProjectSnapshot,
  type ProjectSnapshot,
  type SharedProject,
} from "../shared/project.js";
import type { DemoStore } from "./demo-store.js";
const shareCode = () => randomBytes(12).toString("base64url");
const publicParams = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: { code: { type: "string", pattern: "^[A-Za-z0-9_-]{16}$" } },
};
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function rotateShareLink(
  tx: Tx,
  project: typeof projects.$inferSelect,
  makeCode = shareCode,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await tx.transaction(async (savepoint) => {
        const [updated] = await savepoint
          .update(projects)
          .set({
            shortCode: makeCode(),
            version: project.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, project.id))
          .returning();
        return updated;
      });
    } catch (error) {
      const cause = (
        error as { cause?: { code?: string; constraint?: string } }
      ).cause;
      if (
        cause?.code !== "23505" ||
        cause.constraint !== "projects_short_code_unique"
      )
        throw error;
    }
  }
  throw new ApiError(503, "UNAVAILABLE");
}
export async function sharedProject(
  db: Database,
  code: string,
  request: FastifyRequest,
): Promise<SharedProject> {
  const [row] = await db
    .select({
      project: projects,
      author: { id: users.id, displayName: users.displayName },
    })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.ownerId))
    .where(
      and(
        eq(projects.shortCode, code),
        eq(projects.moderationState, "active"),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt),
        eq(users.state, "active"),
      ),
    )
    .limit(1);
  if (!row) throw new ApiError(404, "NOT_FOUND");
  const p = row.project;
  const principal = await resolvePrincipal(db, request.cookies[sessionCookie]);
  const isOwner = principal?.verified && principal.id === p.ownerId;
  if (p.visibility === "private") {
    if (!isOwner) throw new ApiError(404, "NOT_FOUND");
    return {
      shortCode: p.shortCode,
      visibility: "private",
      title: p.title,
      description: p.description,
      tags: [],
      author: row.author,
      publishedAt: null,
      snapshot: normalizeProjectSnapshot(
        p.snapshot as unknown as ProjectSnapshot,
      ),
      ownerProjectId: p.id,
      previewUrl: previewUrl("projects", p.id, p.previewKey),
    };
  }
  if (!p.publishedRevisionId || !p.publishedMetadata)
    throw new ApiError(404, "NOT_FOUND");
  const [revision] = await db
    .select()
    .from(projectRevisions)
    .where(
      and(
        eq(projectRevisions.id, p.publishedRevisionId),
        eq(projectRevisions.projectId, p.id),
      ),
    );
  if (!revision) throw new ApiError(404, "NOT_FOUND");
  return {
    shortCode: p.shortCode,
    visibility: p.visibility,
    title: p.publishedMetadata.title,
    description: p.publishedMetadata.description,
    tags: p.publishedMetadata.tags,
    author: row.author,
    publishedAt: p.publishedAt!.toISOString(),
    revisionId: revision.id,
    snapshot: portableProjectSnapshot(
      normalizeProjectSnapshot(revision.snapshot as unknown as ProjectSnapshot),
    ),
    previewUrl: previewUrl(
      "shared",
      p.shortCode,
      p.publishedMetadata.previewKey,
    ),
    ...(isOwner ? { ownerProjectId: p.id } : {}),
  };
}
export function registerSharing(
  app: FastifyInstance,
  db: Database,
  config: AuthConfig,
  demo?: DemoStore,
) {
  app.get<{ Params: { id: string } }>(
    "/api/v1/projects/:id/share",
    { schema: { params: projectParams } },
    async (request) => {
      const u = await cloudUser(db, request);
      const p = await ownProject(db, request.params.id, u.id);
      const selected = await db
        .select({ slug: tags.slug })
        .from(projectTags)
        .innerJoin(tags, eq(tags.id, projectTags.tagId))
        .where(eq(projectTags.projectId, p.id));
      return {
        version: p.version,
        title: p.title,
        description: p.description,
        tags: selected.map((t) => t.slug),
        visibility: p.visibility,
        url: new URL(`/p/${p.shortCode}`, config.baseUrl).href,
        shortCode: p.shortCode,
        previewUrl: previewUrl("projects", p.id, p.previewKey),
        remixedFrom: await remixCredit(db, p),
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      version: number;
      visibility: "private" | "unlisted" | "public";
      title?: string;
      description?: string;
      tags?: string[];
      previewPixels?: string;
    };
  }>(
    "/api/v1/projects/:id/share",
    {
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version", "visibility"],
          properties: {
            version: { type: "integer", minimum: 1 },
            visibility: { enum: ["private", "unlisted", "public"] },
            previewPixels: previewPixelsSchema,
            title: {
              type: "string",
              minLength: 1,
              maxLength: 120,
              pattern: "^[^<>\\x00-\\x1F]+$",
            },
            description: {
              type: "string",
              maxLength: 2000,
              pattern: "^[^<>]*$",
            },
            tags: {
              type: "array",
              maxItems: 8,
              uniqueItems: true,
              items: { enum: projectTagIds },
            },
          },
        },
      },
      config: {
        rateLimit: {
          max: platformLimits.publicationsPer15Minutes,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      const b = request.body;
      // A blank SCREEN never replaces the picture the project already has.
      const png =
        b.previewPixels && !isBlackFrame(b.previewPixels)
          ? previewPng(b.previewPixels)
          : undefined;
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, u.id);
        if (b.visibility !== "private") {
          const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.actorId, u.id),
                eq(auditLog.action, "project.published"),
                gt(auditLog.createdAt, new Date(Date.now() - 15 * 60000)),
              ),
            );
          if (count >= platformLimits.publicationsPer15Minutes)
            throw new ApiError(429, "RATE_LIMITED");
        }
        const p = await ownProject(tx, request.params.id, u.id, true);
        assertVersion(p, b.version);
        if (p.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
        if (p.moderationState !== "active")
          throw new ApiError(403, "FORBIDDEN");
        if (b.visibility === "private") {
          const [updated] = await tx
            .update(projects)
            .set({
              visibility: "private",
              featured: false,
              publishedRevisionId: null,
              publishedMetadata: null,
              publishedAt: null,
              version: p.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, p.id))
            .returning();
          await projectAudit(tx, u.id, "project.unpublished", p.id);
          await prunePreviews(tx, p.id);
          await pruneHistory(tx, p.id);
          return cloudDto(updated);
        }
        if (!b.title?.trim()) throw new ApiError(400, "INVALID_INPUT");
        const snapshot = normalizeProjectSnapshot({
          ...(p.snapshot as unknown as ProjectSnapshot),
          title: b.title.trim(),
          updatedAt: new Date().toISOString(),
        });
        const revision = await checkpoint(
          tx,
          p.id,
          u.id,
          p.version + 1,
          snapshot,
          "publish",
        );
        const previewKey = png
          ? await storePreview(tx, p.id, png)
          : p.previewKey;
        const metadata = {
          title: snapshot.title,
          description: b.description ?? "",
          tags: b.tags ?? [],
          previewKey,
        };
        const [updated] = await tx
          .update(projects)
          .set({
            snapshot: { ...snapshot },
            title: snapshot.title,
            description: metadata.description,
            visibility: b.visibility,
            featured: false,
            publishedRevisionId: revision.id,
            publishedMetadata: metadata,
            publishedAt: new Date(),
            previewKey,
            version: p.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, p.id))
          .returning();
        await tx
          .insert(tags)
          .values(projectTagIds.map((slug) => ({ slug })))
          .onConflictDoNothing();
        await tx.delete(projectTags).where(eq(projectTags.projectId, p.id));
        if (metadata.tags.length) {
          const selected = await tx
            .select()
            .from(tags)
            .where(inArray(tags.slug, metadata.tags));
          await tx
            .insert(projectTags)
            .values(
              selected.map((tag) => ({ projectId: p.id, tagId: tag.id })),
            );
        }
        await projectAudit(tx, u.id, "project.published", p.id);
        await prunePreviews(tx, p.id);
        return cloudDto(updated);
      });
    },
  );
  app.post<{ Params: { id: string }; Body: { version: number } }>(
    "/api/v1/projects/:id/share/rotate",
    {
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version"],
          properties: { version: { type: "integer", minimum: 1 } },
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      return db.transaction(async (tx) => {
        const p = await ownProject(tx, request.params.id, u.id, true);
        assertVersion(p, request.body.version);
        if (p.visibility !== "unlisted")
          throw new ApiError(400, "INVALID_INPUT");
        const updated = await rotateShareLink(tx, p);
        await projectAudit(tx, u.id, "project.link_rotated", p.id);
        return cloudDto(updated);
      });
    },
  );
  app.get<{ Params: { code: string } }>(
    "/api/v1/shared/:code",
    { schema: { params: publicParams } },
    async (request, reply) => {
      try {
        // PostgreSQL is authoritative: a real code always wins over demo memory.
        const p = await sharedProject(db, request.params.code, request);
        if (p.visibility !== "public")
          reply.header("X-Robots-Tag", "noindex, nofollow");
        return p;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === "NOT_FOUND" &&
          demo?.hasCode(request.params.code)
        ) {
          reply.header("X-Robots-Tag", "noindex, nofollow");
          return demo.publicShared(request.params.code);
        }
        throw error;
      }
    },
  );
}
