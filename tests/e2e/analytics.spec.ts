import { openMore, openShareDetails } from "./more";
import { test, expect } from "@playwright/test";
import { createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(
  process.env.ANALYTICS_E2E !== "1",
  "Requires optional analytics enabled only in disposable fixture",
);
test("no counts before consent; same-tab guest RUN/signup/save/publish carries only opted-in counters and stops on decline", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const events: Record<string, unknown>[] = [],
    mutations: { url: string; token: string | null }[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/v1/analytics/events") && r.method() === "POST")
      events.push(r.postDataJSON());
    if (r.url().includes("/api/v1/") && ["POST", "PUT"].includes(r.method()))
      mutations.push({
        url: r.url(),
        token: r.headers()["x-product-session"] ?? null,
      });
  });
  await page.goto("/create");
  await page.locator(".usage-control summary").click();
  await expect(
    page.getByRole("button", { name: "Allow for this tab", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("randusr-usage-choice")),
  ).toBeNull();
  await page.locator(".usage-control summary").click();
  await editSource(page, 'PRINT "PRIVATE TEXT STAYS HERE"');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.locator(".status")).toContainText("Finished.");
  expect(events).toHaveLength(0);
  await page.goto("/");
  await page.locator(".usage-control summary").click();
  await page
    .getByRole("button", { name: "Allow for this tab", exact: true })
    .click();
  await expect
    .poll(() => events.some((e) => e.event === "homepage_viewed"))
    .toBe(true);
  await page.goto("/create");
  await editSource(page, 'PRINT "PRIVATE TEXT STAYS HERE"');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect
    .poll(() => events.some((e) => e.event === "program_run"))
    .toBe(true);
  await createVerifiedUser(
    page,
    `analytics-${info.project.name}-${Date.now()}@example.invalid`,
  );
  await page.getByLabel("Project title", { exact: true }).fill("Counted moon");
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await openMore(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share", exact: true });
  await share.locator("input[name=visibility][value=public]")
    .check({ force: true });
  await openShareDetails(share);
  await share
    .getByLabel("Short description", { exact: true })
    .fill("A moon to change");
  await share.getByLabel("Art", { exact: true }).check();
  await share
    .getByRole("button", { name: "Save sharing settings", exact: true })
    .click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  await share.getByRole("button", { name: "Close", exact: true }).click();
  const choice = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("randusr-usage-choice")!),
  );
  expect(choice.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  for (const event of events) {
    expect(Object.keys(event).sort()).toEqual([
      "event",
      "noticeVersion",
      "sessionToken",
    ]);
    expect(event.sessionToken).toBe(choice.token);
  }
  expect(JSON.stringify(events)).not.toContain("PRIVATE TEXT");
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain(choice.token);
  for (const path of ["/auth/register", "/auth/verify", "/projects"])
    expect(
      mutations.some((r) => r.url.endsWith(path) && r.token === choice.token),
    ).toBe(true);
  await page.locator(".usage-control summary").click();
  await page.screenshot({
    path: `test-results/analytics-choice-${info.project.name}.png`,
  });
  const stopped = page.waitForResponse(
    (r) =>
      r.url().endsWith("/analytics/session") &&
      r.request().method() === "DELETE",
  );
  await page
    .getByRole("button", { name: "Decline / stop counts", exact: true })
    .click();
  expect((await stopped).ok()).toBe(true);
  const before = events.length;
  await page.goto("/create");
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.locator(".status")).toContainText("Finished.");
  expect(events.length).toBe(before);
  expect(
    await page.evaluate(() => sessionStorage.getItem("randusr-usage-choice")),
  ).not.toContain(choice.token);
});
test("verified admin sees useful current totals and explicit metric definitions", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "One bootstrap email per disposable fixture",
  );
  await createVerifiedUser(page, "admin@example.invalid");
  await page.goto("/admin?tab=metrics");
  await expect(
    page.getByRole("heading", { name: "Product health", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Current accounts", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Active accounts (7 days)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(2);
  await page.screenshot({ path: "test-results/product-health-chromium.png" });
});
