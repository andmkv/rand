import argon2 from "argon2";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { and, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "./db/client.js";
import type { AuthConfig } from "./auth-config.js";
import { users, sessions } from "./db/schema.js";
import { currentUser } from "./auth.js";
import { sessionCookie, hashToken } from "./access.js";
import { deleteAccountData } from "./lifecycle-core.js";
import { ApiError } from "./errors.js";
import type { AdminTx } from "./admin-access.js";
async function exportIdentity(tx: AdminTx, request: FastifyRequest) {
  const [row] = await tx
    .select({ u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(request.cookies[sessionCookie] ?? "")),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.state, "active"),
      ),
    );
  if (!row) throw new ApiError(401, "AUTH_REQUIRED");
  return row.u;
}
async function* exportRecords(tx: AdminTx, u: typeof users.$inferSelect) {
  const line = (recordType: string, data: unknown) =>
    JSON.stringify({ recordType, data }) + "\n";
  yield line("manifest", {
    format: "randusr-account-export",
    version: 1,
    createdAt: new Date().toISOString(),
  });
  yield line("profile", {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    locale: u.locale,
    isAdmin: u.isAdmin,
    verifiedAt: u.verifiedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    termsVersion: u.termsVersion,
    privacyVersion: u.privacyVersion,
    acceptedAt: u.acceptedAt,
    testNoticeVersion: u.testNoticeVersion,
    testNoticeAcknowledgedAt: u.testNoticeAcknowledgedAt,
  });
  // Keyset pages keep large source/history exports out of server memory. All projections are explicit.
  async function* pages(recordType: string, query: (after: string) => SQL) {
    let after = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const result = await tx.execute<{ data: { id: string } }>(query(after));
      for (const row of result.rows) yield line(recordType, row.data);
      if (result.rows.length < 50) break;
      after = result.rows.at(-1)!.data.id;
    }
  }
  yield* pages(
    "project",
    (after) =>
      sql`select row_to_json(r) as data from (select id,short_code,title,description,mode,story_id,scene_id,snapshot,snapshot_version,version,visibility,moderation_state,published_at,published_metadata,preview_key,created_at,updated_at,archived_at,deleted_at from projects where owner_id=${u.id} and id>${after}::uuid order by id limit 50) r`,
  );
  yield* pages(
    "revision",
    (after) =>
      sql`select row_to_json(r) as data from (select r.id,r.project_id,r.number,r.snapshot,r.reason,r.created_at from project_revisions r join projects p on p.id=r.project_id where p.owner_id=${u.id} and r.id>${after}::uuid order by r.id limit 50) r`,
  );
  yield* pages(
    "asset",
    (after) =>
      sql`select row_to_json(r) as data from (select id,type,name,alias,latest_version,created_at,updated_at,archived_at from user_assets where owner_id=${u.id} and id>${after}::uuid order by id limit 50) r`,
  );
  yield* pages(
    "assetVersion",
    (after) =>
      sql`select row_to_json(r) as data from (select v.id,v.asset_id,v.number,v.sprite,v.sha256,v.created_at from user_asset_versions v join user_assets a on a.id=v.asset_id where a.owner_id=${u.id} and v.id>${after}::uuid order by v.id limit 50) r`,
  );
  yield* pages(
    "projectPreview",
    (after) => sql`select row_to_json(r) as data from (
    select a.id,a.project_id,a.width,a.height,a.byte_length,a.sha256,a.created_at,translate(encode(a.png,'base64'),chr(10),'') as png_base64
    from project_previews a join projects p on p.id=a.project_id where p.owner_id=${u.id} and p.deleted_at is null and a.id>${after}::uuid order by a.id limit 50) r`,
  );
  yield* pages(
    "report",
    (after) =>
      sql`select row_to_json(r) as data from (select id,project_id,reason,detail,state,created_at,resolved_at from project_reports where reporter_id=${u.id} and id>${after}::uuid order by id limit 50) r`,
  );
  yield line("complete", { complete: true });
}
export function registerLifecycle(
  app: FastifyInstance,
  db: Database,
  config: AuthConfig,
) {
  app.get(
    "/api/v1/account/export",
    { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } },
    async (request, reply) => {
      await currentUser(db, request);
      await db.transaction(
        async (tx) => {
          const u = await exportIdentity(tx, request);
          const stream = Readable.from(exportRecords(tx, u));
          const timer = setTimeout(
            () => stream.destroy(new Error("EXPORT_TIMEOUT")),
            120000,
          );
          timer.unref();
          const disconnect = () => {
            if (!reply.raw.writableFinished)
              stream.destroy(new Error("EXPORT_CANCELLED"));
          };
          reply.raw.once("close", disconnect);
          reply
            .type("application/x-ndjson; charset=utf-8")
            .header(
              "Content-Disposition",
              'attachment; filename="randomize-usr-account.ndjson"',
            )
            .header("X-Robots-Tag", "noindex, nofollow");
          reply.send(stream);
          try {
            await finished(stream);
          } finally {
            clearTimeout(timer);
            reply.raw.off("close", disconnect);
          }
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      return reply;
    },
  );
  app.post<{ Body: { currentPassword: string; confirmEmail: string } }>(
    "/api/v1/account/delete",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword", "confirmEmail"],
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 128 },
            confirmEmail: { type: "string", minLength: 3, maxLength: 320 },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const u = await currentUser(db, request);
      if (
        request.body.confirmEmail.trim().toLowerCase() !== u.email ||
        !(await argon2
          .verify(u.passwordHash, request.body.currentPassword)
          .catch(() => false))
      )
        throw new ApiError(401, "INVALID_CREDENTIALS");
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('randusr.admin-authority'))`,
        );
        const [locked] = await tx
          .select()
          .from(users)
          .where(eq(users.id, u.id))
          .for("no key update");
        const fresh = await exportIdentity(tx, request);
        if (
          locked.state !== "active" ||
          fresh.id !== u.id ||
          locked.passwordHash !== u.passwordHash
        )
          throw new ApiError(401, "INVALID_CREDENTIALS");
        await deleteAccountData(tx, u.id, u.id, "self-service");
      });
      reply.clearCookie(sessionCookie, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
      });
      return { ok: true };
    },
  );
}
