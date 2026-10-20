import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./db/client.js";
import { registrationInvitations, users, auditLog } from "./db/schema.js";
import { hashToken } from "./access.js";
import { ApiError } from "./errors.js";
import type { AdminTx } from "./admin-access.js";
export async function createInvitation(
  db: Database,
  email: string,
  mechanism = "operator-cli",
  actorId: string | null = null,
) {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)
  )
    throw new ApiError(400, "INVALID_INPUT");
  const token = randomBytes(32).toString("base64url");
  const invitation = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"invite:" + normalized}))`,
    );
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalized));
    if (existing)
      throw new ApiError(409, "ACCOUNT_EXISTS");
    await tx
      .update(registrationInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(registrationInvitations.email, normalized),
          isNull(registrationInvitations.usedAt),
          isNull(registrationInvitations.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(registrationInvitations)
      .values({
        email: normalized,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();
    await tx.insert(auditLog).values({
      actorId,
      action: "registration.invited",
      targetType: "invitation",
      targetId: row.id,
      metadata: { mechanism },
    });
    return row;
  });
  return { token, id: invitation.id, expiresAt: invitation.expiresAt };
}
export async function checkInvitation(
  db: Database,
  email: string,
  token?: string,
) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new ApiError(403, "REGISTRATION_CLOSED");
  const [row] = await db
    .select({ id: registrationInvitations.id })
    .from(registrationInvitations)
    .where(
      and(
        eq(registrationInvitations.email, email),
        eq(registrationInvitations.tokenHash, hashToken(token)),
        isNull(registrationInvitations.usedAt),
        isNull(registrationInvitations.revokedAt),
        gt(registrationInvitations.expiresAt, new Date()),
      ),
    );
  if (!row) throw new ApiError(403, "REGISTRATION_CLOSED");
}
export async function consumeInvitation(
  tx: AdminTx,
  email: string,
  token?: string,
) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new ApiError(403, "REGISTRATION_CLOSED");
  const [invitation] = await tx
    .update(registrationInvitations)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(registrationInvitations.email, email),
        eq(registrationInvitations.tokenHash, hashToken(token)),
        isNull(registrationInvitations.usedAt),
        isNull(registrationInvitations.revokedAt),
        gt(registrationInvitations.expiresAt, new Date()),
      ),
    )
    .returning({ id: registrationInvitations.id });
  if (!invitation) throw new ApiError(403, "REGISTRATION_CLOSED");
}
