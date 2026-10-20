import type { Writable } from "node:stream";
import { readTrustProxy } from "./config.js";
import { registerPreviews } from "./previews.js";
import { analyticsConfig, registerAnalytics } from "./analytics.js";
import { platformLimits } from "./limits.js";
import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { authConfig, type AuthConfig } from "./auth-config.js";
import { registerLifecycle } from "./lifecycle.js";
import { registerReports } from "./reports.js";
import { registerAdmin } from "./admin.js";
import { registerAdminInvitations } from "./admin-invitations.js";
import { registerRemix } from "./remix.js";
import { registerGallery } from "./gallery.js";
import { registerSharing } from "./sharing.js";
import { registerHistory } from "./history.js";
import { registerProjects } from "./projects.js";
import { registerAssets } from "./assets.js";
import { registerAccount } from "./account.js";
import { registerAuth, protectMutation } from "./auth.js";
import { readDemoConfig } from "./demo-config.js";
import { DemoStore } from "./demo-store.js";
import { registerDemoApi, registerDemoLogin } from "./demo.js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "./db/client.js";
import { resolvePrincipal, sessionCookie } from "./access.js";
import { ApiError } from "./errors.js";
import type { ApiErrorEnvelope, SessionResponse } from "../shared/api.js";

declare module "fastify" {
  interface FastifyInstance {
    demoStore: DemoStore | null;
  }
}
export function buildApp(
  db: Database,
  logging = false,
  config: AuthConfig = authConfig(),
  logStream?: Writable,
  demoOverride?: DemoStore | null,
) {
  const proxyHops = readTrustProxy();
  const analytics = analyticsConfig();
  const demo = demoOverride === undefined ? readDemoConfig() : null;
  const demoStore =
    demoOverride !== undefined
      ? demoOverride
      : demo?.enabled
        ? new DemoStore(demo)
        : null;
  const readOnly = process.env.READ_ONLY_MODE ?? "false";
  if (!["true", "false"].includes(readOnly))
    throw new Error("Invalid READ_ONLY_MODE");
  const app = Fastify({
    trustProxy: (_address, hop) => hop < proxyHops,
    bodyLimit: platformLimits.payloadBytes,
    requestTimeout: 30000,
    connectionTimeout: 130000,
    genReqId: () => randomUUID(),
    // Do not log arbitrary URLs (verification tokens), headers, bodies, SQL errors or raw secrets.
    logController: new LogController({ disableRequestLogging: true }),
    logger: logging
      ? {
          level: "info",
          ...(logStream ? { stream: logStream } : {}),
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "res.headers.set-cookie",
          ],
        }
      : false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.decorate("demoStore", demoStore);
  if (demoStore) app.addHook("onClose", async () => demoStore.stop());
  app.register(cookie);
  app.addHook("onRequest", async (request) => {
    if (
      readOnly === "true" &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method)
    )
      throw new ApiError(503, "UNAVAILABLE");
  });
  app.addHook("preHandler", async (request) => {
    await protectMutation(request, config);
  });
  app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => new ApiError(429, "RATE_LIMITED"),
    });
    scoped.post(
      "/api/v1/operations/client-error",
      {
        config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: { type: "string", enum: ["error", "unhandledrejection"] },
            },
          },
        },
      },
      async (request) => {
        // Deliberately accept no message, source, stack, URL, identity or program text.
        request.log.warn({ requestId: request.id }, "frontend_fatal");
        return { ok: true };
      },
    );
    registerAnalytics(scoped, db, analytics);
    await registerAuth(scoped, db, config, !!demoStore);
    await registerAccount(scoped, db, config);
    registerProjects(scoped, db);
    registerAssets(scoped, db);
    registerPreviews(scoped, db, demoStore ?? undefined);
    registerHistory(scoped, db);
    registerSharing(scoped, db, config, demoStore ?? undefined);
    registerGallery(scoped, db);
    registerRemix(scoped, db);
    registerAdmin(scoped, db, config);
    registerAdminInvitations(scoped, db, config);
    registerReports(scoped, db);
    registerLifecycle(scoped, db, config);
    if (demoStore) {
      registerDemoLogin(scoped, demoStore, demoStore.config, config);
      registerDemoApi(scoped, demoStore, demoStore.config, config);
    }
  });
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime * 100) / 100,
        route: request.routeOptions.url ?? "unmatched",
      },
      "request_complete",
    );
  });
  app.setErrorHandler((error, request, reply) => {
    let failure: ApiError;
    if (error instanceof ApiError) failure = error;
    else if (
      typeof error === "object" &&
      error !== null &&
      (("validation" in error && error.validation) ||
        ("statusCode" in error &&
          (error.statusCode === 400 || error.statusCode === 415)))
    )
      failure = new ApiError(400, "INVALID_INPUT");
    else if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 413
    )
      failure = new ApiError(413, "PAYLOAD_TOO_LARGE");
    else failure = new ApiError(500, "INTERNAL_ERROR");
    if (failure.status >= 500)
      request.log.error(
        { code: failure.code, requestId: request.id },
        "request_failed",
      );
    const body: ApiErrorEnvelope = {
      error: { code: failure.code, requestId: request.id },
    };
    reply.code(failure.status).send(body);
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: "NOT_FOUND", requestId: request.id },
    } satisfies ApiErrorEnvelope),
  );
  app.get("/api/v1/health", async () => ({ status: "ok" }));
  app.get("/api/v1/ready", async () => {
    try {
      // Also fails before migrations; a live socket alone is not readiness.
      await db.execute(sql`select id from users limit 1`);
      return { status: "ready" };
    } catch {
      throw new ApiError(503, "UNAVAILABLE");
    }
  });
  app.get("/api/v1/session", async (request): Promise<SessionResponse> => ({
    principal: await resolvePrincipal(db, request.cookies[sessionCookie]),
  }));
  return app;
}
