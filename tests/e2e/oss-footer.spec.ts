import { test, expect } from "@playwright/test";

test("localized brand footer stays reachable without adding editor or page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const footer = page.locator(".site-brand-footer");
  await expect(footer).toBeVisible();
  await expect(footer).toContainText("© 2026 Smallhall.net –");
  const link = footer.getByRole("link", { name: "More apps and games" });
  await expect(link).toHaveAttribute("href", "https://smallhall.net");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await link.focus();
  await expect(link).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.evaluate(() => localStorage.setItem("randomize-usr.locale", "ru"));
  await page.reload();
  await expect(footer.getByRole("link", { name: "Больше приложений и игр" })).toBeVisible();

  await page.goto("/create");
  await expect(footer).toBeVisible();
  await expect(page.locator(".app")).toBeVisible();
  const dimensions = await page.locator(".app").evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    viewport: window.innerHeight,
  }));
  expect(dimensions.height).toBeLessThan(dimensions.viewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
