import { secretValue } from "./secrets.js";
export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  adminEmail?: string;
  production: boolean;
}
export function readDatabaseUrl(env = process.env): string {
  const databaseUrl = secretValue(env, "DATABASE_URL");
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  return databaseUrl;
}
export function readConfig(env = process.env): Config {
  const databaseUrl = readDatabaseUrl(env);
  const port = Number(env.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid API_PORT");
  const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase() || undefined;
  if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))
    throw new Error("Invalid ADMIN_BOOTSTRAP_EMAIL");
  if (env.NODE_ENV === "production" && !adminEmail)
    throw new Error("ADMIN_BOOTSTRAP_EMAIL is required in production");
  return {
    databaseUrl,
    port,
    host: env.API_HOST ?? "127.0.0.1",
    adminEmail,
    production: env.NODE_ENV === "production",
  };
}

// Trust exactly the configured reverse-proxy hop; never arbitrary forwarded headers.
export function readTrustProxy(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.TRUST_PROXY_HOPS ?? "0";
  if (raw !== "0" && raw !== "1") throw new Error("Invalid TRUST_PROXY_HOPS");
  return Number(raw);
}
