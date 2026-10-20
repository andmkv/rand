import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEnvironment, validateSetupAnswers } from "./setup.mjs";

const fixture = {
  baseUrl: "https://usr.example.org",
  adminEmail: " OWNER@example.org ",
  smtpHost: "smtp.example.org",
  smtpPort: "465",
  smtpSecure: true,
  smtpUser: "owner@example.org",
  smtpPassword: "private fixture password",
  fromEmail: "no-reply@example.org",
  fromName: "Randomize USR",
  webPort: "8080",
};

test("setup normalizes an HTTPS origin and validates provider inputs", () => {
  const result = validateSetupAnswers(fixture);
  assert.equal(result.baseUrl, "https://usr.example.org");
  assert.equal(result.adminEmail, "owner@example.org");
  assert.equal(result.smtpPort, 465);
  assert.equal(result.webPort, 8080);
  for (const invalid of [
    { ...fixture, baseUrl: "http://usr.example.org" },
    { ...fixture, baseUrl: "https://usr.example.org/path" },
    { ...fixture, adminEmail: "not-an-email" },
    { ...fixture, smtpHost: "https://smtp.example.org" },
    { ...fixture, smtpPort: "65536" },
    { ...fixture, smtpPassword: "" },
    { ...fixture, fromName: "Name\r\nBcc: victim@example.org" },
    { ...fixture, webPort: "0" },
  ]) assert.throws(() => validateSetupAnswers(invalid));
});

test("setup writes SMTP credentials only to a separate secret file", () => {
  const answers = validateSetupAnswers(fixture);
  const env = renderEnvironment(answers, "/private/secrets/smtp_password");
  assert.match(env, /SMTP_PASSWORD_FILE='\/private\/secrets\/smtp_password'/);
  assert.doesNotMatch(env, /private fixture password/);
  assert.doesNotMatch(env, /^NODE_ENV=/m);
  const dbPassword = env.match(/POSTGRES_PASSWORD='([a-f0-9]{64})'/)?.[1];
  assert.ok(dbPassword);
  assert.ok(env.includes(`DATABASE_URL='postgresql://randusr:${dbPassword}@db:5432/randusr'`));
  assert.match(env, /ADMIN_BOOTSTRAP_EMAIL='owner@example\.org'/);
});
