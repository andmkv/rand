import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { hostedCopy } from "../shared/copy.js";
export type MailTemplate = "verify" | "reset" | "passwordChanged" | "invite";
export interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
}
export interface MailTransport {
  send(mail: Mail): Promise<void>;
}
export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
}
export class MemoryMail implements MailTransport {
  outbox: Mail[] = [];
  async send(mail: Mail) {
    this.outbox.push(mail);
    if (this.outbox.length > 100) this.outbox.shift();
  }
}
export class FileMail implements MailTransport {
  constructor(private directory: string) {}
  async send(mail: Mail) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(this.directory, `${Date.now()}-${randomUUID()}.json`),
      JSON.stringify(mail, null, 2),
      { mode: 0o600 },
    );
    const files = (await readdir(this.directory))
      .filter((x) => /^\d+-[\da-f-]+\.json$/.test(x))
      .sort();
    for (const name of files.slice(0, -100))
      await unlink(join(this.directory, name)).catch(() => {});
  }
}
export class SmtpMail implements MailTransport {
  private transporter;
  constructor(config: string | SmtpOptions) {
    if (typeof config !== "string") {
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure,
        tls: { rejectUnauthorized: true },
        ...(config.user && config.password
          ? { auth: { user: config.user, pass: config.password } }
          : {}),
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      } as SMTPTransport.Options);
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(config);
    } catch {
      throw new Error("Invalid SMTP_URL");
    }
    if (
      !["smtp:", "smtps:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname && parsed.pathname !== "/")
    )
      throw new Error("Invalid SMTP_URL");
    this.transporter = nodemailer.createTransport({
      url: config,
      requireTLS: parsed.protocol === "smtp:",
      tls: { rejectUnauthorized: true },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    } as SMTPTransport.Options);
  }
  async send(mail: Mail) {
    await this.transporter.sendMail({
      ...mail,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
}
const htmlEscape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class Mailer {
  constructor(
    readonly transport: MailTransport,
    readonly baseUrl: string,
    readonly from = "no-reply@example.invalid",
    private report: (event: string) => void = () => {},
  ) {}
  async send(
    to: string,
    template: MailTemplate,
    locale: string,
    token?: string,
  ) {
    const c = (key: string) => hostedCopy(key, locale);
    const subject = `Randomize USR · ${c(`mail_${template}_subject`)}`;
    const introduction = c(`mail_${template}_body`);
    const footer = c(
      template === "passwordChanged" ? "mail_neverShare" : "mail_ignore",
    );
    const linkPath =
      template === "invite"
        ? "/invite"
        : template === "verify"
          ? "/verify"
          : template === "reset"
            ? "/reset-password"
            : undefined;
    const link = linkPath ? new URL(linkPath, this.baseUrl) : undefined;
    if (link && token)
      link.hash = new URLSearchParams({ token }).toString(); // fragments never reach access logs/referrers
    const text = [
      "Randomize USR",
      introduction,
      link && token ? link.href : "",
      footer,
    ]
      .filter(Boolean)
      .join("\n\n");
    const button =
      template === "invite" ? c("mail_invite_button") : c("mail_open");
    const html = `<h1>Randomize USR</h1><p>${htmlEscape(introduction)}</p>${link && token ? `<p><a href="${htmlEscape(link.href)}">${htmlEscape(button)}</a></p>` : ""}<p>${htmlEscape(footer)}</p>`;
    const mail = {
      from: this.from,
      to,
      subject,
      text,
      html,
      messageId: `<${randomUUID()}@randomize-usr>`,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.transport.send(mail);
        return;
      } catch (error) {
        const e = error as { responseCode?: number; code?: string };
        const retryable =
          (e.responseCode !== undefined &&
            e.responseCode >= 400 &&
            e.responseCode < 500) ||
          ["ECONNECTION", "ECONNRESET", "ETIMEDOUT", "ESOCKET"].includes(
            e.code ?? "",
          );
        this.report(
          retryable ? "mail_transient_failure" : "mail_permanent_failure",
        );
        if (!retryable || attempt === 2)
          throw new Error("MAIL_DELIVERY_FAILED");
        await delay(100 * 2 ** attempt);
      }
    }
  }
}
