import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import { projects, projectRevisions, users, auditLog } from "./db/schema.js";
import {
  cloudUser,
  ownProject,
  cloudDto,
  assertVersion,
  createProject,
  projectParams,
} from "./projects.js";
import { checkpoint } from "./revisions.js";
import { ApiError } from "./errors.js";
import {
  normalizeProjectSnapshot,
  type ProjectSnapshot,
} from "../shared/project.js";
const revisionParams = {
  type: "object",
  additionalProperties: false,
  required: ["id", "revisionId"],
  properties: {
    id: { type: "string", format: "uuid" },
    revisionId: { type: "string", format: "uuid" },
  },
};
export function registerHistory(app: FastifyInstance, db: Database) {
  app.get<{ Params: { id: string }; Querystring: { before?: number } }>(
    "/api/v1/projects/:id/revisions",
    {
      schema: {
        params: projectParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { before: { type: "integer", minimum: 1 } },
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      await ownProject(db, request.params.id, u.id);
      const rows = await db
        .select({
          id: projectRevisions.id,
          number: projectRevisions.number,
          createdAt: projectRevisions.createdAt,
          actorName: users.displayName,
          summary: sql<string>`left(coalesce(${projectRevisions.snapshot}->>'sourceCode',''),80)`,
        })
        .from(projectRevisions)
        .leftJoin(users, eq(users.id, projectRevisions.actorId))
        .where(
          and(
            eq(projectRevisions.projectId, request.params.id),
            request.query.before
              ? lt(projectRevisions.number, request.query.before)
              : undefined,
          ),
        )
        .orderBy(desc(projectRevisions.number))
        .limit(31);
      const page = rows.slice(0, 30);
      return {
        revisions: page,
        nextBefore: rows.length > 30 ? page.at(-1)!.number : null,
      };
    },
  );
  app.get<{ Params: { id: string; revisionId: string } }>(
    "/api/v1/projects/:id/revisions/:revisionId",
    { schema: { params: revisionParams } },
    async (request) => {
      const u = await cloudUser(db, request);
      await ownProject(db, request.params.id, u.id);
      const [revision] = await db
        .select()
        .from(projectRevisions)
        .where(
          and(
            eq(projectRevisions.id, request.params.revisionId),
            eq(projectRevisions.projectId, request.params.id),
          ),
        );
      if (!revision) throw new ApiError(404, "NOT_FOUND");
      return {
        id: revision.id,
        number: revision.number,
        snapshot: normalizeProjectSnapshot(
          revision.snapshot as unknown as ProjectSnapshot,
        ),
        createdAt: revision.createdAt,
      };
    },
  );
  app.post<{
    Params: { id: string; revisionId: string };
    Body: { version: number };
  }>(
    "/api/v1/projects/:id/revisions/:revisionId/restore",
    {
      schema: {
        params: revisionParams,
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
        if (p.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
        const [revision] = await tx
          .select()
          .from(projectRevisions)
          .where(
            and(
              eq(projectRevisions.id, request.params.revisionId),
              eq(projectRevisions.projectId, p.id),
            ),
          );
        if (!revision) throw new ApiError(404, "NOT_FOUND");
        // Restore brings back the code, story position and versioned instructions, never the title.
        const revisionSnapshot =
          revision.snapshot as unknown as ProjectSnapshot;
        const currentSnapshot = p.snapshot as unknown as ProjectSnapshot;
        const snapshot = normalizeProjectSnapshot({
          ...revisionSnapshot,
          // Legacy revisions predate editable instructions; preserve current metadata when restoring one.
          instructions:
            revisionSnapshot.instructions ?? currentSnapshot.instructions ?? "",
          title: p.title,
          updatedAt: new Date().toISOString(),
        });
        const [updated] = await tx
          .update(projects)
          .set({
            snapshot: { ...snapshot },
            title: snapshot.title,
            mode: snapshot.mode,
            storyId: snapshot.storyId,
            sceneId: snapshot.sceneId,
            version: p.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, p.id))
          .returning();
        await checkpoint(tx, p.id, u.id, updated.version, snapshot, "restore");
        await tx.insert(auditLog).values({
          actorId: u.id,
          action: "project.restored",
          targetType: "project",
          targetId: p.id,
          metadata: { fromRevision: revision.id },
        });
        return cloudDto(updated);
      });
    },
  );
  app.post<{ Params: { id: string; revisionId: string } }>(
    "/api/v1/projects/:id/revisions/:revisionId/copy",
    {
      schema: {
        params: revisionParams,
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      return db.transaction(async (tx) => {
        const p = await ownProject(tx, request.params.id, u.id, true);
        const [r] = await tx
          .select()
          .from(projectRevisions)
          .where(
            and(
              eq(projectRevisions.id, request.params.revisionId),
              eq(projectRevisions.projectId, p.id),
            ),
          );
        if (!r) throw new ApiError(404, "NOT_FOUND");
        const revisionSnapshot = r.snapshot as unknown as ProjectSnapshot;
        const currentSnapshot = p.snapshot as unknown as ProjectSnapshot;
        const snapshot = normalizeProjectSnapshot({
          ...revisionSnapshot,
          instructions:
            revisionSnapshot.instructions ?? currentSnapshot.instructions ?? "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return cloudDto(await createProject(tx, u.id, snapshot, p.description));
      });
    },
  );
}
