import { deleteAccountData } from "./lifecycle-core.js";
import { operationsStatus } from "./operations.js";
import { randomBytes } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  isNotNull,
  ilike,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import type { AuthConfig } from "./auth-config.js";
import {
  users,
  sessions,
  projects,
  projectRevisions,
  emailVerificationTokens,
  passwordResetTokens,
  moderationActions,
  projectReports,
  auditLog,
} from "./db/schema.js";
import { requirePermission, hashToken } from "./access.js";
import {
  adminTransaction,
  adminAudit,
  assertAdminPassword,
  protectLastAdmin,
  type AdminTx,
  type AdminUser,
} from "./admin-access.js";
import { projectParams, assertVersion } from "./projects.js";
import { ApiError } from "./errors.js";
import { decodeCursor, encodeCursor, cursorTime } from "./cursor.js";
const reasonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 2000,
  pattern: "\\S",
};
const cursorSchema = { type: "string", maxLength: 200 };
const passwordSchema = { type: "string", minLength: 1, maxLength: 128 };
const querySchema = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties: { cursor: cursorSchema, ...properties },
});
const bodySchema = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, required, properties });
const term = (q?: string) =>
  q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : undefined;
const userFields = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  isAdmin: users.isAdmin,
  verifiedAt: users.verifiedAt,
  state: users.state,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};
async function targetUser(tx: AdminTx, id: string) {
  const [u] = await tx
    .select()
    .from(users)
    .where(eq(users.id, id))
    .for("no key update");
  if (!u) throw new ApiError(404, "NOT_FOUND");
  return u;
}
function userDto(
  u: Pick<
    AdminUser,
    | "id"
    | "email"
    | "displayName"
    | "isAdmin"
    | "verifiedAt"
    | "state"
    | "createdAt"
    | "updatedAt"
  >,
) {
  return {
    ...u,
    verified: !!u.verifiedAt,
    verifiedAt: u.verifiedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}
export function registerAdmin(
  app: FastifyInstance,
  db: Database,
  config: AuthConfig,
) {
  const guard = requirePermission(db, "administer");
  app.get("/api/v1/admin/operations", { preHandler: guard }, () =>
    operationsStatus(),
  );
  app.get<{
    Querystring: {
      q?: string;
      verified?: boolean;
      state?: "active" | "suspended" | "deleted";
      after?: string;
      before?: string;
      cursor?: string;
    };
  }>(
    "/api/v1/admin/users",
    {
      preHandler: guard,
      schema: {
        querystring: querySchema({
          q: { type: "string", maxLength: 120 },
          verified: { type: "boolean" },
          state: { enum: ["active", "suspended", "deleted"] },
          after: { type: "string", format: "date-time" },
          before: { type: "string", format: "date-time" },
        }),
      },
    },
    async (request) => {
      const q = request.query,
        c = decodeCursor(q.cursor),
        t = term(q.q),
        rows = await db
          .select({ ...userFields, cursorAt: cursorTime(users.createdAt) })
          .from(users)
          .where(
            and(
              t
                ? or(
                    ilike(users.email, t),
                    ilike(users.displayName, t),
                    ilike(sql`${users.id}::text`, t),
                  )
                : undefined,
              q.verified === undefined
                ? undefined
                : q.verified
                  ? isNotNull(users.verifiedAt)
                  : isNull(users.verifiedAt),
              q.state ? eq(users.state, q.state) : undefined,
              q.after ? gt(users.createdAt, new Date(q.after)) : undefined,
              q.before ? lt(users.createdAt, new Date(q.before)) : undefined,
              c
                ? or(
                    lt(users.createdAt, sql`${c.at}::timestamptz`),
                    and(
                      eq(users.createdAt, sql`${c.at}::timestamptz`),
                      lt(users.id, c.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(users.createdAt), desc(users.id))
          .limit(31),
        page = rows.slice(0, 30);
      return {
        users: page.map(({ cursorAt, ...u }) => userDto(u)),
        nextCursor:
          rows.length > 30
            ? encodeCursor(page.at(-1)!.cursorAt, page.at(-1)!.id)
            : null,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/admin/users/:id",
    { preHandler: guard, schema: { params: projectParams } },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        const u = await targetUser(tx, request.params.id),
          [{ projectCount, publicCount }] = await tx
            .select({
              projectCount: sql<number>`count(*)::int`,
              publicCount: sql<number>`count(*) filter(where ${projects.visibility}='public')::int`,
            })
            .from(projects)
            .where(and(eq(projects.ownerId, u.id), isNull(projects.deletedAt))),
          [{ lastSessionAt, activeSessions }] = await tx
            .select({
              lastSessionAt: sql<Date | null>`max(${sessions.createdAt})`,
              activeSessions: sql<number>`count(*) filter(where ${sessions.revokedAt} is null and ${sessions.expiresAt}>now())::int`,
            })
            .from(sessions)
            .where(eq(sessions.userId, u.id));
        await adminAudit(tx, actor.id, "admin.user_inspected", "user", u.id);
        return {
          ...userDto(u),
          locale: u.locale,
          projectCount,
          publicCount,
          lastSessionAt,
          activeSessions,
        };
      }),
  );
  app.post<{
    Params: { id: string };
    Body: { enabled: boolean; reason: string; currentPassword: string };
  }>(
    "/api/v1/admin/users/:id/admin",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: bodySchema({
          enabled: { type: "boolean" },
          reason: reasonSchema,
          currentPassword: passwordSchema,
        }),
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        await assertAdminPassword(actor, request.body.currentPassword);
        const u = await targetUser(tx, request.params.id);
        if (
          u.state === "deleted" ||
          (request.body.enabled && (u.state !== "active" || !u.verifiedAt))
        )
          throw new ApiError(403, "FORBIDDEN");
        if (u.isAdmin === request.body.enabled) return { ok: true };
        if (!request.body.enabled) await protectLastAdmin(tx, u);
        await tx
          .update(users)
          .set({ isAdmin: request.body.enabled, updatedAt: new Date() })
          .where(eq(users.id, u.id));
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.userId, u.id));
        await adminAudit(
          tx,
          actor.id,
          request.body.enabled ? "admin.granted" : "admin.revoked",
          "user",
          u.id,
          { reason: request.body.reason },
        );
        return { ok: true };
      }),
  );
  app.post<{
    Params: { id: string };
    Body: { state: "active" | "suspended"; reason: string };
  }>(
    "/api/v1/admin/users/:id/state",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: bodySchema({
          state: { enum: ["active", "suspended"] },
          reason: reasonSchema,
        }),
      },
    },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        const u = await targetUser(tx, request.params.id);
        if (u.state === "deleted") throw new ApiError(403, "FORBIDDEN");
        if (u.state === request.body.state) return { ok: true };
        if (request.body.state === "suspended") await protectLastAdmin(tx, u);
        await tx
          .update(users)
          .set({ state: request.body.state, updatedAt: new Date() })
          .where(eq(users.id, u.id));
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.userId, u.id));
        await adminAudit(
          tx,
          actor.id,
          `admin.user_${request.body.state}`,
          "user",
          u.id,
          { reason: request.body.reason },
        );
        return { ok: true };
      }),
  );
  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    "/api/v1/admin/users/:id/logout",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: bodySchema({ reason: reasonSchema }),
      },
    },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        const u = await targetUser(tx, request.params.id);
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.userId, u.id));
        await adminAudit(tx, actor.id, "admin.sessions_revoked", "user", u.id, {
          reason: request.body.reason,
        });
        return { ok: true };
      }),
  );
  app.post<{
    Params: { id: string };
    Body: { kind: "verify" | "reset"; reason: string };
  }>(
    "/api/v1/admin/users/:id/mail",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: bodySchema({
          kind: { enum: ["verify", "reset"] },
          reason: reasonSchema,
        }),
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request) => {
      const raw = randomBytes(32).toString("base64url"),
        u = await adminTransaction(db, request, async (tx, actor) => {
          const u = await targetUser(tx, request.params.id);
          if (
            u.state !== "active" ||
            (request.body.kind === "verify" && u.verifiedAt)
          )
            throw new ApiError(403, "FORBIDDEN");
          const table =
            request.body.kind === "verify"
              ? emailVerificationTokens
              : passwordResetTokens;
          await tx
            .update(table)
            .set({ usedAt: new Date() })
            .where(and(eq(table.userId, u.id), isNull(table.usedAt)));
          await tx.insert(table).values({
            userId: u.id,
            tokenHash: hashToken(raw),
            expiresAt: new Date(
              Date.now() +
                (request.body.kind === "verify" ? 86400000 : 1800000),
            ),
          });
          await adminAudit(
            tx,
            actor.id,
            `admin.${request.body.kind}_requested`,
            "user",
            u.id,
            { reason: request.body.reason },
          );
          return u;
        });
      try {
        await config.mailer.send(u.email, request.body.kind, u.locale, raw);
      } catch {
        throw new ApiError(503, "MAIL_UNAVAILABLE");
      }
      return { ok: true };
    },
  );
  app.get<{
    Querystring: {
      q?: string;
      ownerId?: string;
      visibility?: "private" | "unlisted" | "public";
      moderation?: "active" | "blocked";
      deleted?: boolean;
      cursor?: string;
    };
  }>(
    "/api/v1/admin/projects",
    {
      preHandler: guard,
      schema: {
        querystring: querySchema({
          q: { type: "string", maxLength: 120 },
          ownerId: { type: "string", format: "uuid" },
          visibility: { enum: ["private", "unlisted", "public"] },
          moderation: { enum: ["active", "blocked"] },
          deleted: { type: "boolean" },
        }),
      },
    },
    async (request) => {
      const q = request.query,
        c = decodeCursor(q.cursor),
        t = term(q.q),
        rows = await db
          .select({
            id: projects.id,
            title: projects.title,
            owner: { id: users.id, displayName: users.displayName },
            shortCode: projects.shortCode,
            visibility: projects.visibility,
            moderationState: projects.moderationState,
            featured: projects.featured,
            version: projects.version,
            updatedAt: projects.updatedAt,
            deletedAt: projects.deletedAt,
            cursorAt: cursorTime(projects.updatedAt),
          })
          .from(projects)
          .innerJoin(users, eq(users.id, projects.ownerId))
          .where(
            and(
              t
                ? or(
                    ilike(projects.title, t),
                    ilike(projects.shortCode, t),
                    ilike(users.email, t),
                    ilike(users.displayName, t),
                  )
                : undefined,
              q.ownerId ? eq(projects.ownerId, q.ownerId) : undefined,
              q.visibility ? eq(projects.visibility, q.visibility) : undefined,
              q.moderation
                ? eq(projects.moderationState, q.moderation)
                : undefined,
              q.deleted
                ? isNotNull(projects.deletedAt)
                : isNull(projects.deletedAt),
              c
                ? or(
                    lt(projects.updatedAt, sql`${c.at}::timestamptz`),
                    and(
                      eq(projects.updatedAt, sql`${c.at}::timestamptz`),
                      lt(projects.id, c.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(projects.updatedAt), desc(projects.id))
          .limit(31),
        page = rows.slice(0, 30);
      return {
        projects: page.map(({ cursorAt, ...p }) => p),
        nextCursor:
          rows.length > 30
            ? encodeCursor(page.at(-1)!.cursorAt, page.at(-1)!.id)
            : null,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/admin/projects/:id",
    { preHandler: guard, schema: { params: projectParams } },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        const [r] = await tx
          .select({
            p: projects,
            owner: { id: users.id, displayName: users.displayName },
          })
          .from(projects)
          .innerJoin(users, eq(users.id, projects.ownerId))
          .where(eq(projects.id, request.params.id));
        if (!r) throw new ApiError(404, "NOT_FOUND");
        const p = r.p,
          [published] = p.publishedRevisionId
            ? await tx
                .select({ snapshot: projectRevisions.snapshot })
                .from(projectRevisions)
                .where(eq(projectRevisions.id, p.publishedRevisionId))
            : [];
        await adminAudit(
          tx,
          actor.id,
          "admin.project_inspected",
          "project",
          p.id,
        );
        return {
          id: p.id,
          shortCode: p.shortCode,
          title: p.title,
          description: p.description,
          owner: r.owner,
          visibility: p.visibility,
          moderationState: p.moderationState,
          version: p.version,
          featured: p.featured,
          revisionId: p.publishedRevisionId,
          deleted: !!p.deletedAt,
          archived: !!p.archivedAt,
          snapshot: p.snapshot,
          publishedSnapshot: published?.snapshot ?? null,
          publishedMetadata: p.publishedMetadata,
        };
      }),
  );
  app.post<{
    Params: { id: string };
    Body: {
      version: number;
      action: "unpublish" | "block" | "unblock";
      reason: string;
    };
  }>(
    "/api/v1/admin/projects/:id/moderate",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: bodySchema({
          version: { type: "integer", minimum: 1 },
          action: { enum: ["unpublish", "block", "unblock"] },
          reason: reasonSchema,
        }),
      },
    },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        const [p] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, request.params.id))
          .for("update");
        if (!p || p.deletedAt) throw new ApiError(404, "NOT_FOUND");
        assertVersion(p, request.body.version);
        await tx
          .update(projects)
          .set({
            version: p.version + 1,
            updatedAt: new Date(),
            ...(request.body.action === "unpublish"
              ? {
                  visibility: "private" as const,
                  publishedAt: null,
                  publishedRevisionId: null,
                  publishedMetadata: null,
                  featured: false,
                }
              : {
                  moderationState:
                    request.body.action === "block"
                      ? ("blocked" as const)
                      : ("active" as const),
                  ...(request.body.action === "block"
                    ? { featured: false }
                    : {}),
                }),
          })
          .where(eq(projects.id, p.id));
        await tx.insert(moderationActions).values({
          actorId: actor.id,
          projectId: p.id,
          action: `project.${request.body.action}`,
          reason: request.body.reason,
        });
        await adminAudit(
          tx,
          actor.id,
          `admin.project_${request.body.action}`,
          "project",
          p.id,
          { reason: request.body.reason },
        );
        return { ok: true };
      }),
  );

  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/api/v1/admin/projects/:id/history",
    {
      preHandler: guard,
      schema: { params: projectParams, querystring: querySchema({}) },
    },
    async (request) => {
      const c = decodeCursor(request.query.cursor),
        rows = await db
          .select({
            row: moderationActions,
            cursorAt: cursorTime(moderationActions.createdAt),
          })
          .from(moderationActions)
          .where(
            and(
              eq(moderationActions.projectId, request.params.id),
              c
                ? or(
                    lt(moderationActions.createdAt, sql`${c.at}::timestamptz`),
                    and(
                      eq(
                        moderationActions.createdAt,
                        sql`${c.at}::timestamptz`,
                      ),
                      lt(moderationActions.id, c.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(
            desc(moderationActions.createdAt),
            desc(moderationActions.id),
          )
          .limit(31),
        page = rows.slice(0, 30);
      return {
        actions: page.map((r) => r.row),
        nextCursor:
          rows.length > 30
            ? encodeCursor(page.at(-1)!.cursorAt, page.at(-1)!.row.id)
            : null,
      };
    },
  );
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/api/v1/admin/projects/:id/reports",
    {
      preHandler: guard,
      schema: { params: projectParams, querystring: querySchema({}) },
    },
    async (request) => {
      const c = decodeCursor(request.query.cursor),
        rows = await db
          .select({
            id: projectReports.id,
            reason: projectReports.reason,
            detail: projectReports.detail,
            state: projectReports.state,
            createdAt: projectReports.createdAt,
            cursorAt: cursorTime(projectReports.createdAt),
          })
          .from(projectReports)
          .where(
            and(
              eq(projectReports.projectId, request.params.id),
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
          .limit(31),
        page = rows.slice(0, 30);
      return {
        reports: page.map(({ cursorAt, ...r }) => r),
        nextCursor:
          rows.length > 30
            ? encodeCursor(page.at(-1)!.cursorAt, page.at(-1)!.id)
            : null,
      };
    },
  );
  app.get<{
    Querystring: { targetId?: string; action?: string; cursor?: string };
  }>(
    "/api/v1/admin/audit",
    {
      preHandler: guard,
      schema: {
        querystring: querySchema({
          targetId: { type: "string", format: "uuid" },
          action: { type: "string", maxLength: 64 },
        }),
      },
    },
    async (request) => {
      const q = request.query,
        c = decodeCursor(q.cursor),
        rows = await db
          .select({
            id: auditLog.id,
            actorId: auditLog.actorId,
            targetId: auditLog.targetId,
            targetType: auditLog.targetType,
            action: auditLog.action,
            metadata: auditLog.metadata,
            createdAt: auditLog.createdAt,
            cursorAt: cursorTime(auditLog.createdAt),
          })
          .from(auditLog)
          .where(
            and(
              q.targetId ? eq(auditLog.targetId, q.targetId) : undefined,
              q.action ? eq(auditLog.action, q.action) : undefined,
              c
                ? or(
                    lt(auditLog.createdAt, sql`${c.at}::timestamptz`),
                    and(
                      eq(auditLog.createdAt, sql`${c.at}::timestamptz`),
                      lt(auditLog.id, c.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(31),
        page = rows.slice(0, 30);
      return {
        events: page.map(({ cursorAt, ...e }) => e),
        nextCursor:
          rows.length > 30
            ? encodeCursor(page.at(-1)!.cursorAt, page.at(-1)!.id)
            : null,
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: { reason: string; currentPassword: string };
  }>(
    "/api/v1/admin/users/:id/delete",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: bodySchema({
          reason: reasonSchema,
          currentPassword: passwordSchema,
        }),
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        await assertAdminPassword(actor, request.body.currentPassword);
        await deleteAccountData(
          tx,
          request.params.id,
          actor.id,
          request.body.reason,
        );
        return { ok: true };
      }),
  );
}
