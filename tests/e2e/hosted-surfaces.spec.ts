import { test, expect, type Page } from "@playwright/test";
import { hostedCopy } from "../../shared/copy";
import { locales } from "../../src/i18n";

// Rendering-only identities: real cookie/session authorization is tested independently
// by the DB-backed API matrix and hosted journey suites, never by these mocks.
async function renderingIdentity(page: Page, role: string, locale = "en") {
  const principal =
    role === "guest"
      ? null
      : {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          active: true,
          verified: role !== "unverified",
          isAdmin: role === "admin",
        };
  await page.addInitScript(
    (language) => localStorage.setItem("randomize-usr.locale", language),
    locale,
  );
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/v1/session"
        ? { principal }
        : path === "/api/v1/auth/csrf"
          ? { token: "rendering-fixture-csrf" }
          : path === "/api/v1/auth/me" && principal
            ? {
                ...principal,
                email: "rendering@example.invalid",
                displayName: "Rendering fixture",
                locale,
                createdAt: "2026-10-18T00:00:00Z",
              }
            : path === "/api/v1/gallery" || path === "/api/v1/projects"
              ? { projects: [], nextCursor: null }
              : path === "/api/v1/admin/users"
                ? { users: [], nextCursor: null }
                : null;
    if (body) return route.fulfill({ json: body });
    if (route.request().method() !== "GET")
      return route.fulfill({
        status: 400,
        json: {
          error: { code: "INVALID_INPUT", requestId: "rendering-fixture" },
        },
      });
    return route.continue();
  });
}
async function fits(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const control of await page
    .locator("button:visible, input:visible, select:visible")
    .all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      );
    }
  }
}
for (const role of ["guest", "registered", "unverified", "admin"]) {
  test(`${role}: hosted navigation follows the guest/account/admin contract`, async ({
    page,
  }) => {
    await renderingIdentity(page, role);
    await page.goto("/");
    const hosted = !["guest", "unverified"].includes(role);
    await expect(page.locator('a[href="/me/projects"]')).toHaveCount(
      hosted ? 1 : 0,
    );
    await expect(page.locator('a[href="/admin"]')).toHaveCount(
      role === "admin" ? 1 : 0,
    );
    await expect(page.locator('a[href="/classes"]')).toHaveCount(0);
    await page.goto("/classes");
    await expect(page.getByText(hostedCopy("error_NOT_FOUND", "en"))).toBeVisible();
  });
}
for (const { id } of locales) {
  test(`${id}: hosted account/gallery/admin layouts and keyboard forms`, async ({
    page,
  }, info) => {
    await renderingIdentity(page, "admin", id);
    const c = (key: string) => hostedCopy(key, id),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.locator('a[href="/admin"]')).toBeVisible();
    await fits(page);
    await page.locator(".account-button").focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(c("displayName"), { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.locator('select[name="locale"]')).toBeFocused();
    await fits(page);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.goto("/admin");
    const search = page.locator('.admin-filters input[name="q"]');
    await search.fill("Keyboard search");
    await search.press("Enter");
    await expect(search).toHaveValue("Keyboard search");
    await fits(page);
    if (info.project.name === "tablet" && ["de", "ru", "ja"].includes(id))
      await page.screenshot({ path: `test-results/hosted-${id}-tablet.png` });
    expect(errors).toEqual([]);
  });
}
