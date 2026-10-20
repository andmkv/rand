import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { can, type Permission, type Principal } from "../shared/permissions.js";
import type { Database } from "./db/client.js";
import { users, sessions } from "./db/schema.js";
import { ApiError } from "./errors.js";
export const sessionCookie = "randusr_session";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function resolvePrincipal(
  db: Database,
  token: string | undefined,
): Promise<Principal | null> {
  if (!token || !/^[a-zA-Z0-9_-]{43,128}$/.test(token)) return null;
  const [user] = await db
    .select({
      id: users.id,
      verifiedAt: users.verifiedAt,
      state: users.state,
      isAdmin: users.isAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
        eq(users.state, "active"),
      ),
    )
    .limit(1);
  return user
    ? {
        id: user.id,
        verified: user.verifiedAt !== null,
        active: true,
        isAdmin: user.isAdmin,
      }
    : null;
}
export function requirePermission(db: Database, permission: Permission) {
  return async (request: FastifyRequest) => {
    const p = await resolvePrincipal(db, request.cookies[sessionCookie]);
    if (can(p, permission)) return;
    if (!p) throw new ApiError(401, "AUTH_REQUIRED");
    if (!p.verified && permission !== "accountSettings")
      throw new ApiError(403, "EMAIL_UNVERIFIED");
    throw new ApiError(403, "FORBIDDEN");
  };
}
