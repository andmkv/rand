import { test, expect, type Page } from "@playwright/test";
import { games } from "../../src/content/games";
async function edit(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
}
for (const game of games) {
  test(`${game.title}: discover, load full source, play, edit and stop`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/create");
    await page.getByRole("button", { name: "EXAMPLES", exact: true }).click();
    const card = page.locator(`[data-example="${game.id}"]`);
    await expect(card.getByText(game.controls!, { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Load", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText(game.title);
    await expect(page.locator(".workspace-controls")).toContainText(
      game.controls!,
    );
    const object =
      game.id === "alien-attack"
        ? "SHIP"
        : game.id === "brick-breaker"
          ? "PADDLE"
          : "HERO";
    // Read a position through the public language, with all real rules intact.
    await edit(
      page,
      game.code.replace("  FRAME", `  PRINT ${object}.X\n  FRAME`),
    );
    await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect(page.locator("canvas")).toBeFocused();
    const position = async () =>
      Number(
        (await page.getByRole("log").innerText()).trim().split("\n").at(-1),
      );
    await expect.poll(position).toBeGreaterThan(0);
    const start = await position();
    await page.keyboard.down("ArrowRight");
    await expect.poll(position).toBeGreaterThan(start + 10);
    await page.keyboard.up("ArrowRight");
    // Editing releases held input; keys in CODE never steer the game.
    await page.locator(".cm-content").click();
    await page.waitForTimeout(80);
    const stoppedPosition = await position();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
    expect(await position()).toBe(stoppedPosition);
    await page.locator("canvas").click();
    // A round may end while CODE has focus. Hold the documented restart key,
    // then require moving left of the original spawn: restarting alone cannot pass.
    await page.keyboard.down("r");
    await page.keyboard.down("ArrowLeft");
    await expect.poll(position).toBeLessThan(start - 5);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("r");
    await page.getByRole("button", { name: "■ STOP", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Stopped");
    const source = game.code.replace(
      game.id === "alien-attack"
        ? "SPEED = 0.24"
        : game.id === "brick-breaker"
          ? "PADDLE.SIZE 40,8"
          : "JUMP = -4.8",
      game.id === "alien-attack"
        ? "SPEED = 0.4"
        : game.id === "brick-breaker"
          ? "PADDLE.SIZE 60,8"
          : "JUMP = -5.4",
    );
    await edit(page, source);
    await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("running");
    await page.getByRole("button", { name: "↺ RESET", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Ready");
    expect(errors).toEqual([]);
  });
}

test("letter controls work with a Cyrillic keyboard layout and release on keyup", async ({
  page,
}) => {
  await page.goto("/create");
  await edit(page, 'DO\n  PRINT KEY("R")\n  FRAME\nLOOP');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.locator("canvas")).toBeFocused();
  const last = async () =>
    (await page.getByRole("log").innerText()).trim().split("\n").at(-1);
  await expect.poll(last).toBe("false");
  await page
    .locator("canvas")
    .dispatchEvent("keydown", { key: "к", code: "KeyR", bubbles: true });
  await expect.poll(last).toBe("true");
  await page
    .locator("canvas")
    .dispatchEvent("keyup", { key: "к", code: "KeyR", bubbles: true });
  await expect.poll(last).toBe("false");
  await page.getByRole("button", { name: "■ STOP", exact: true }).click();
});
