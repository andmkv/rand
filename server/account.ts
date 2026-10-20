import argon2 from "argon2";
import { eq, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import type { AuthConfig } from "./auth-config.js";
import { currentUser, accountDto, hashPassword } from "./auth.js";
import { users, sessions, auditLog, passwordResetTokens } from "./db/schema.js";
import { ApiError } from "./errors.js";
import { sessionCookie } from "./access.js";
export function publicProfile(
  user: Pick<typeof users.$inferSelect, "id" | "displayName">,
) {
  return { id: user.id, displayName: user.displayName };
}
export async function registerAccount(
  app: FastifyInstance,
  db: Database,
  config: AuthConfig,
) {
  app.patch<{ Body: { displayName?: string; locale?: string } }>(
    "/api/v1/account",
    {
      schema: {
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            displayName: {
              type: "string",
              minLength: 1,
              maxLength: 80,
              pattern: "^[^<>\\x00-\\x1F]+$",
            },
            locale: {
              enum: ["en", "ru", "es", "fr", "de", "sr-Latn", "ja", "uk"],
            },
          },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const user = await currentUser(db, request);
      const b = request.body;
      if (b.displayName !== undefined && !b.displayName.trim())
        throw new ApiError(400, "INVALID_INPUT");
      return db.transaction(async (tx) => {
        const [updated] = await tx
          .update(users)
          .set({
            ...(b.displayName !== undefined
              ? { displayName: b.displayName.trim() }
              : {}),
            ...(b.locale ? { locale: b.locale } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, user.id), eq(users.state, "active")))
          .returning();
        if (!updated) throw new ApiError(401, "AUTH_REQUIRED");
        await tx.insert(auditLog).values({
          actorId: user.id,
          action: "account.updated",
          targetType: "user",
          targetId: user.id,
          metadata: { localeChanged: !!b.locale },
        });
        return accountDto(updated);
      });
    },
  );
  app.post<{ Body: { currentPassword: string; password: string } }>(
    "/api/v1/account/password",
    {
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "password"],
          additionalProperties: false,
          properties: {
            currentPassword: { type: "string", minLength: 12, maxLength: 128 },
            password: { type: "string", minLength: 12, maxLength: 128 },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const user = await currentUser(db, request);
      if (
        !(await argon2
          .verify(user.passwordHash, request.body.currentPassword)
          .catch(() => false))
      )
        throw new ApiError(401, "INVALID_CREDENTIALS");
      const passwordHash = await hashPassword(request.body.password);
      await db.transaction(async (tx) => {
        const [fresh] = await tx
          .select()
          .from(users)
          .where(eq(users.id, user.id))
          .for("update");
        if (
          fresh.passwordHash !== user.passwordHash ||
          fresh.state !== "active"
        )
          throw new ApiError(401, "INVALID_CREDENTIALS");
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, user.id));
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.userId, user.id));
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(eq(passwordResetTokens.userId, user.id));
        await tx.insert(auditLog).values({
          actorId: user.id,
          action: "account.password_changed",
          targetType: "user",
          targetId: user.id,
        });
      });
      reply.clearCookie(sessionCookie, {
        path: "/",
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: "lax",
      });
      try {
        await config.mailer.send(user.email, "passwordChanged", user.locale);
      } catch {
        /* completed password change is retained */
      }
      return { ok: true };
    },
  );
  app.post(
    "/api/v1/account/sign-out-all",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const user = await currentUser(db, request);
      await db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, user.id))
          .for("update");
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.userId, user.id));
        await tx.insert(auditLog).values({
          actorId: user.id,
          action: "account.sessions_revoked",
          targetType: "user",
          targetId: user.id,
        });
      });
      reply.clearCookie(sessionCookie, {
        path: "/",
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: "lax",
      });
      return { ok: true };
    },
  );
}
