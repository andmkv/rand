import { openMore } from "./more";
import { test, expect } from "@playwright/test";
test("guest editor runs and recovers local work without any API", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => route.abort("failed"));
  await page.goto("/create");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText('PRINT "Guest works without a server"');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished.");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText(
    "Guest works without a server",
  );
  await openMore(page);
  await expect(
    page.getByRole("button", { name: "Save file", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator('a[href="/admin"], a[href="/me/projects"]')
      .count(),
  ).toBe(0);
});
