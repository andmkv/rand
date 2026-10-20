import { test, expect } from "@playwright/test";
import { editSource } from "./hosted-helpers";
test("home examples run without an account and preserve the child's draft", async ({
  page,
}, info) => {
  await page.route("**/api/v1/gallery?*", (route) =>
    route.fulfill({ json: { projects: [], nextCursor: null } }),
  );
  await page.goto("/create");
  await editSource(page, 'PRINT "MY LOCAL PLANET"');
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("randomize-usr.project.v1")),
    )
    .toContain("MY LOCAL PLANET");
  const local = await page.evaluate(() =>
    localStorage.getItem("randomize-usr.project.v1"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "EXAMPLES", exact: true }),
  ).toBeVisible();
  expect(await page.locator(".gallery-card").count()).toBe(15);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `test-results/home-${info.project.name}.png` });
  await page.locator('a[href="/examples/tunnel"]').first().click();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished.");
  expect(
    await page.evaluate(() => localStorage.getItem("randomize-usr.project.v1")),
  ).toBe(local);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Open in editor", exact: true })
    .click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(page.locator(".cm-content")).toContainText("CIRCLE 128,96,R");
});
test("gallery has recoverable errors and safely renders public metadata", async ({
  page,
}) => {
  let available = false;
  await page.route("**/api/v1/gallery?*", (route) =>
    available
      ? route.fulfill({
          json: {
            projects: [
              {
                shortCode: "abcdefghijklmnop",
                revisionId: "test",
                title: "<img src=x onerror=alert(1)>",
                description: "A tiny public moon",
                author: "Moon Maker",
                publishedAt: "2026-10-17T12:00:00Z",
                tags: ["art"],
                featured: false,
                mode: "sandbox",
                previewUrl: null,
              },
            ],
            nextCursor: null,
          },
        })
      : route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  available = true;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "<img src=x onerror=alert(1)>" }),
  ).toBeVisible();
  expect(
    await page
      .locator('section[aria-label="PUBLIC GALLERY"] .gallery-card img')
      .count(),
  ).toBe(0);
  await expect(
    page.getByRole("link", { name: "View / run", exact: true }),
  ).toHaveAttribute("href", "/p/abcdefghijklmnop");
});
