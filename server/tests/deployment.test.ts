import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("self-host Compose keeps PostgreSQL private and public registration closed by default", async () => {
  const { stdout } = await promisify(execFile)(
    "docker",
    ["compose", "-f", "compose.yaml", "config", "--format", "json"],
    {
      env: {
        ...process.env,
        POSTGRES_PASSWORD: "disposable-compose-fixture",
        DATABASE_URL: "postgresql://randusr:fixture@db:5432/randusr",
        ADMIN_BOOTSTRAP_EMAIL: "owner@example.org",
        APP_BASE_URL: "https://usr.example.org",
        SMTP_HOST: "smtp.example.org",
        SMTP_USER: "owner@example.org",
        SMTP_PASSWORD_FILE: "/tmp/randusr-fixture/smtp_password",
        SMTP_FROM_EMAIL: "no-reply@example.org",
      },
    },
  );
  const config = JSON.parse(stdout);
  assert.equal(config.services.api.environment.PUBLIC_REGISTRATION_ENABLED, "false");
  assert.equal(config.services.api.environment.PRODUCT_ANALYTICS_ENABLED, "false");
  assert.equal(config.services.db.ports, undefined);
  assert.equal(config.services.api.ports, undefined);
  assert.equal(config.services.api.environment.POSTGRES_PASSWORD, undefined);
  assert.equal(config.services.api.environment.SMTP_PASSWORD, undefined);
  assert.ok(config.services.api.depends_on.migrate);
  assert.ok(config.services.web.depends_on.api);
  const webPort = config.services.web.ports.find((port: { target: number }) => port.target === 80);
  assert.equal(webPort.host_ip, "127.0.0.1");
  assert.ok(config.volumes["postgres-data"]);
});
