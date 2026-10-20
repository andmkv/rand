import { secretValue } from "./secrets.js";
import { FileMail, Mailer, SmtpMail } from "./mail.js";
import { isIP } from "node:net";
export interface AuthConfig {
  baseUrl: string;
  secureCookies: boolean;
  adminEmail?: string;
  sessionDays: number;
  mailer: Mailer;
  termsVersion?: string;
  privacyVersion?: string;
  termsUrl?: string;
  privacyUrl?: string;
  supportEmail?: string;
  publicRegistrationEnabled?: boolean;
}
export function authConfig(env = process.env): AuthConfig {
  const production = env.NODE_ENV === "production";
  if (production && !env.APP_BASE_URL)
    throw new Error("APP_BASE_URL is required in production");
  let base: URL;
  try {
    base = new URL(
      env.APP_BASE_URL ??
        (production ? "" : "http://localhost:5173"),
    );
  } catch {
    throw new Error("Invalid APP_BASE_URL");
  }

  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error("APP_BASE_URL must be a canonical origin");
  if (production && base.protocol !== "https:")
    throw new Error("Production APP_BASE_URL requires HTTPS");
  const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase() || undefined;
  if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))
    throw new Error("Invalid ADMIN_BOOTSTRAP_EMAIL");
  if (production && !adminEmail)
    throw new Error("ADMIN_BOOTSTRAP_EMAIL is required in production");
  const mode = env.MAIL_MODE ?? "file";
  if (!["file", "smtp"].includes(mode)) throw new Error("Invalid MAIL_MODE");
  if (production && mode !== "smtp")
    throw new Error("Production requires configured SMTP delivery");
  const smtpUrl = secretValue(env, "SMTP_URL");
  const smtpHost = env.SMTP_HOST?.trim();
  const smtpPort = env.SMTP_PORT === undefined ? 587 : Number(env.SMTP_PORT);
  const secureText = env.SMTP_SECURE ?? "false";
  if (!/^(true|false)$/.test(secureText))
    throw new Error("SMTP_SECURE must be true or false");
  const smtpSecure = secureText === "true";
  const smtpUser = env.SMTP_USER?.trim() || undefined;
  const smtpPassword = smtpHost ? secretValue(env, "SMTP_PASSWORD") : undefined;
  const validSmtpDomain = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  if (smtpHost && (smtpHost.length > 255 || /[\s/@?#]/.test(smtpHost) || (!isIP(smtpHost) && !validSmtpDomain.test(smtpHost))))
    throw new Error("Invalid SMTP_HOST");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    throw new Error("Invalid SMTP_PORT");
  if (!!smtpUser !== !!smtpPassword)
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
  if (smtpUser && (smtpUser.length > 320 || smtpPassword!.length > 8192))
    throw new Error("Invalid SMTP credentials");
  if (smtpUrl && smtpHost)
    throw new Error("Configure SMTP_URL or SMTP_HOST, not both");
  if (
    mode === "smtp" &&
    (!(smtpUrl || smtpHost) || (!production && env.MAIL_ALLOW_REAL_SEND !== "1"))
  )
    throw new Error(
      "SMTP requires explicit configuration; dev sending requires MAIL_ALLOW_REAL_SEND=1",
    );
  const fromEmail = env.SMTP_FROM_EMAIL?.trim() || env.MAIL_FROM?.trim() || "no-reply@example.invalid";
  const fromName = env.SMTP_FROM_NAME?.trim();
  if (fromName && (fromName.length > 80 || /[\r\n\u0000-\u001f]/.test(fromName)))
    throw new Error("Invalid SMTP_FROM_NAME");
  if (production && fromEmail.endsWith(".invalid"))
    throw new Error("SMTP_FROM_EMAIL is required in production");
  const from = fromName ? `${JSON.stringify(fromName)} <${fromEmail}>` : fromEmail;
  if (fromEmail.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fromEmail))
    throw new Error("Invalid SMTP_FROM_EMAIL");
  if (production && smtpHost && (!smtpUser || !smtpPassword))
    throw new Error("Production SMTP_HOST requires SMTP_USER and SMTP_PASSWORD");
  const transport =
    mode === "smtp"
      ? new SmtpMail(smtpUrl || {
          host: smtpHost!,
          port: smtpPort,
          secure: smtpSecure,
          user: smtpUser,
          password: smtpPassword,
        })
      : new FileMail(env.MAIL_DIRECTORY ?? "/tmp/randusr-mail");
  const documents = (name: string) => {
    const version = env[`${name}_VERSION`] || undefined;
    const raw = env[`${name}_URL`] || undefined;
    if (
      !!version !== !!raw ||
      (version && (version.length > 80 || !version.trim()))
    )
      throw new Error(`${name} requires a document URL and version together`);
    if (!raw) return { version, url: undefined };
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`Invalid ${name}_URL`);
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(`Invalid ${name}_URL`);
    return { version, url: url.href };
  };
  const terms = documents("TERMS"),
    privacy = documents("PRIVACY");
  const supportEmail = env.SUPPORT_EMAIL?.trim() || undefined;
  if (
    supportEmail &&
    (supportEmail.length > 320 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(supportEmail))
  )
    throw new Error("Invalid SUPPORT_EMAIL");
  const publicFlag = env.PUBLIC_REGISTRATION_ENABLED || "false";
  if (!["true", "false"].includes(publicFlag))
    throw new Error("Invalid PUBLIC_REGISTRATION_ENABLED");
  const publicRegistrationEnabled = publicFlag === "true";
  if (
    publicRegistrationEnabled &&
    (!terms.url || !privacy.url || !supportEmail)
  )
    throw new Error(
      "Public registration requires reviewed policy configuration and support contact",
    );
  return {
    publicRegistrationEnabled,
    baseUrl: base.origin,
    secureCookies: base.protocol === "https:",
    adminEmail,
    sessionDays: 14,
    mailer: new Mailer(transport, base.origin, from, (event) =>
      console.error(
        JSON.stringify({ level: 50, time: Date.now(), msg: event }),
      ),
    ),
    termsVersion: terms.version,
    privacyVersion: privacy.version,
    termsUrl: terms.url,
    privacyUrl: privacy.url,
    supportEmail,
  };
}
