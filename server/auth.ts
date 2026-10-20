import {
  consumeInvitation,
  checkInvitation,
  createInvitation,
} from "./invitations.js";
import { closedTestNoticeVersion } from "../shared/registration.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "./db/client.js";
import {
  users,
  sessions,
  emailVerificationTokens as verification,
  passwordResetTokens as resets,
  auditLog,
} from "./db/schema.js";
import { hashToken, resolvePrincipal, sessionCookie } from "./access.js";
import { ApiError } from "./errors.js";
import type { AuthConfig } from "./auth-config.js";
import { adminRoleLockId } from "./admin-recovery.js";
const token = () => randomBytes(32).toString("base64url");
const passwordOptions: argon2.HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};
export const hashPassword = (password: string) =>
  argon2.hash(password, passwordOptions);
const passwordSchema = { type: "string", minLength: 12, maxLength: 128 };
const emailSchema = {
  type: "string",
  minLength: 3,
  maxLength: 320,
  format: "email",
};
const tokenSchema = { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" };
const schema = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({
  body: { type: "object", additionalProperties: false, properties, required },
});
const normalize = (email: string) => email.trim().toLowerCase();
export const csrfCookieName = "randusr_csrf";
const csrfCookie = csrfCookieName;
export function protectMutation(request: FastifyRequest, config: AuthConfig) {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    !request.url.startsWith("/api/")
  )
    return;
  const origin = request.headers.origin;
  const sent = request.headers["x-csrf-token"],
    stored = request.cookies[csrfCookie];
  if (
    origin !== config.baseUrl ||
    typeof sent !== "string" ||
    !stored ||
    sent.length !== stored.length ||
    !/^[A-Za-z0-9_-]{43}$/.test(sent) ||
    !timingSafeEqual(Buffer.from(sent), Buffer.from(stored))
  )
    throw new ApiError(403, "CSRF_FAILED");
}
export async function currentUser(db: Database, request: FastifyRequest) {
  const p = await resolvePrincipal(db, request.cookies[sessionCookie]);
  if (!p) throw new ApiError(401, "AUTH_REQUIRED");
  const [user] = await db.select().from(users).where(eq(users.id, p.id));
  return user;
}
export function accountDto(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    verified: !!user.verifiedAt,
    createdAt: user.createdAt.toISOString(),
  };
}
export async function registerAuth(
  app: FastifyInstance,
  db: Database,
  config: AuthConfig,
  demoEnabled = false,
) {
  const pendingMail = new Set<Promise<void>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled([...pendingMail]);
  });
  const dummyHash = await hashPassword(token());
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.secureCookies,
  };
  const rate = (max: number, timeWindow = "15 minutes") => ({
    rateLimit: { max, timeWindow },
  });
  const audit = async (
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    action: string,
    userId: string,
  ) => {
    await tx.insert(auditLog).values({
      actorId: userId,
      action,
      targetType: "user",
      targetId: userId,
    });
  };
  async function setSession(
    userId: string,
    reply: FastifyReply,
    oldToken?: string,
    requireOld = false,
  ) {
    const value = token();
    await db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: users.id, state: users.state })
        .from(users)
        .where(eq(users.id, userId))
        .for("no key update");
      if (!active || active.state !== "active")
        throw new ApiError(401, "AUTH_REQUIRED");
      if (requireOld) {
        const [old] = await tx
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.tokenHash, hashToken(oldToken ?? "")),
              eq(sessions.userId, userId),
              isNull(sessions.revokedAt),
              gt(sessions.expiresAt, new Date()),
            ),
          )
          .for("update");
        if (!old) throw new ApiError(401, "AUTH_REQUIRED");
      }
      if (oldToken)
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(sessions.tokenHash, hashToken(oldToken)),
              eq(sessions.userId, userId),
            ),
          );
      await tx.insert(sessions).values({
        userId,
        tokenHash: hashToken(value),
        expiresAt: new Date(Date.now() + config.sessionDays * 86400000),
      });
    });
    reply.setCookie(sessionCookie, value, {
      ...cookieOptions,
      maxAge: config.sessionDays * 86400,
    });
  }
  app.get("/api/v1/auth/csrf", async (_request, reply) => {
    const value = token();
    reply.setCookie(csrfCookie, value, {
      ...cookieOptions,
      sameSite: "strict",
    });
    return { token: value };
  });
  app.get("/api/v1/auth/policy", async () => ({
    publicRegistrationEnabled: config.publicRegistrationEnabled === true,
    demoEnabled,
    closedTestNoticeVersion,
    termsVersion: config.termsVersion ?? null,
    privacyVersion: config.privacyVersion ?? null,
    termsUrl: config.termsUrl ?? null,
    privacyUrl: config.privacyUrl ?? null,
    supportEmail: config.supportEmail ?? null,
  }));
  app.get("/api/v1/auth/me", async (request) =>
    accountDto(await currentUser(db, request)),
  );
  // First administrator onboarding without operator CLI/files. The target is always the
  // configured bootstrap address; the response is generic and no email is accepted.
  app.post(
    "/api/v1/auth/bootstrap-invite",
    { config: rate(3, "1 hour") },
    async () => {
      if (config.publicRegistrationEnabled === true) return { ok: true };
      const email = config.adminEmail;
      if (!email) return { ok: true };
      const [bootstrapUsed] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.action, "admin.bootstrap"))
        .limit(1);
      if (bootstrapUsed) return { ok: true };
      const [admin] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.isAdmin, true),
            isNotNull(users.verifiedAt),
            eq(users.state, "active"),
          ),
        )
        .limit(1);
      if (admin) return { ok: true };
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing) {
        const raw = token();
        const issued = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${adminRoleLockId})`);
          const [used] = await tx
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(eq(auditLog.action, "admin.bootstrap"))
            .limit(1);
          const [activeAdmin] = await tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.isAdmin, true),
                isNotNull(users.verifiedAt),
                eq(users.state, "active"),
              ),
            )
            .limit(1);
          if (used || activeAdmin) return false;
          await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, existing.id))
            .for("update");
          await tx
            .update(verification)
            .set({ usedAt: new Date() })
            .where(
              and(
                eq(verification.userId, existing.id),
                isNull(verification.usedAt),
              ),
            );
          await tx.insert(verification).values({
            userId: existing.id,
            tokenHash: hashToken(raw),
            expiresAt: new Date(Date.now() + 86400000),
          });
          await audit(tx, "auth.verification_resent", existing.id);
          return true;
        });
        if (!issued) return { ok: true };
        try {
          await config.mailer.send(
            email,
            "verify",
            existing.locale,
            raw,
          );
        } catch {
          throw new ApiError(503, "MAIL_UNAVAILABLE");
        }
        return { ok: true };
      }
      let invitation: { token: string };
      try {
        invitation = await createInvitation(db, email, "bootstrap-email");
      } catch {
        // A concurrent registration may have won the race; keep the response generic.
        return { ok: true };
      }
      try {
        await config.mailer.send(email, "invite", "en", invitation.token);
      } catch {
        throw new ApiError(503, "MAIL_UNAVAILABLE");
      }
      return { ok: true };
    },
  );
  app.post<{
    Body: {
      email: string;
      password: string;
      displayName: string;
      locale: string;
      termsVersion?: string;
      privacyVersion?: string;
      inviteToken?: string;
      testNoticeVersion?: string;
    };
  }>(
    "/api/v1/auth/register",
    {
      schema: schema(
        {
          email: emailSchema,
          password: passwordSchema,
          displayName: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            pattern: "^[^<>\\x00-\\x1F]+$",
          },
          locale: {
            enum: ["en", "ru", "es", "fr", "de", "sr-Latn", "ja", "uk"],
          },
          inviteToken: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
          testNoticeVersion: { type: "string", maxLength: 80 },
          termsVersion: { type: "string", maxLength: 80 },
          privacyVersion: { type: "string", maxLength: 80 },
        },
        ["email", "password", "displayName", "locale"],
      ),
      config: rate(5),
    },
    async (request, reply) => {
      const b = request.body;
      const closedTest = config.publicRegistrationEnabled !== true;
      if (closedTest && !b.inviteToken)
        throw new ApiError(403, "REGISTRATION_CLOSED");
      if (closedTest && b.testNoticeVersion !== closedTestNoticeVersion)
        throw new ApiError(400, "POLICY_REQUIRED");
      if (!b.displayName.trim()) throw new ApiError(400, "INVALID_INPUT");
      if (
        (config.termsVersion && b.termsVersion !== config.termsVersion) ||
        (config.privacyVersion && b.privacyVersion !== config.privacyVersion)
      )
        throw new ApiError(400, "POLICY_REQUIRED");
      if (closedTest || b.inviteToken)
        await checkInvitation(db, normalize(b.email), b.inviteToken);
      const passwordHash = await hashPassword(b.password);
      const raw = token();
      const user = await db.transaction(async (tx) => {
        if (closedTest || b.inviteToken)
          await consumeInvitation(tx, normalize(b.email), b.inviteToken);
        const [u] = await tx
          .insert(users)
          .values({
            email: normalize(b.email),
            passwordHash,
            displayName: b.displayName.trim(),
            locale: b.locale,
            termsVersion: config.termsVersion,
            privacyVersion: config.privacyVersion,
            testNoticeVersion: closedTest ? closedTestNoticeVersion : null,
            testNoticeAcknowledgedAt: closedTest ? new Date() : null,
            acceptedAt:
              config.termsVersion || config.privacyVersion ? new Date() : null,
          })
          .onConflictDoNothing()
          .returning();
        if (!u) throw new ApiError(409, "ACCOUNT_EXISTS");
        await tx.insert(verification).values({
          userId: u.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 86400000),
        });
        await audit(tx, "auth.register", u.id);
        return u;
      });
      await setSession(user.id, reply, request.cookies[sessionCookie]);
      try {
        await config.mailer.send(user.email, "verify", user.locale, raw);
      } catch {
        throw new ApiError(503, "MAIL_UNAVAILABLE");
      }
      return { ok: true };
    },
  );
  app.post<{ Body: { email: string; password: string } }>(
    "/api/v1/auth/login",
    {
      schema: schema({ email: emailSchema, password: passwordSchema }),
      config: rate(10),
    },
    async (request, reply) => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalize(request.body.email)));
      let valid = false;
      try {
        valid = await argon2.verify(
          user?.passwordHash ?? dummyHash,
          request.body.password,
        );
      } catch {
        /* invalid stored hash is never accepted */
      }
      if (!user || !valid || user.state !== "active")
        throw new ApiError(401, "INVALID_CREDENTIALS");
      // Lock and recheck the hash: a concurrent reset cannot issue a session using the old password.
      const raw = token();
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
        if (request.cookies[sessionCookie])
          await tx
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(
              eq(sessions.tokenHash, hashToken(request.cookies[sessionCookie])),
            );
        await tx.insert(sessions).values({
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + config.sessionDays * 86400000),
        });
        await audit(tx, "auth.login", user.id);
      });
      reply.setCookie(sessionCookie, raw, {
        ...cookieOptions,
        maxAge: config.sessionDays * 86400,
      });
      return { ok: true };
    },
  );
  app.post(
    "/api/v1/auth/logout",
    { config: rate(30) },
    async (request, reply) => {
      const raw = request.cookies[sessionCookie];
      if (raw)
        await db.transaction(async (tx) => {
          const [row] = await tx
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(sessions.tokenHash, hashToken(raw)),
                isNull(sessions.revokedAt),
              ),
            )
            .returning();
          if (row) await audit(tx, "auth.logout", row.userId);
        });
      reply.clearCookie(sessionCookie, cookieOptions);
      return { ok: true };
    },
  );
  app.post(
    "/api/v1/auth/refresh",
    { config: rate(30) },
    async (request, reply) => {
      const user = await currentUser(db, request);
      await setSession(user.id, reply, request.cookies[sessionCookie], true);
      return { ok: true };
    },
  );
  app.post(
    "/api/v1/auth/resend",
    { config: rate(3, "1 hour") },
    async (request) => {
      const user = await currentUser(db, request);
      if (user.verifiedAt) return { ok: true };
      const raw = token();
      await db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, user.id))
          .for("update");
        await tx
          .update(verification)
          .set({ usedAt: new Date() })
          .where(
            and(eq(verification.userId, user.id), isNull(verification.usedAt)),
          );
        await tx.insert(verification).values({
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 86400000),
        });
      });
      try {
        await config.mailer.send(user.email, "verify", user.locale, raw);
      } catch {
        throw new ApiError(503, "MAIL_UNAVAILABLE");
      }
      return { ok: true };
    },
  );
  app.post<{ Body: { email: string } }>(
    "/api/v1/auth/forgot",
    { schema: schema({ email: emailSchema }), config: rate(5) },
    async (request) => {
      const started = Date.now();
      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.email, normalize(request.body.email)),
            eq(users.state, "active"),
          ),
        );
      if (user) {
        const raw = token();
        await db.transaction(async (tx) => {
          await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, user.id))
            .for("update");
          await tx
            .update(resets)
            .set({ usedAt: new Date() })
            .where(and(eq(resets.userId, user.id), isNull(resets.usedAt)));
          await tx.insert(resets).values({
            userId: user.id,
            tokenHash: hashToken(raw),
            expiresAt: new Date(Date.now() + 1800000),
          });
          await audit(tx, "auth.reset_requested", user.id);
        });
        if (pendingMail.size < 32) {
          const job = config.mailer
            .send(user.email, "reset", user.locale, raw)
            .catch(() => {})
            .finally(() => pendingMail.delete(job));
          pendingMail.add(job);
        }
      }
      await delay(Math.max(0, 250 - (Date.now() - started)));
      return { ok: true };
    },
  );
  app.post<{ Body: { token: string } }>(
    "/api/v1/auth/verify",
    { schema: schema({ token: tokenSchema }), config: rate(15) },
    async (request) => {
      const [candidate] = await db
        .select()
        .from(verification)
        .where(eq(verification.tokenHash, hashToken(request.body.token)));
      if (!candidate) throw new ApiError(400, "INVALID_TOKEN");
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${adminRoleLockId})`);
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, candidate.userId))
          .for("update");
        if (user.state !== "active") throw new ApiError(400, "INVALID_TOKEN");
        const [consumed] = await tx
          .update(verification)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(verification.id, candidate.id),
              isNull(verification.usedAt),
              gt(verification.expiresAt, new Date()),
            ),
          )
          .returning();
        if (!consumed) throw new ApiError(400, "INVALID_TOKEN");
        const [bootstrapUsed] = await tx
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(eq(auditLog.action, "admin.bootstrap"))
          .limit(1);
        const [activeAdmin] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.isAdmin, true),
              isNotNull(users.verifiedAt),
              eq(users.state, "active"),
            ),
          )
          .limit(1);
        const bootstrap =
          !!config.adminEmail &&
          user.email === config.adminEmail &&
          !user.isAdmin &&
          !bootstrapUsed &&
          !activeAdmin;
        await tx
          .update(users)
          .set({
            verifiedAt: user.verifiedAt ?? new Date(),
            isAdmin: user.isAdmin || bootstrap,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
        await audit(tx, "auth.verified", user.id);
        if (bootstrap && !user.isAdmin)
          await audit(tx, "admin.bootstrap", user.id);
      });
      return { ok: true };
    },
  );
  app.post<{ Body: { token: string; password: string } }>(
    "/api/v1/auth/reset",
    {
      schema: schema({ token: tokenSchema, password: passwordSchema }),
      config: rate(10),
    },
    async (request, reply) => {
      const [candidate] = await db
        .select()
        .from(resets)
        .where(eq(resets.tokenHash, hashToken(request.body.token)));
      if (!candidate) throw new ApiError(400, "INVALID_TOKEN");
      const passwordHash = await hashPassword(request.body.password);
      const user = await db.transaction(async (tx) => {
        const [u] = await tx
          .select()
          .from(users)
          .where(eq(users.id, candidate.userId))
          .for("update");
        if (u.state !== "active") throw new ApiError(400, "INVALID_TOKEN");
        const [consumed] = await tx
          .update(resets)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(resets.id, candidate.id),
              isNull(resets.usedAt),
              gt(resets.expiresAt, new Date()),
            ),
          )
          .returning();
        if (!consumed) throw new ApiError(400, "INVALID_TOKEN");
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, u.id));
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.userId, u.id));
        await tx
          .update(resets)
          .set({ usedAt: new Date() })
          .where(and(eq(resets.userId, u.id), isNull(resets.usedAt)));
        await audit(tx, "auth.password_reset", u.id);
        return u;
      });
      reply.clearCookie(sessionCookie, cookieOptions);
      try {
        await config.mailer.send(user.email, "passwordChanged", user.locale);
      } catch {
        /* password reset must not roll back on notification failure */
      }
      return { ok: true };
    },
  );
}
