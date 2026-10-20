import { test, expect } from "@playwright/test";
import { games } from "../../src/content/games";
// Explicit opt-in: real wall-clock endurance, separate from normal smoke checks.
for (const game of games) {
  test(`${game.title}: three minute keyboard/audio/runtime soak`, async ({
    page,
  }, info) => {
    test.skip(
      process.env.GAME_SOAK !== "1" || info.project.name !== "chromium",
      "GAME_SOAK=1 enables the three minute endurance pass",
    );
    test.setTimeout(220000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/create");
    await page.getByRole("button", { name: "EXAMPLES", exact: true }).click();
    await page
      .locator(`[data-example="${game.id}"]`)
      .getByRole("button", { name: "Load & Run", exact: true })
      .click();
    await expect(page.locator("canvas")).toBeFocused();
    await page.screenshot({ path: `test-results/${game.id}.png` });
    await page.keyboard.down("r");
    const end = Date.now() + 180000;
    while (Date.now() < end) {
      await page.keyboard.down("ArrowRight");
      await page.keyboard.down("Space");
      await page.waitForTimeout(200);
      await page.keyboard.up("Space");
      await page.keyboard.up("ArrowRight");
      await page.keyboard.down("ArrowLeft");
      await page.waitForTimeout(200);
      await page.keyboard.up("ArrowLeft");
      await expect(page.getByRole("status")).toContainText("running");
    }
    await page.keyboard.up("r");
    await page.getByRole("button", { name: "■ STOP", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Stopped");
    expect(errors).toEqual([]);
  });
}
