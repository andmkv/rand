/**
 * Demo Mode configuration. Demo sessions are intentional UAT infrastructure, not accounts:
 * every value here is a hard limit on disposable in-memory state. Invalid values fail startup
 * instead of silently widening a quota.
 */
export interface DemoConfig {
  enabled: boolean;
  idleMs: number;
  absoluteMs: number;
  maxSessions: number;
  maxSessionsPerIp: number;
  maxProjects: number;
  maxRevisions: number;
  maxSessionBytes: number;
  maxStoreBytes: number;
  loginPer15Minutes: number;
  tombstoneMs: number;
  requestPerMinute: number;
  publicationsPer15Minutes: number;
  previewsPer15Minutes: number;
}

const integer = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
  label = name,
) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${label}: expected an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${label}: outside supported range`);
  return value;
};

export function readDemoConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  const flag = env.DEMO_MODE_ENABLED ?? "true";
  if (!["true", "false"].includes(flag))
    throw new Error("Invalid DEMO_MODE_ENABLED");
  return {
    enabled: flag === "true",
    idleMs: integer(env, "DEMO_IDLE_MINUTES", 60, 5, 1440) * 60_000,
    absoluteMs:
      integer(env, "DEMO_ABSOLUTE_HOURS", 24, 1, 168) * 3_600_000,
    maxSessions: integer(env, "DEMO_MAX_SESSIONS", 50, 1, 500),
    maxSessionsPerIp: integer(env, "DEMO_MAX_SESSIONS_PER_IP", 10, 1, 50),
    maxProjects: integer(env, "DEMO_MAX_PROJECTS", 10, 1, 50),
    maxRevisions: integer(env, "DEMO_MAX_REVISIONS", 20, 2, 100),
    maxSessionBytes: integer(
      env,
      "DEMO_MAX_SESSION_BYTES",
      4 * 1024 * 1024,
      256 * 1024,
      64 * 1024 * 1024,
    ),
    maxStoreBytes: integer(
      env,
      "DEMO_MAX_STORE_BYTES",
      64 * 1024 * 1024,
      1 * 1024 * 1024,
      512 * 1024 * 1024,
    ),
    loginPer15Minutes: integer(env, "DEMO_LOGIN_PER_15_MINUTES", 10, 1, 100),
    tombstoneMs: integer(env, "DEMO_TOMBSTONE_HOURS", 168, 1, 720) * 3_600_000,
    requestPerMinute: integer(env, "DEMO_REQUESTS_PER_MINUTE", 300, 30, 5000),
    publicationsPer15Minutes: integer(
      env,
      "MAX_PUBLICATIONS_PER_15_MINUTES",
      20,
      1,
      200,
    ),
    previewsPer15Minutes: integer(
      env,
      "DEMO_PREVIEWS_PER_15_MINUTES",
      30,
      1,
      300,
    ),
  };
}
