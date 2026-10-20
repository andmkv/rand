import { test, expect, type Page } from "@playwright/test";
import {
  assets,
  spriteAssets,
  soundAssets,
  assetSnippet,
} from "../../src/runtime/assets";
import { tables } from "../../src/locales/tables";
import { t, type Locale } from "../../src/i18n";
import { openMore } from "./more";

async function edit(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
}
const openInventory = (page: Page, locale: Locale = "en") =>
  page
    .getByRole("button", { name: t("inventory", locale), exact: true })
    .click();
const slot = (page: Page, id: string) => page.locator(`[data-asset="${id}"]`);

test("inventory covers the manifest, filters, inspects and inserts at the caret", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/create");
  await openInventory(page);
  await expect(
    page.getByRole("button", { name: "INVENTORY", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".inv-hint")).toBeVisible();
  await expect(page.locator(".inv-slot")).toHaveCount(assets.length);
  for (const asset of assets) {
    const card = slot(page, asset.id);
    await expect(card).toHaveAttribute("data-source", "standard");
    // Hover and keyboard focus get the same localized name + type label.
    await expect(card).toHaveAttribute(
      "aria-label",
      `${asset.name} — ${t(asset.category, "en")}`,
    );
    await expect(card).toHaveAttribute(
      "title",
      `${asset.name} — ${t(asset.category, "en")}`,
    );
    if (asset.category === "sprites")
      expect(await card.locator("svg rect").count()).toBeGreaterThan(0);
    else await expect(card.locator(".inv-sound")).toHaveCount(1);
  }
  const search = page.getByRole("searchbox");
  await search.fill("alien");
  await expect(page.locator(".inv-slot")).toHaveCount(1);
  await search.fill("treasure");
  expect(await page.locator(".inv-slot").count()).toBeGreaterThan(1);
  await search.fill("no-such-asset");
  await expect(
    page.getByText("No assets found.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".inv-slot")).toHaveCount(assets.length);

  // A type filter combines with the text search and updates the count chips.
  await page.getByRole("button", { name: /^SOUNDS/ }).click();
  await expect(page.locator(".inv-slot")).toHaveCount(soundAssets.length);
  await search.fill("laser");
  await expect(page.locator(".inv-slot")).toHaveCount(1);
  await expect(slot(page, "laser")).toHaveAttribute("aria-selected", "false");
  await slot(page, "laser").click();
  await expect(slot(page, "laser")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".inv-title h3")).toHaveText("Laser shot");
  await expect(page.locator(".inv-badge")).toHaveText(t("sounds", "en"));
  await expect(page.locator(".inv-id code")).toHaveText("laser");
  await expect(page.locator(".inv-snippet")).toHaveText(
    assetSnippet(assets.find((asset) => asset.id === "laser")!),
  );
  await search.fill("");
  await page.getByRole("button", { name: /^ALL/ }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Insert goes to the caret, leaves the rest of the program intact and does not replace CODE.
  await edit(page, 'CLS\nINK 6\nTEXT 10,10,"KEEP"\nINK 2');
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await openInventory(page);
  await search.fill("traveler");
  await slot(page, "traveler").click();
  await expect(page.locator(".inv-title h3")).toHaveText("Traveler");
  await page.getByRole("button", { name: "Insert in CODE", exact: true }).click();
  await expect(page.locator(".drawer.inventory")).toHaveCount(0);
  const code = await page.locator(".cm-content").innerText();
  expect(code).toContain('TEXT 10,10,"KEEP"');
  expect(code).toContain(
    assetSnippet(spriteAssets.find((asset) => asset.id === "traveler")!),
  );
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished");
  expect(errors).toEqual([]);
});

test("sound previews play only on request, stop with selection and insert runnable code", async ({
  page,
}) => {
  // Keep the brief preview label deterministic across browser engines.
  await page.clock.install();
  await page.addInitScript(() => {
    const context = window.AudioContext;
    const originalOscillator = context.prototype.createOscillator;
    const originalBufferSource = context.prototype.createBufferSource;
    (window as unknown as { soundSources: number }).soundSources = 0;
    context.prototype.createOscillator = function () {
      (window as unknown as { soundSources: number }).soundSources++;
      return originalOscillator.call(this);
    };
    context.prototype.createBufferSource = function () {
      (window as unknown as { soundSources: number }).soundSources++;
      return originalBufferSource.call(this);
    };
  });
  await page.goto("/create");
  const source = await page.locator(".cm-content").innerText();
  await openInventory(page);
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: /^SOUNDS/ }).click();
  for (const asset of soundAssets) {
    await slot(page, asset.id).click();
    const play = page.locator(".inv-actions button").nth(1);
    await expect(play).toHaveText(t("previewSound", "en"));
    const previousSources = await page.evaluate(
      () => (window as unknown as { soundSources: number }).soundSources,
    );
    await play.click();
    await expect(play).toHaveText(t("stop", "en"));
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { soundSources: number }).soundSources),
      )
      .toBeGreaterThan(previousSources);
    // Selecting something else silences the preview instead of letting audio run away.
    await slot(page, asset.id === "laser" ? "jump" : "laser").click();
    await expect(play).toHaveText(t("previewSound", "en"));
    expect(await page.locator(".cm-content").innerText()).toBe(source);
  }
  await slot(page, "laser").click();
  await page
    .getByRole("button", { name: "Insert in CODE", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText('SOUND "laser"');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished");
});

test("keyboard moves through the grid, Escape closes safely and state is remembered", async ({
  page,
}) => {
  await page.goto("/create");
  await edit(page, 'CLS\nINK 6\nTEXT 10,10,"KEEP"\n');
  await openInventory(page);
  const search = page.getByRole("searchbox");
  await search.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-asset="cat"]')).toBeFocused();
  await expect(page.locator('[data-asset="cat"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const focused = () =>
    page.evaluate(() => document.activeElement?.getAttribute("data-asset"));
  await page.keyboard.press("ArrowRight");
  expect(await focused()).toBe("wizard");
  await page.keyboard.press("ArrowDown");
  const down = await focused();
  expect(down).not.toBe("wizard");
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    down!,
  );
  await page.keyboard.press("End");
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    assets.at(-1)!.id,
  );
  await page.keyboard.press("Home");
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    assets[0].id,
  );
  // Enter and Space activate the focused slot without touching CODE.
  await page.locator('[data-asset="door"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "door",
  );
  await page.locator('[data-asset="jump"]').focus();
  await page.keyboard.press("Space");
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "jump",
  );
  await expect(page.locator(".cm-content")).toContainText('"KEEP"');
  // Escape clears a search first and only then closes, returning focus to the opener.
  await search.fill("star");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(page.locator(".drawer.inventory")).toBeVisible();
  await search.press("Escape");
  await expect(page.locator(".drawer.inventory")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "INVENTORY", exact: true }),
  ).toBeFocused();
  // Reopening keeps the chosen item; the drawer is a plain region, not a focus trap.
  await openInventory(page);
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "jump",
  );
  expect(
    await page.locator(".drawer.inventory").evaluate((el) => ({
      modal: el.getAttribute("aria-modal"),
      dialog: el.tagName,
    })),
  ).toEqual({ modal: null, dialog: "ASIDE" });
});

test("inventory stays on the left in Story and Sandbox with internal scrolling", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/create");
  for (const mode of ["STORY", "Sandbox"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await openInventory(page);
    const drawer = page.locator(".drawer.inventory");
    await expect(drawer).toBeVisible();
    const bounds = await drawer.boundingBox();
    expect(bounds!.x).toBeLessThan(50);
    for (const name of ["SPELLBOOK", "EXAMPLES", "INVENTORY"]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box!.y + box!.height).toBeLessThan(
        page.viewportSize()!.height - 15,
      );
    }
    // Only the results list scrolls; the page itself never does.
    const fit = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth <= innerWidth,
      height: document.documentElement.scrollHeight <= innerHeight,
    }));
    expect(fit).toEqual({ width: true, height: true });
    expect(
      await page
        .locator(".inv-results")
        .evaluate((el) => getComputedStyle(el).overflowY),
    ).toMatch(/auto|scroll/);
    await slot(page, "jump").scrollIntoViewIfNeeded();
    await expect(slot(page, "jump")).toBeVisible();
    await page.screenshot({
      path: `test-results/inventory-${info.project.name}-${mode}.png`,
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  // Narrow drawers overflow the grid, and only the grid scrolls.
  await page.setViewportSize({ width: 390, height: 844 });
  await openInventory(page);
  expect(
    await page
      .locator(".inv-results")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  expect(
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth <= innerWidth,
      height: document.documentElement.scrollHeight <= innerHeight,
    })),
  ).toEqual({ width: true, height: true });
});

test("guests get the standard inventory without creator features", async ({
  page,
}) => {
  await page.goto("/create");
  await openInventory(page);
  await expect(page.locator(".inv-slot")).toHaveCount(assets.length);
  await expect(page.locator(".inv-sources")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /New sprite/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /My assets/ })).toHaveCount(0);
});

test("touch selects and inserts without hover", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/create");
  await page.getByRole("button", { name: "INVENTORY", exact: true }).tap();
  await page.getByRole("searchbox").fill("cat");
  await slot(page, "cat").tap();
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "cat",
  );
  await page
    .getByRole("button", { name: "Insert in CODE", exact: true })
    .tap();
  await expect(page.locator(".cm-content")).toContainText('SPAWN("cat"');
  await context.close();
});

for (const locale of ["ru", "de", "ja"] as Locale[]) {
  test(`${locale}: the compact grid fits 1024×768 with localized labels`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/create");
    await openMore(page);
    await page.locator("select.language-picker").selectOption(locale);
    await openInventory(page, locale);
    await expect(page.getByRole("searchbox")).toHaveAttribute(
      "aria-label",
      t("inventorySearch", locale),
    );
    await expect(page.locator(".inv-hint")).toHaveText(
      t("inventoryPick", locale),
    );
    await page
      .getByRole("searchbox")
      .fill(tables[locale]["asset.cat.name"]);
    await expect(page.locator(".inv-slot")).toHaveCount(1);
    await slot(page, "cat").click();
    await expect(page.locator(".inv-title h3")).toHaveText(
      tables[locale]["asset.cat.name"],
    );
    await expect(page.locator(".inv-badge")).toHaveText(t("sprites", locale));
    await expect(
      page.getByRole("button", {
        name: t("inventoryInsert", locale),
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => ({
        width: document.documentElement.scrollWidth <= innerWidth,
        height: document.documentElement.scrollHeight <= innerHeight,
      })),
    ).toEqual({ width: true, height: true });
    await page.screenshot({
      path: `test-results/inventory-locale-${locale}.png`,
    });
  });
}
