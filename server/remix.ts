import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import {
  projects,
  projectRevisions,
  users,
  moderationActions,
} from "./db/schema.js";
import {
  cloudUser,
  cloudDto,
  remixCredit,
  titleSchema,
  createProject,
  projectAudit,
  projectLimits,
} from "./projects.js";
import { projectPreviews } from "./db/schema.js";
import { storePreview } from "./preview-store.js";
import { adminTransaction } from "./admin-access.js";
import { requirePermission } from "./access.js";
import { ApiError } from "./errors.js";
import type { ProjectSnapshot } from "../shared/project.js";
import { portableProjectSnapshot } from "../shared/project.js";
export const sharedCodeParams = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: { code: { type: "string", pattern: "^[A-Za-z0-9_-]{16}$" } },
};
export function registerRemix(app: FastifyInstance, db: Database) {
  app.post<{ Params: { code: string }; Body: { title?: string } }>(
    "/api/v1/shared/:code/remix",
    {
      schema: {
        params: sharedCodeParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: { title: titleSchema },
        },
      },
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
    },
    async (request) => {
      const user = await cloudUser(db, request);
      return db.transaction(async (tx) => {
        // Serialize destination quota before reading/locking the source publication.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, user.id))
          .for("update");
        const [row] = await tx
          .select({ p: projects })
          .from(projects)
          .innerJoin(users, eq(users.id, projects.ownerId))
          .where(
            and(
              eq(projects.shortCode, request.params.code),
              eq(projects.moderationState, "active"),
              isNull(projects.deletedAt),
              isNull(projects.archivedAt),
              eq(users.state, "active"),
              isNotNull(users.verifiedAt),
            ),
          )
          .for("update", { of: projects });
        const p = row?.p;
        if (
          !p ||
          p.visibility === "private" ||
          !p.publishedRevisionId ||
          !p.publishedMetadata
        )
          throw new ApiError(404, "NOT_FOUND");
        const [revision] = await tx
          .select()
          .from(projectRevisions)
          .where(
            and(
              eq(projectRevisions.id, p.publishedRevisionId),
              eq(projectRevisions.projectId, p.id),
            ),
          );
        if (!revision) throw new ApiError(404, "NOT_FOUND");
        const source = revision.snapshot as unknown as ProjectSnapshot;
        if (source.sourceCode.length > projectLimits.sourceCharacters)
          throw new ApiError(413, "PAYLOAD_TOO_LARGE");
        const date = new Date().toISOString();
        const copy = await createProject(
          tx,
          user.id,
          {
            ...portableProjectSnapshot(source),
            ...(request.body?.title ? { title: request.body.title.trim() } : {}),
            createdAt: date,
            updatedAt: date,
          },
          p.publishedMetadata.description,
        );
        // The copy starts with the picture the original was published with.
        const sourcePreview = p.publishedMetadata.previewKey
          ? (
              await tx
                .select({ png: projectPreviews.png })
                .from(projectPreviews)
                .where(
                  and(
                    eq(projectPreviews.id, p.publishedMetadata.previewKey),
                    eq(projectPreviews.projectId, p.id),
                  ),
                )
            )[0]
          : undefined;
        const previewKey = sourcePreview
          ? await storePreview(tx, copy.id, sourcePreview.png)
          : null;
        const [saved] = await tx
          .update(projects)
          .set({ remixedFromRevisionId: revision.id, previewKey })
          .where(eq(projects.id, copy.id))
          .returning();
        await projectAudit(tx, user.id, "project.remixed", copy.id);
        return { ...cloudDto(saved), remixedFrom: await remixCredit(tx, saved) };
      });
    },
  );
  // Viewer moderation entry; the later admin console reuses this explicit audited API.
  app.post<{
    Params: { code: string };
    Body: { revisionId: string; reason: string };
  }>(
    "/api/v1/admin/shared/:code/block",
    {
      preHandler: requirePermission(db, "administer"),
      schema: {
        params: sharedCodeParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["revisionId", "reason"],
          properties: {
            revisionId: { type: "string", format: "uuid" },
            reason: {
              type: "string",
              minLength: 1,
              maxLength: 2000,
              pattern: "\\S",
            },
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
          .where(
            and(
              eq(projects.shortCode, request.params.code),
              isNull(projects.deletedAt),
            ),
          )
          .for("update");
        if (!p || p.visibility === "private" || !p.publishedRevisionId)
          throw new ApiError(404, "NOT_FOUND");
        if (p.publishedRevisionId !== request.body.revisionId)
          throw new ApiError(409, "VERSION_CONFLICT");
        if (p.moderationState === "blocked") return;
        await tx
          .update(projects)
          .set({ moderationState: "blocked", featured: false })
          .where(eq(projects.id, p.id));
        await tx.insert(moderationActions).values({
          actorId: admin.id,
          projectId: p.id,
          action: "project.blocked",
          reason: request.body.reason.trim(),
        });
        await projectAudit(tx, admin.id, "project.blocked", p.id);
      });
      return { ok: true };
    },
  );
}
