import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mailer, MemoryMail, FileMail } from "../mail.js";
import { authConfig } from "../auth-config.js";

test("localized functional templates use canonical fragment links, HTML/text and bounded safe retry", async () => {
  const sink = new MemoryMail();
  const mailer = new Mailer(sink, "https://instance.example.invalid");
  for (const locale of ["en", "ru", "es", "fr", "de", "sr-Latn", "ja", "uk"]) {
    await mailer.send(
      "test@example.invalid",
      "verify",
      locale,
      "token-for-test",
    );
    const mail = sink.outbox.at(-1)!;
    assert.ok(mail.html.includes("<a href="));
    assert.ok(mail.text.includes("https://instance.example.invalid/verify#token="));
    assert.ok(!mail.text.includes("mail_"));
  }
  await mailer.send(
    "test@example.invalid",
    "reset",
    "unknown",
    "token-for-test",
  );
  assert.ok(sink.outbox.at(-1)!.subject.includes("Reset your password"));
  let attempts = 0;
  const events: string[] = [];
  const temporary = new Mailer(
    {
      send: async () => {
        attempts++;
        if (attempts < 3)
          throw Object.assign(new Error("sensitive SMTP text"), {
            responseCode: 450,
          });
      },
    },
    "https://instance.example.invalid",
    "no-reply@example.invalid",
    (e) => events.push(e),
  );
  await temporary.send("test@example.invalid", "verify", "en", "secret-token");
  assert.equal(attempts, 3);
  assert.ok(!events.join().includes("secret"));
  attempts = 0;
  const permanent = new Mailer(
    {
      send: async () => {
        attempts++;
        throw Object.assign(new Error("secret"), { responseCode: 550 });
      },
    },
    "https://instance.example.invalid",
  );
  await assert.rejects(
    permanent.send("test@example.invalid", "reset", "en", "secret"),
    /MAIL_DELIVERY_FAILED/,
  );
  assert.equal(attempts, 1);
});
test("file sink is local, bounded and private; production cannot silently use development mail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "randusr-mail-test-"));
  try {
    const mailer = new Mailer(new FileMail(directory), "http://localhost:5173");
    await mailer.send("test@example.invalid", "reset", "ru", "secret");
    const [name] = await readdir(directory);
    const file = join(directory, name);
    assert.equal((await stat(file)).mode & 0o077, 0);
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).to,
      "test@example.invalid",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.throws(
    () => authConfig({
      NODE_ENV: "production",
      APP_BASE_URL: "https://instance.example.invalid",
      ADMIN_BOOTSTRAP_EMAIL: "owner@example.invalid",
      SMTP_FROM_EMAIL: "noreply@example.invalid",
      MAIL_MODE: "file",
    }),
    /SMTP/,
  );
  assert.throws(
    () => authConfig({ MAIL_MODE: "smtp", SMTP_URL: "smtp://localhost:1025" }),
    /explicit configuration/,
  );
  assert.throws(
    () =>
      authConfig({
        NODE_ENV: "production",
        APP_BASE_URL: "http://localhost:5173",
      }),
    /HTTPS/,
  );
  assert.throws(
    () => authConfig({ NODE_ENV: "production", MAIL_MODE: "smtp", SMTP_URL: "smtp://mail.example.invalid", APP_BASE_URL: "https://instance.example.invalid" }),
    /ADMIN_BOOTSTRAP_EMAIL/,
  );
  const configured = authConfig({
    NODE_ENV: "production",
    APP_BASE_URL: "https://instance.example.invalid",
    ADMIN_BOOTSTRAP_EMAIL: "owner@example.org",
    MAIL_MODE: "smtp",
    SMTP_HOST: "smtp.example.org",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "owner@example.org",
    SMTP_PASSWORD: "test-only-password",
    SMTP_FROM_EMAIL: "noreply@example.org",
    SMTP_FROM_NAME: "Randomize USR",
  });
  assert.equal(configured.baseUrl, "https://instance.example.invalid");
  assert.equal(configured.adminEmail, "owner@example.org");
  assert.throws(
    () => authConfig({ MAIL_MODE: "smtp", SMTP_HOST: "https://evil.example", MAIL_ALLOW_REAL_SEND: "1" }),
    /SMTP_HOST/,
  );
});
