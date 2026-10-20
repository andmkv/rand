import { test, expect } from "@playwright/test";
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
])
  test(`story-first viewport ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/create");
    await expect(
      page.getByRole("heading", { name: "STORY", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "SCREEN 256 × 192", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "CODE", exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "A few lines. A whole little world.",
    );
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.fonts.check("24px Handjet")),
    ).toBe(true);
    for (const name of ["SPELLBOOK", "EXAMPLES", "INVENTORY"]) {
      const handle = page.getByRole("button", { name, exact: true });
      await handle.click();
      await expect(handle).toHaveAttribute("aria-expanded", "true");
      expect(
        await page.evaluate(() => ({
          x: document.documentElement.scrollWidth <= innerWidth,
          y: document.documentElement.scrollHeight <= innerHeight,
        })),
      ).toEqual({ x: true, y: true });
      await handle.click();
      await expect(handle).toHaveAttribute("aria-expanded", "false");
    }
    await page.screenshot({
      path: `test-results/layout-${viewport.width}.png`,
    });
  });
