import { openViewerMore } from "./more";
import { test, expect, type Page } from "@playwright/test";
import { appOrigin, createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable hosted API");
async function mutate(page: Page, path: string, body: unknown) {
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  const r = await page.request.post(`/api/v1${path}`, {
    headers: { origin: appOrigin, "x-csrf-token": csrf.token },
    data: body,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
test("report a published toy, retain dismissal and block its old link through the moderation queue", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const stamp = `${info.project.name}-${Date.now()}`;
  await createVerifiedUser(page, `report-owner-${stamp}@example.invalid`);
  await editSource(page, 'PRINT "REPORTABLE MOON"');
  await page
    .getByLabel("Project title", { exact: true })
    .fill(`Reported moon ${stamp}`);
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const p = (await (await page.request.get("/api/v1/projects")).json())
    .projects[0];
  const published = await mutate(page, `/projects/${p.id}/share`, {
    version: p.version,
    visibility: "public",
    title: `Reported moon ${stamp}`,
  });
  const context = await browser.newContext(),
    reporter = await context.newPage();
  const adminContext = await browser.newContext(),
    admin = await adminContext.newPage();
  try {
    await reporter.goto(`/p/${published.shortCode}`);
    await openViewerMore(reporter);
    await reporter
      .getByRole("button", { name: "Report project", exact: true })
      .click();
    await expect(reporter.getByRole("dialog")).toContainText(
      "Reports require a verified account",
    );
    await expect(
      reporter.getByRole("button", { name: "Sign in to report", exact: true }),
    ).toBeVisible();
    await reporter
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await createVerifiedUser(reporter, `reporter-${stamp}@example.invalid`);
    await reporter.goto(`/p/${published.shortCode}`);
    async function report() {
      await openViewerMore(reporter);
      await reporter
        .getByRole("button", { name: "Report project", exact: true })
        .click();
      const dialog = reporter.getByRole("dialog");
      await dialog
        .getByLabel("Report reason", { exact: true })
        .selectOption("personal_info");
      await dialog
        .getByLabel("Short details (optional; no contact information)", {
          exact: true,
        })
        .fill('<img src=x onerror="window.reportLeak=true">');
      await dialog
        .getByRole("button", { name: "Send report", exact: true })
        .click();
      await expect(dialog.getByRole("status")).toContainText("Report received");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }
    await report();
    expect(
      (
        await reporter.request.get(`/api/v1/shared/${published.shortCode}`)
      ).status(),
    ).toBe(200);
    if (info.project.name !== "chromium") return;
    admin.setDefaultTimeout(10000);
    await createVerifiedUser(admin, "admin@example.invalid");
    await admin.goto("/admin?tab=reports");
    let card = admin
      .locator(".admin-grid article")
      .filter({ hasText: `Reported moon ${stamp}` });
    await expect(card).toContainText("Personal information");
    await expect(card).toContainText("<img src=x");
    expect(
      await admin.evaluate(() => Boolean((window as any).reportLeak)),
    ).toBe(false);
    await card
      .getByLabel("Administrative reason", { exact: true })
      .fill("Original content; dismiss test");
    await card
      .getByRole("button", { name: "Save review decision", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await admin
      .getByLabel("Report status", { exact: true })
      .selectOption("dismissed");
    await expect(card).toContainText("Dismissed");
    await report();
    await admin
      .getByLabel("Report status", { exact: true })
      .selectOption("open");
    await card
      .getByRole("link", { name: "Inspect source", exact: true })
      .click();
    await expect(admin.locator(".cm-content")).toContainText("REPORTABLE MOON");
    await admin
      .locator(".viewer-info details")
      .first()
      .locator("summary")
      .click();
    await admin
      .getByLabel("Moderation action", { exact: true })
      .selectOption("block");
    await admin
      .getByLabel("Administrative reason", { exact: true })
      .fill("Remove accidental personal details");
    admin.once("dialog", (d) => d.accept());
    await admin
      .getByRole("button", { name: "Apply moderation", exact: true })
      .click();
    await expect(admin.locator(".viewer-info")).toContainText(
      "Sharing blocked",
    );
    await reporter.reload();
    await expect(reporter.getByRole("alert")).toContainText("This project isn’t available.");
    await expect(reporter.locator(".cm-content")).toHaveCount(0);
    await admin.goto("/admin?tab=reports");
    card = admin
      .locator(".admin-grid article")
      .filter({ hasText: `Reported moon ${stamp}` });
    await card
      .getByLabel("Review decision", { exact: true })
      .selectOption("resolve");
    await card
      .getByLabel("Administrative reason", { exact: true })
      .fill("Sharing blocked after inspection");
    await card
      .getByRole("button", { name: "Save review decision", exact: true })
      .click();
    await admin
      .getByLabel("Report status", { exact: true })
      .selectOption("resolved");
    await expect(card).toContainText("Resolved");
    await admin.screenshot({
      path: "test-results/reports-chromium.png",
      fullPage: true,
    });
  } finally {
    await context.close();
    await adminContext.close();
  }
});
