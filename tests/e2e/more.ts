import { expect, type Page } from "@playwright/test";
const toggle = (page: Page) => page.locator('button[aria-controls="more-panel"]');
/** At laptop/tablet widths file actions and the language picker live inside the header's More menu. */
export async function openMore(page: Page) {
  // The editor is lazy-loaded; wait until the header exists before deciding whether a menu is needed.
  await page
    .locator("header")
    .first()
    .waitFor();
  if (!(await toggle(page).count())) return;
  if ((await toggle(page).getAttribute("aria-expanded")) !== "true") {
    await toggle(page).click();
  }
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
}
export async function closeMore(page: Page) {
  if (!(await toggle(page).count())) return;
  if ((await toggle(page).getAttribute("aria-expanded")) === "true")
    await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
}
/** The Share dialog keeps title/description/tags folded away until asked for. */
export async function openShareDetails(share: import("@playwright/test").Locator) {
  const details = share.locator("details").first();
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
    await details.locator("summary").click();
}
/** Shared project pages keep Edit original, Share, Report and Moderate in one More menu. */
export async function openViewerMore(page: Page) {
  const toggle = page.locator('button[aria-controls="viewer-more"]');
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
