import argon2 from "argon2";
import { and, eq, gt, isNull, isNotNull, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Database } from "./db/client.js";
import { users, sessions, auditLog } from "./db/schema.js";
import { hashToken, sessionCookie } from "./access.js";
import { ApiError } from "./errors.js";
export type AdminTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type AdminUser = typeof users.$inferSelect;
export async function adminTransaction<T>(
  db: Database,
  request: FastifyRequest,
  work: (tx: AdminTx, actor: AdminUser) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    // Serialize privilege/lifecycle changes, including concurrent last-admin removal attempts.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('randusr.admin-authority'))`,
    );
    const [row] = await tx
      .select({ u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(
            sessions.tokenHash,
            hashToken(request.cookies[sessionCookie] ?? ""),
          ),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.state, "active"),
          isNotNull(users.verifiedAt),
          eq(users.isAdmin, true),
        ),
      )
      .for("no key update", { of: users });
    if (!row) throw new ApiError(403, "FORBIDDEN");
    return work(tx, row.u);
  });
}
export async function assertAdminPassword(actor: AdminUser, password: string) {
  let valid = false;
  try {
    valid = await argon2.verify(actor.passwordHash, password);
  } catch {
    /* invalid hashes never authenticate */
  }
  if (!valid) throw new ApiError(401, "INVALID_CREDENTIALS");
}
export async function protectLastAdmin(tx: AdminTx, target: AdminUser) {
  if (!target.isAdmin || target.state !== "active" || !target.verifiedAt)
    return;
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.isAdmin, true),
        eq(users.state, "active"),
        isNotNull(users.verifiedAt),
      ),
    );
  if (count <= 1) throw new ApiError(409, "LAST_ADMIN");
}
export async function adminAudit(
  tx: AdminTx,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await tx
    .insert(auditLog)
    .values({ actorId, action, targetType, targetId, metadata });
}
