import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { hashToken, requirePermission } from "./access.js";
import type { Database } from "./db/client.js";
import { ApiError } from "./errors.js";
import {
  clientEvents,
  type AnalyticsConfiguration,
  type ProductEvent,
} from "../shared/analytics.js";

export function analyticsConfig(env = process.env): AnalyticsConfiguration {
  const flag = env.PRODUCT_ANALYTICS_ENABLED ?? "false";
  if (!["true", "false"].includes(flag))
    throw new Error("Invalid PRODUCT_ANALYTICS_ENABLED");
  if (flag === "false")
    return { enabled: false, noticeVersion: null, noticeUrl: null };
  const version = env.PRODUCT_ANALYTICS_NOTICE_VERSION;
  let url: URL;
  try {
    url = new URL(env.PRODUCT_ANALYTICS_NOTICE_URL ?? "");
  } catch {
    throw new Error(
      "Analytics requires an operator-reviewed notice URL/version",
    );
  }
  if (
    !version?.trim() ||
    version.length > 80 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password
  )
    throw new Error("Invalid analytics notice configuration");
  return { enabled: true, noticeVersion: version, noticeUrl: url.href };
}

function requestEvent(r: FastifyRequest): ProductEvent | undefined {
  const route = r.routeOptions.url;
  if (r.method === "PUT" && route === "/api/v1/projects/:id")
    return "cloud_project_saved";
  if (r.method !== "POST") return;
  const events: Record<string, ProductEvent> = {
    "/api/v1/auth/register": "signup_completed",
    "/api/v1/auth/verify": "signup_verified",
    "/api/v1/auth/login": "login",
    "/api/v1/projects": "cloud_project_created",
    "/api/v1/shared/:code/remix": "project_remixed",
  };
  if (route === "/api/v1/projects/:id/share") {
    const visibility = (r.body as { visibility?: string })?.visibility;
    return visibility === "private"
      ? "project_unpublished"
      : "project_published";
  }
  return events[route ?? ""];
}

export function registerAnalytics(
  app: FastifyInstance,
  db: Database,
  config: AnalyticsConfiguration,
) {
  async function record(token: string, event: ProductEvent) {
    // No user/project ID, IP, URL, payload, title, error message or locale enters this table.
    await db.execute(
      sql`INSERT INTO product_events(session_hash,event) VALUES (${hashToken(token)},${event})`,
    );
  }
  app.get("/api/v1/analytics/config", async () => config);
  app.post<{
    Body: {
      sessionToken: string;
      noticeVersion: string;
      event: (typeof clientEvents)[number];
    };
  }>(
    "/api/v1/analytics/events",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["sessionToken", "noticeVersion", "event"],
          properties: {
            sessionToken: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
            noticeVersion: { type: "string", maxLength: 80 },
            event: { type: "string", enum: [...clientEvents] },
          },
        },
      },
    },
    async (request) => {
      if (
        !config.enabled ||
        request.body.noticeVersion !== config.noticeVersion
      )
        throw new ApiError(403, "FORBIDDEN");
      await record(request.body.sessionToken, request.body.event);
      return { ok: true };
    },
  );
  app.delete<{ Body: { sessionToken: string } }>(
    "/api/v1/analytics/session",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["sessionToken"],
          properties: {
            sessionToken: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
          },
        },
      },
    },
    async (request) => {
      await db.execute(
        sql`DELETE FROM product_events WHERE session_hash=${hashToken(request.body.sessionToken)}`,
      );
      return { ok: true };
    },
  );
  app.addHook("onResponse", async (request, reply) => {
    if (!config.enabled || reply.statusCode < 200 || reply.statusCode >= 300)
      return;
    const token = request.headers["x-product-session"],
      version = request.headers["x-product-notice"];
    if (
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      version !== config.noticeVersion
    )
      return;
    const event = requestEvent(request);
    if (event)
      try {
        await record(token, event);
      } catch {
        request.log.warn({ requestId: request.id }, "product_counter_failed");
      }
  });
  app.get(
    "/api/v1/admin/product-health",
    { preHandler: requirePermission(db, "administer") },
    async () => {
      const result = await db.execute(sql`
      SELECT json_build_object(
        'accounts',(SELECT json_build_object('total',count(*),'verified',count(*) FILTER(WHERE verified_at IS NOT NULL),
          'admins',count(*) FILTER(WHERE is_admin),
          'active7d',count(*) FILTER(WHERE state='active' AND id IN (
            SELECT user_id FROM sessions WHERE created_at>=now()-interval '7 days'
            UNION SELECT actor_id FROM project_revisions WHERE created_at>=now()-interval '7 days'
            UNION SELECT actor_id FROM audit_log WHERE created_at>=now()-interval '7 days')))
          FROM users WHERE state<>'deleted'),
        'projects',(SELECT json_build_object('total',count(*),'public',count(*) FILTER(WHERE visibility='public' AND moderation_state='active' AND archived_at IS NULL),
          'remixes',count(*) FILTER(WHERE remixed_from_revision_id IS NOT NULL)) FROM projects WHERE deleted_at IS NULL)
      ) AS health`);
      const events =
        await db.execute(sql`SELECT event,count(*)::int AS count,count(DISTINCT session_hash)::int AS sessions
      FROM product_events WHERE created_at>=now()-interval '30 days' GROUP BY event ORDER BY event`);
      // Cumulative same-tab cohort: each stage is reached AFTER the previous stage, within this 30-day sample.
      const funnel = await db.execute(sql`WITH
      a AS (SELECT session_hash,min(created_at) at FROM product_events WHERE event='homepage_viewed' AND created_at>=now()-interval '30 days' GROUP BY session_hash),
      b AS (SELECT a.session_hash,min(e.created_at) at FROM a JOIN product_events e ON e.session_hash=a.session_hash AND e.created_at>=a.at WHERE e.event IN ('program_run','example_run','public_project_run') GROUP BY a.session_hash),
      c AS (SELECT b.session_hash,min(e.created_at) at FROM b JOIN product_events e ON e.session_hash=b.session_hash AND e.created_at>=b.at WHERE e.event='signup_completed' GROUP BY b.session_hash),
      d AS (SELECT c.session_hash,min(e.created_at) at FROM c JOIN product_events e ON e.session_hash=c.session_hash AND e.created_at>=c.at WHERE e.event IN ('cloud_project_created','cloud_project_saved') GROUP BY c.session_hash),
      e AS (SELECT d.session_hash FROM d JOIN product_events p ON p.session_hash=d.session_hash AND p.created_at>=d.at WHERE p.event='project_published' GROUP BY d.session_hash)
      SELECT 'home' stage,count(*)::int sessions FROM a UNION ALL SELECT 'run',count(*)::int FROM b UNION ALL SELECT 'signup',count(*)::int FROM c UNION ALL SELECT 'save',count(*)::int FROM d UNION ALL SELECT 'publish',count(*)::int FROM e`);
      return {
        ...(result.rows[0].health as object),
        analytics: {
          enabled: config.enabled,
          windowDays: 30,
          events: events.rows,
          funnel: funnel.rows,
        },
      };
    },
  );
}
