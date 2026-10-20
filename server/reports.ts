import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import {
  projectReports,
  projects,
  users,
  moderationActions,
} from "./db/schema.js";
import { cloudUser, lockCloudUser, projectParams } from "./projects.js";
import { requirePermission } from "./access.js";
import { adminTransaction, adminAudit } from "./admin-access.js";
import { cursorTime, decodeCursor, encodeCursor } from "./cursor.js";
import { ApiError } from "./errors.js";
import { reportReasons } from "../shared/reports.js";
export function registerReports(app: FastifyInstance, db: Database) {
  app.post<{
    Params: { code: string };
    Body: { reason: string; detail?: string };
  }>(
    "/api/v1/shared/:code/report",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
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
          required: ["reason"],
          properties: {
            reason: { enum: reportReasons },
            detail: { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (request) => {
      const u = await cloudUser(db, request);
      return db.transaction(async (tx) => {
        // User lock serializes the durable per-account quota, independent of IP/restarts.
        await lockCloudUser(tx, u.id);
        const [p] = await tx
          .select({ p: projects })
          .from(projects)
          .innerJoin(users, eq(users.id, projects.ownerId))
          .where(
            and(
              eq(projects.shortCode, request.params.code),
              ne(projects.visibility, "private"),
              eq(projects.moderationState, "active"),
              eq(users.state, "active"),
              isNull(projects.deletedAt),
              isNull(projects.archivedAt),
            ),
          )
          .for("no key update", { of: projects });
        if (!p?.p.publishedRevisionId) throw new ApiError(404, "NOT_FOUND");
        const [existing] = await tx
          .select({ id: projectReports.id })
          .from(projectReports)
          .where(
            and(
              eq(projectReports.projectId, p.p.id),
              eq(projectReports.reporterId, u.id),
              eq(projectReports.state, "open"),
            ),
          )
          .limit(1);
        if (existing) return { ok: true };
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(projectReports)
          .where(
            and(
              eq(projectReports.reporterId, u.id),
              gt(projectReports.createdAt, new Date(Date.now() - 86400000)),
            ),
          );
        if (count >= 5) throw new ApiError(429, "RATE_LIMITED");
        await tx
          .insert(projectReports)
          .values({
            projectId: p.p.id,
            reporterId: u.id,
            reason: request.body.reason,
            detail: request.body.detail?.trim() || null,
          });
        return { ok: true };
      });
    },
  );
  const guard = requirePermission(db, "administer");
  app.get<{
    Querystring: { state?: "open" | "dismissed" | "resolved"; cursor?: string };
  }>(
    "/api/v1/admin/reports",
    {
      preHandler: guard,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            state: { enum: ["open", "dismissed", "resolved"] },
            cursor: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        const c = decodeCursor(request.query.cursor);
        const rows = await tx
          .select({
            id: projectReports.id,
            project: {
              id: projects.id,
              title: sql<string>`coalesce(${projects.publishedMetadata}->>'title', ${projects.title})`,
              shortCode: projects.shortCode,
            },
            owner: { id: users.id, displayName: users.displayName },
            reason: projectReports.reason,
            detail: projectReports.detail,
            state: projectReports.state,
            createdAt: projectReports.createdAt,
            resolvedAt: projectReports.resolvedAt,
            openCount: sql<number>`(select count(*)::int from project_reports r where r.project_id = ${projects.id} and r.state = 'open')`,
            cursorAt: cursorTime(projectReports.createdAt),
          })
          .from(projectReports)
          .innerJoin(projects, eq(projects.id, projectReports.projectId))
          .innerJoin(users, eq(users.id, projects.ownerId))
          .where(
            and(
              eq(projectReports.state, request.query.state ?? "open"),
              c
                ? or(
                    lt(projectReports.createdAt, sql`${c.at}::timestamptz`),
                    and(
                      eq(projectReports.createdAt, sql`${c.at}::timestamptz`),
                      lt(projectReports.id, c.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(projectReports.createdAt), desc(projectReports.id))
          .limit(31);
        const page = rows.slice(0, 30);
        await adminAudit(
          tx,
          actor.id,
          "admin.reports_inspected",
          "user",
          actor.id,
        );
        return {
          reports: page.map(({ cursorAt, ...r }) => r),
          nextCursor:
            rows.length > 30
              ? encodeCursor(page.at(-1)!.cursorAt, page.at(-1)!.id)
              : null,
        };
      }),
  );
  app.post<{
    Params: { id: string };
    Body: { action: "dismiss" | "resolve"; reason: string };
  }>(
    "/api/v1/admin/reports/:id/review",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["action", "reason"],
          properties: {
            action: { enum: ["dismiss", "resolve"] },
            reason: {
              type: "string",
              minLength: 1,
              maxLength: 2000,
              pattern: "\\S",
            },
          },
        },
      },
    },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        const [r] = await tx
          .select()
          .from(projectReports)
          .where(eq(projectReports.id, request.params.id))
          .for("update");
        if (!r) throw new ApiError(404, "NOT_FOUND");
        if (r.state !== "open") throw new ApiError(409, "VERSION_CONFLICT");
        await tx
          .update(projectReports)
          .set({
            state: request.body.action === "dismiss" ? "dismissed" : "resolved",
            resolvedAt: new Date(),
          })
          .where(eq(projectReports.id, r.id));
        await tx
          .insert(moderationActions)
          .values({
            actorId: actor.id,
            projectId: r.projectId,
            reportId: r.id,
            action: `report.${request.body.action}`,
            reason: request.body.reason,
          });
        await adminAudit(
          tx,
          actor.id,
          `admin.report_${request.body.action}`,
          "project",
          r.projectId,
          { reportId: r.id, reason: request.body.reason },
        );
        return { ok: true };
      }),
  );
}
