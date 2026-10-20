import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "./db/client.js";
import { projects, projectPreviews, users } from "./db/schema.js";
import {
  cloudUser,
  lockCloudUser,
  ownProject,
  projectParams,
  assertVersion,
  projectAudit,
} from "./projects.js";
import { previewPixelsSchema, previewUrl } from "../shared/preview.js";
import { previewPng } from "./preview-image.js";
import { storePreview, prunePreviews } from "./preview-store.js";
import { ApiError } from "./errors.js";
import type { DemoStore } from "./demo-store.js";
export function registerPreviews(
  app: FastifyInstance,
  db: Database,
  demo?: DemoStore,
) {
  app.post<{
    Params: { id: string };
    Body: { version: number; pixels: string };
  }>(
    "/api/v1/projects/:id/preview",
    {
      config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version", "pixels"],
          properties: {
            version: { type: "integer", minimum: 1 },
            pixels: previewPixelsSchema,
          },
        },
      },
    },
    async (request) => {
      const user = await cloudUser(db, request),
        png = previewPng(request.body.pixels);
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, user.id);
        const p = await ownProject(tx, request.params.id, user.id, true);
        assertVersion(p, request.body.version);
        if (p.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
        const key = await storePreview(tx, p.id, png);
        // Thumbnail is separate metadata: preserve source revision/version and the running screen.
        await tx
          .update(projects)
          .set({ previewKey: key })
          .where(eq(projects.id, p.id));
        await prunePreviews(tx, p.id);
        await projectAudit(tx, user.id, "project.preview_updated", p.id);
        return {
          previewUrl: previewUrl("projects", p.id, key),
          version: p.version,
        };
      });
    },
  );
  app.get<{ Params: { id: string; key: string } }>(
    "/api/v1/projects/:id/preview/:key",
    {
      schema: {
        params: {
          ...projectParams,
          required: ["id", "key"],
          properties: {
            id: { type: "string", format: "uuid" },
            key: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await cloudUser(db, request);
      const [asset] = await db
        .select({ png: projectPreviews.png })
        .from(projectPreviews)
        .innerJoin(projects, eq(projects.id, projectPreviews.projectId))
        .where(
          and(
            eq(projects.id, request.params.id),
            eq(projects.ownerId, user.id),
            isNull(projects.deletedAt),
            eq(projectPreviews.id, request.params.key),
            or(
              eq(projects.previewKey, request.params.key),
              sql`${projects.publishedMetadata}->>'previewKey'=${request.params.key}`,
            ),
          ),
        )
        .limit(1);
      if (!asset) throw new ApiError(404, "NOT_FOUND");
      return reply.type("image/png").send(asset.png);
    },
  );
  app.get<{ Params: { code: string; key: string } }>(
    "/api/v1/shared/:code/preview/:key",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code", "key"],
          properties: {
            code: { type: "string", pattern: "^[A-Za-z0-9_-]{16}$" },
            key: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      // One authorized SQL snapshot; never serve a draft image through a publication link.
      const [asset] = await db
        .select({ png: projectPreviews.png })
        .from(projectPreviews)
        .innerJoin(projects, eq(projects.id, projectPreviews.projectId))
        .innerJoin(users, eq(users.id, projects.ownerId))
        .where(
          and(
            eq(projects.shortCode, request.params.code),
            eq(projectPreviews.id, request.params.key),
            sql`${projects.publishedMetadata}->>'previewKey'=${request.params.key}`,
            inArray(projects.visibility, ["public", "unlisted"]),
            isNotNull(projects.publishedRevisionId),
            eq(projects.moderationState, "active"),
            isNull(projects.deletedAt),
            isNull(projects.archivedAt),
            eq(users.state, "active"),
          ),
        )
        .limit(1);
      if (!asset) {
        if (demo?.hasCode(request.params.code)) {
          reply.header("X-Robots-Tag", "noindex, nofollow");
          return reply
            .type("image/png")
            .send(demo.sharedPreview(request.params.code, request.params.key));
        }
        throw new ApiError(404, "NOT_FOUND");
      }
      return reply.type("image/png").send(asset.png);
    },
  );
}
