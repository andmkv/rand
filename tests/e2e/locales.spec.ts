import { closeMore, openMore } from "./more";
import { test, expect, type Page } from "@playwright/test";
import { locales, t, content, message, type Locale } from "../../src/i18n";
import { examples } from "../../src/content/examples";
import { tables } from "../../src/locales/tables";
async function edit(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
}
async function fits(page: Page, locale: Locale) {
  for (const name of [
    "run",
    "stop",
    "reset",
    "saveFile",
    "openFile",
  ] as const) {
    if (name === "saveFile") await openMore(page);
    const box = await page
      .getByRole("button", { name: t(name, locale), exact: true })
      .boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    if (["run", "stop", "reset"].includes(name)) {
      const panel = await page.locator(".code-panel").boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
    }
  }
  await closeMore(page);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
}
for (const { id } of locales.filter((locale) => locale.id !== "en")) {
  test(`${id}: all product surfaces, games, files, errors and persisted locale`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const copy = (key: Parameters<typeof t>[0]) => t(key, id);
    await page.goto("/create");
    await openMore(page);
    await page.getByLabel(t("locale", "en")).selectOption(id);
    await expect(page.locator("html")).toHaveAttribute("lang", id);
    await page.reload();
    await openMore(page);
    await expect(page.getByLabel(t("locale", id))).toHaveValue(id);
    await expect(
      page.getByRole("textbox", { name: copy("title"), exact: true }),
    ).toHaveAttribute("placeholder", copy("untitled"));
    await page.evaluate(() => document.fonts.ready);
    await fits(page, id);
    await expect(page.locator(".story h2")).toHaveText(
      tables[id]["story.tower.scene.0.title"],
    );
    await page
      .getByRole("button", { name: copy("example"), exact: true })
      .click();
    await page.getByRole("button", { name: copy("run"), exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(copy("finished"));
    await page
      .getByRole("button", { name: copy("spellbook"), exact: true })
      .click();
    await page.getByRole("searchbox").fill("INPUT");
    await expect(
      page.locator(".card").filter({
        has: page.getByRole("heading", { name: "INPUT", exact: true }),
      }),
    ).toContainText(tables[id]["spell.input.description"]);
    await page
      .getByRole("button", { name: copy("close"), exact: true })
      .click();
    await page
      .getByRole("button", { name: copy("inventory"), exact: true })
      .click();
    await page.getByRole("searchbox").fill(tables[id]["asset.cat.name"]);
    await expect(page.locator('[data-asset="cat"]')).toHaveAttribute(
      "title",
      `${tables[id]["asset.cat.name"]} — ${copy("sprites")}`,
    );
    await page.locator('[data-asset="cat"]').click();
    await expect(page.locator(".inv-title h3")).toHaveText(
      tables[id]["asset.cat.name"],
    );
    await expect(
      page.getByRole("button", { name: copy("inventoryInsert"), exact: true }),
    ).toBeVisible();
    await page.getByRole("searchbox").fill("laser");
    await page.locator('[data-asset="laser"]').click();
    await page
      .getByRole("button", { name: copy("previewSound"), exact: true })
      .click();
    await page
      .getByRole("button", { name: copy("close"), exact: true })
      .click();
    for (const game of content("examples", examples, id).filter(
      (example) => example.game,
    )) {
      await page
        .getByRole("button", { name: copy("examples"), exact: true })
        .click();
      const card = page.locator(`[data-example="${game.id}"]`);
      await expect(
        card.getByRole("heading", { name: game.title, exact: true }),
      ).toBeVisible();
      await expect(card).toContainText(game.controls!);
      await card
        .getByRole("button", { name: copy("try"), exact: true })
        .click();
      await expect(page.locator("canvas")).toBeFocused();
      await expect(page.getByRole("status")).toHaveText(copy("running"));
      // Shown once, under the SCREEN, after a localized "How to play" label.
      await expect(page.locator(".workspace-controls")).toContainText(
        game.controls!,
      );
      await fits(page, id);
      if (game.id === "alien-attack" && info.project.name === "chromium") {
        await page.waitForTimeout(100);
        await page.screenshot({ path: `test-results/locale-${id}-game.png` });
      }
      await page
        .getByRole("button", { name: copy("stop"), exact: true })
        .click();
    }
    await edit(page, "CIRLCE 1,2,3");
    await page.getByRole("button", { name: copy("run"), exact: true }).click();
    await expect(page.getByRole("status")).toContainText("CIRLCE");
    await expect(page.getByRole("status")).toContainText("CIRCLE");
    expect(await page.getByRole("status").innerText()).not.toMatch(/\{\w+\}/);
    const download = page.waitForEvent("download");
    await openMore(page);
    await page
      .getByRole("button", { name: copy("saveFile"), exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.randusr$/);
    await page.locator('input[type="file"]').setInputFiles({
      name: "bad.randusr",
      mimeType: "application/json",
      buffer: Buffer.from("bad"),
    });
    await expect(page.getByRole("status")).toContainText(
      message("importInvalid", {}, id),
    );
    await page
      .getByRole("button", { name: copy("story"), exact: true })
      .click();
    await fits(page, id);
    if (info.project.name === "chromium")
      await page.screenshot({ path: `test-results/locale-${id}-story.png` });
    expect(errors).toEqual([]);
  });
}
