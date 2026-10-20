import { createInvitation } from "../invitations.js";
import { hashPassword } from "../auth.js";
import { users } from "../db/schema.js";
import { seedDatabase } from "../db/seed.js";
import { mkdir, writeFile } from "node:fs/promises";
// Explicit local E2E harness: disposable DB, private file mail, no production access.
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { Mailer, FileMail } from "../mail.js";
// Ports are overridable so a second worktree can run its own harness alongside the default one.
const apiPort = Number(process.env.E2E_API_PORT ?? 3001),
  webOrigin =
    process.env.E2E_WEB_ORIGIN ??
    process.env.PLAYWRIGHT_BASE_URL ??
    "http://localhost:5173";
const pg = await disposablePostgres();
const bootstrapMode = process.env.BOOTSTRAP_E2E === "1";
const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "bootstrap@example.invalid";
if (process.env.ANALYTICS_E2E === "1") {
  process.env.PRODUCT_ANALYTICS_ENABLED = "true";
  process.env.PRODUCT_ANALYTICS_NOTICE_VERSION = "fixture-v1";
  process.env.PRODUCT_ANALYTICS_NOTICE_URL =
    "https://example.invalid/fixture-notice";
}
await migrateDatabase(pg.db);
// Shared admin fixture avoids competing signup of the one bootstrap email across
// parallel browser files. Bootstrap mode intentionally starts with no admin so the
// public first-admin invitation endpoint and the email onboarding can be exercised.
if (!bootstrapMode)
  await pg.db.insert(users).values({
    email: "admin@example.invalid",
    displayName: "Fixture administrator",
    passwordHash: await hashPassword("A very secret testing password"),
    verifiedAt: new Date(),
    isAdmin: true,
  });
await seedDatabase(pg.db);
if (process.env.CLOSED_TEST_E2E === "1") {
  await mkdir("/tmp/randusr-e2e-invites", { recursive: true, mode: 0o700 });
  for (const browser of ["chromium", "webkit", "tablet"]) {
    const email = `invite-${browser}@example.invalid`,
      invite = await createInvitation(pg.db, email);
    const url = new URL("/invite", webOrigin);
    url.hash = new URLSearchParams({ token: invite.token }).toString();
    await writeFile(
      `/tmp/randusr-e2e-invites/${browser}.json`,
      JSON.stringify({ email, url: url.href }),
      { mode: 0o600 },
    );
  }
}

const app = buildApp(pg.db, false, {
  baseUrl: webOrigin,
  secureCookies: false,
  adminEmail: bootstrapMode ? bootstrapEmail : "admin@example.invalid",
  sessionDays: 14,
  publicRegistrationEnabled:
    process.env.CLOSED_TEST_E2E !== "1" && !bootstrapMode,
  mailer: new Mailer(
    new FileMail("/tmp/randusr-e2e-mail"),
    webOrigin,
  ),
});
// Browser suites create many accounts from one loopback IP. Production throttles
// are tested without this fixture-only adjustment in auth.test.ts.
app.addHook("onRoute", (options) => {
  if (options.config?.rateLimit && typeof options.config.rateLimit === "object")
    options.config.rateLimit.max = 1000;
});
app.addHook("onClose", async () => {
  await pg.stop();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: "127.0.0.1", port: apiPort });
console.log(`Disposable auth E2E API ready on ${apiPort}`);
