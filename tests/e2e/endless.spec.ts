import { test, expect } from "@playwright/test";
test("tight DO keeps controls responsive and stops promptly", async ({
  page,
}) => {
  await page.goto("/create");
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText("DO\nLOOP");
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await page.getByRole("button", { name: "SPELLBOOK", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "■ STOP", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Stopped");
});
for (const title of ["STARFIELD", "FIREWORKS", "FALLING CARDS", "ROBOT RADIO"])
  test(`living ${title}`, async ({ page }) => {
    await page.goto("/create");
    await page.getByRole("button", { name: "EXAMPLES", exact: true }).click();
    const card = page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(card).toContainText("Runs until STOP");
    await card.getByRole("button", { name: "Load & Run", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "■ STOP", exact: true }),
    ).toBeEnabled();
    await page.waitForTimeout(6000);
    await expect(page.getByRole("status")).toContainText("running");
    await page.getByRole("button", { name: "■ STOP", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Stopped");
  });
