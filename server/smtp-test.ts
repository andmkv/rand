import { randomUUID } from "node:crypto";
import type { MailTransport } from "./mail.js";

/** Sends a fixed, token-free diagnostic message through the configured SMTP transport. */
export async function sendSmtpTestEmail(
  transport: MailTransport,
  from: string,
  to: string,
) {
  await transport.send({
    from,
    to,
    subject: "Randomize USR SMTP test",
    text: "This test message confirms that your Randomize USR instance can send email through its configured SMTP service.",
    html: "<p>This test message confirms that your Randomize USR instance can send email through its configured SMTP service.</p>",
    messageId: `<${randomUUID()}@randomize-usr>`,
  });
}
