import { parseArgs } from "node:util";
import { authConfig } from "./auth-config.js";
import { SmtpMail } from "./mail.js";
import { sendSmtpTestEmail } from "./smtp-test.js";

const { values } = parseArgs({
  options: { to: { type: "string" } },
  strict: true,
});

try {
  // Running this explicit operator-only command authorizes only this process to send its fixed test message.
  process.env.MAIL_ALLOW_REAL_SEND = "1";
  const config = authConfig();
  const recipient = (values.to ?? config.adminEmail ?? "").trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || recipient.length > 320)
    throw new Error("Configure ADMIN_BOOTSTRAP_EMAIL or pass --to <address>.");
  if (!(config.mailer.transport instanceof SmtpMail))
    throw new Error("MAIL_MODE=smtp is required for the SMTP diagnostic.");
  await sendSmtpTestEmail(config.mailer.transport, config.mailer.from, recipient);
  console.log("SMTP accepted the test message. Check the recipient mailbox and spam folder.");
} catch (error) {
  const detail = error as { code?: unknown; responseCode?: unknown };
  const knownCodes = new Set([
    "EAUTH", "ECONNECTION", "ECONNREFUSED", "ECONNRESET", "EDNS",
    "EENVELOPE", "ESOCKET", "ETIMEDOUT", "ETLS", "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID",
  ]);
  const code = typeof detail?.code === "string" && knownCodes.has(detail.code)
    ? detail.code
    : undefined;
  const responseCode = Number.isInteger(detail?.responseCode) && Number(detail.responseCode) >= 400 && Number(detail.responseCode) <= 599
    ? Number(detail.responseCode)
    : undefined;
  const reason = code === "EAUTH"
    ? "SMTP authentication failed. Check the configured username and password file."
    : code?.includes("CERT") || code?.includes("TLS") || code?.includes("SELF_SIGNED")
      ? "SMTP TLS certificate verification failed. Check the relay TLS configuration and certificate chain."
      : code === "EDNS"
        ? "SMTP hostname lookup failed. Check the configured hostname and DNS."
        : "SMTP test delivery failed. Check the relay host, port, TLS settings and relay logs.";
  console.error(`SMTP test failed${code ? ` (${code})` : ""}${responseCode ? ` [${responseCode}]` : ""}. ${reason} Credentials and server response text were omitted.`);
  process.exitCode = 1;
}
