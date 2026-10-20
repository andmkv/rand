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
import { previewUrl } from "../shared/preview.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import { projects, projectRevisions, users, auditLog } from "./db/schema.js";
import { projectTagIds } from "../shared/tags.js";
import { requirePermission } from "./access.js";
import { adminTransaction } from "./admin-access.js";
import { decodeCursor, encodeCursor, cursorTime } from "./cursor.js";
import { ApiError } from "./errors.js";
export function registerGallery(app: FastifyInstance, db: Database) {
  app.get<{
    Querystring: {
      q?: string;
      tag?: string;
      sort?: "recent" | "featured";
      cursor?: string;
    };
  }>(
    "/api/v1/gallery",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 120 },
            tag: { enum: projectTagIds },
            sort: { enum: ["recent", "featured"] },
            cursor: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (request) => {
      const q = request.query,
        cursor = decodeCursor(q.cursor),
        term = q.q ? `%${q.q.replace(/[\\%_]/g, "\\$&")}%` : undefined;
      const rows = await db
        .select({
          id: projects.id,
          shortCode: projects.shortCode,
          metadata: projects.publishedMetadata,
          author: users.displayName,
          publishedAt: projects.publishedAt,
          revisionId: projects.publishedRevisionId,
          featured: projects.featured,
          mode: sql<"story" | "sandbox">`${projectRevisions.snapshot}->>'mode'`,
          cursorAt: cursorTime(projects.publishedAt),
        })
        .from(projects)
        .innerJoin(users, eq(users.id, projects.ownerId))
        .innerJoin(
          projectRevisions,
          eq(projectRevisions.id, projects.publishedRevisionId),
        )
        .where(
          and(
            eq(projects.visibility, "public"),
            eq(projects.moderationState, "active"),
            isNull(projects.deletedAt),
            isNull(projects.archivedAt),
            isNotNull(projects.publishedMetadata),
            isNotNull(projects.publishedAt),
            eq(users.state, "active"),
            isNotNull(users.verifiedAt),
            q.sort === "featured" ? eq(projects.featured, true) : undefined,
            q.tag
              ? sql`${projects.publishedMetadata}->'tags' @> ${JSON.stringify([q.tag])}::jsonb`
              : undefined,
            term
              ? or(
                  ilike(sql`${projects.publishedMetadata}->>'title'`, term),
                  ilike(users.displayName, term),
                  ilike(
                    sql`(${projects.publishedMetadata}->'tags')::text`,
                    term,
                  ),
                )
              : undefined,
            cursor
              ? or(
                  lt(projects.publishedAt, sql`${cursor.at}::timestamptz`),
                  and(
                    eq(projects.publishedAt, sql`${cursor.at}::timestamptz`),
                    lt(projects.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(projects.publishedAt), desc(projects.id))
        .limit(31);
      const page = rows.slice(0, 30);
      return {
        projects: page.map((p) => ({
          shortCode: p.shortCode,
          title: p.metadata!.title,
          description: p.metadata!.description,
          tags: p.metadata!.tags,
          author: p.author,
          publishedAt: p.publishedAt!.toISOString(),
          revisionId: p.revisionId!,
          featured: p.featured,
          mode: p.mode,
          previewUrl: previewUrl("shared", p.shortCode, p.metadata?.previewKey),
        })),
        nextCursor:
          rows.length > 30 && page.length
            ? encodeCursor(page.at(-1)!.cursorAt, page.at(-1)!.id)
            : null,
      };
    },
  );
  app.patch<{
    Params: { code: string };
    Body: { featured: boolean; revisionId: string };
  }>(
    "/api/v1/admin/featured/:code",
    {
      preHandler: requirePermission(db, "administer"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: {
            code: { type: "string", pattern: "^[A-Za-z0-9_-]{16}$" },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["featured", "revisionId"],
          properties: {
            featured: { type: "boolean" },
            revisionId: { type: "string", format: "uuid" },
          },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
    },
    async (request) => {
      await adminTransaction(db, request, async (tx, admin) => {
        const [p] = await tx
          .select()
          .from(projects)
          .where(eq(projects.shortCode, request.params.code))
          .for("update");
        if (
          !p ||
          p.visibility !== "public" ||
          p.moderationState !== "active" ||
          p.deletedAt ||
          p.archivedAt ||
          !p.publishedMetadata
        )
          throw new ApiError(404, "NOT_FOUND");
        const [author] = await tx
          .select({ state: users.state, verifiedAt: users.verifiedAt })
          .from(users)
          .where(eq(users.id, p.ownerId));
        if (!author || author.state !== "active" || !author.verifiedAt)
          throw new ApiError(404, "NOT_FOUND");
        if (p.publishedRevisionId !== request.body.revisionId)
          throw new ApiError(409, "VERSION_CONFLICT");
        if (p.featured === request.body.featured) return;
        await tx
          .update(projects)
          .set({ featured: request.body.featured })
          .where(eq(projects.id, p.id));
        await tx.insert(auditLog).values({
          actorId: admin.id,
          action: request.body.featured
            ? "gallery.featured"
            : "gallery.unfeatured",
          targetType: "project",
          targetId: p.id,
        });
      });
      return { ok: true };
    },
  );
}
