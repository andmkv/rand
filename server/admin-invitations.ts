import { and, desc, eq, gt, isNull, isNotNull, lt, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import type { AuthConfig } from "./auth-config.js";
import { registrationInvitations, auditLog } from "./db/schema.js";
import { requirePermission } from "./access.js";
import { adminTransaction, adminAudit } from "./admin-access.js";
import { createInvitation } from "./invitations.js";
import { decodeCursor, encodeCursor, cursorTime } from "./cursor.js";
import { projectParams } from "./projects.js";
import { ApiError } from "./errors.js";
import type { InvitationPage, InvitationStatus } from "../shared/admin.js";
const locales = ["en", "ru", "es", "fr", "de", "sr-Latn", "ja", "uk"];
/** Admin-issued invitations: the single-use token only ever travels by email, never in a response or log. */
export function registerAdminInvitations(
  app: FastifyInstance,
  db: Database,
  config: AuthConfig,
) {
  const guard = requirePermission(db, "administer");
  const actorOf = (request: Parameters<typeof adminTransaction>[1]) =>
    adminTransaction(db, request, async (_tx, actor) => actor.id);
  const status = (r: {
    usedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  }): InvitationStatus =>
    r.revokedAt
      ? "revoked"
      : r.usedAt
        ? "used"
        : r.expiresAt <= new Date()
          ? "expired"
          : "active";
  async function issue(
    actorId: string,
    email: string,
    locale: string,
    mechanism: string,
  ) {
    email = email.trim().toLowerCase();
    const invitation = await createInvitation(db, email, mechanism, actorId);
    try {
      await config.mailer.send(email, "invite", locale, invitation.token);
    } catch {
      // Never report success for mail that was not sent: withdraw the unusable link.
      await db
        .update(registrationInvitations)
        .set({ revokedAt: new Date() })
        .where(eq(registrationInvitations.id, invitation.id));
      throw new ApiError(503, "MAIL_UNAVAILABLE");
    }
    return {
      id: invitation.id,
      email,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }
  app.post<{ Body: { email: string; adultTester: true; locale?: string } }>(
    "/api/v1/admin/invitations",
    {
      preHandler: guard,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "adultTester"],
          properties: {
            email: { type: "string", minLength: 3, maxLength: 320 },
            adultTester: { const: true },
            locale: { enum: locales },
          },
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request) =>
      issue(
        await actorOf(request),
        request.body.email,
        request.body.locale ?? "en",
        "admin",
      ),
  );
  app.get<{ Querystring: { status?: InvitationStatus; cursor?: string } }>(
    "/api/v1/admin/invitations",
    {
      preHandler: guard,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { enum: ["active", "expired", "used", "revoked"] },
            cursor: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (request): Promise<InvitationPage> => {
      const t = registrationInvitations,
        c = decodeCursor(request.query.cursor),
        now = new Date(),
        filter = {
          revoked: isNotNull(t.revokedAt),
          used: and(isNull(t.revokedAt), isNotNull(t.usedAt)),
          expired: and(
            isNull(t.revokedAt),
            isNull(t.usedAt),
            lt(t.expiresAt, now),
          ),
          active: and(
            isNull(t.revokedAt),
            isNull(t.usedAt),
            gt(t.expiresAt, now),
          ),
        }[request.query.status ?? "active"],
        rows = await db
          .select({
            id: t.id,
            email: t.email,
            createdAt: t.createdAt,
            expiresAt: t.expiresAt,
            usedAt: t.usedAt,
            revokedAt: t.revokedAt,
            mechanism: sql<string | null>`(select a.metadata->>'mechanism' from ${auditLog} a where a.target_id = registration_invitations.id and a.action = 'registration.invited' limit 1)`,
            cursorAt: cursorTime(t.createdAt),
          })
          .from(t)
          .where(
            and(
              request.query.status ? filter : undefined,
              c
                ? or(
                    lt(t.createdAt, sql`${c.at}::timestamptz`),
                    and(
                      eq(t.createdAt, sql`${c.at}::timestamptz`),
                      lt(t.id, c.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(t.createdAt), desc(t.id))
          .limit(31),
        page = rows.slice(0, 30);
      return {
        invitations: page.map((r) => ({
          id: r.id,
          email: r.email,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          status: status(r),
          mechanism: r.mechanism,
        })),
        nextCursor:
          rows.length > 30
            ? encodeCursor(page.at(-1)!.cursorAt, page.at(-1)!.id)
            : null,
      };
    },
  );
  app.post<{ Params: { id: string }; Body: { locale?: string } }>(
    "/api/v1/admin/invitations/:id/resend",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: { locale: { enum: locales } },
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request) => {
      const actorId = await actorOf(request);
      const [row] = await db
        .select()
        .from(registrationInvitations)
        .where(eq(registrationInvitations.id, request.params.id));
      if (!row || row.usedAt) throw new ApiError(404, "NOT_FOUND");
      // A resend revokes every earlier unused link for this address and mails a fresh one.
      return issue(actorId, row.email, request.body?.locale ?? "en", "admin-resend");
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/invitations/:id/revoke",
    {
      preHandler: guard,
      schema: {
        params: projectParams,
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request) =>
      adminTransaction(db, request, async (tx, actor) => {
        const [row] = await tx
          .update(registrationInvitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(registrationInvitations.id, request.params.id),
              isNull(registrationInvitations.usedAt),
              isNull(registrationInvitations.revokedAt),
            ),
          )
          .returning({ id: registrationInvitations.id });
        if (!row) throw new ApiError(404, "NOT_FOUND");
        await adminAudit(
          tx,
          actor.id,
          "registration.revoked",
          "invitation",
          row.id,
        );
        return { ok: true };
      }),
  );
}
