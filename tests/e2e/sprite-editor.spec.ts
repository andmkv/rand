import {
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openMore, openShareDetails } from "./more";

const hosted = process.env.HOSTED_E2E === "1";
test.skip(!hosted, "Requires the disposable server/tests/serve.ts API");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1024, height: 768 } });

const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// Every test opens its own browser context (demo sessions); close them so a leaked page cannot
// keep an inactive WebKit page from rendering the next test.
test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

async function openDemo(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: "Try Demo" }).click();
  await page.waitForURL("**/create");
  await expect(page.locator(".demo-badge")).toBeVisible();
  return page;
}
async function editSource(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
}
/** CSS pixels per sprite pixel, from the rendered canvas. */
async function pixelSize(page: Page) {
  const box = (await page.locator(".px-canvas").boundingBox())!;
  const width = Number(
    await page.locator(".px-canvas").getAttribute("data-sprite-width"),
  );
  return { box, size: box.width / width };
}
async function drawCell(page: Page, x: number, y: number) {
  const { box, size } = await pixelSize(page);
  await page.mouse.move(box.x + (x + 0.5) * size, box.y + (y + 0.5) * size);
  await page.mouse.down();
  await page.mouse.up();
}
async function openNewSprite(page: Page) {
  await page.getByRole("button", { name: "INVENTORY", exact: true }).click();
  await page.getByRole("button", { name: /New sprite/ }).click();
  await expect(page.locator("dialog.px")).toBeVisible();
}
const screenPixel = (page: Page, x: number, y: number) =>
  page
    .locator("canvas")
    .first()
    .evaluate(
      (element, [px, py]) =>
        Array.from(
          (element as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(px, py, 1, 1).data,
        ).join(","),
      [x, y],
    );

test("draw, save, insert and run a sprite with exact pixels and a reload", async ({
  browser,
}) => {
  const page = await openDemo(browser);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await editSource(page, "CLS");
  await openNewSprite(page);
  await expect(page.locator(".px-zoom-value")).toContainText("×");
  await page.locator('.px-swatch[data-slot="14"]').click();
  await drawCell(page, 0, 0);
  await drawCell(page, 1, 0);
  await drawCell(page, 0, 1);
  await page.locator(".px-name input").fill("Dot");
  await page.getByRole("button", { name: "Save sprite" }).click();
  await expect(page.locator("dialog.px")).toHaveCount(0);
  // The saved sprite is selected in the drawer and keeps its stable alias.
  await expect(page.getByRole("button", { name: /My assets/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "@dot",
  );
  await expect(page.locator(".inv-snippet")).toHaveText(
    'SPRITE = SPAWN("@dot",80,120)',
  );
  await expect(page.locator(".inv-title h3")).toHaveText("Dot");
  await page
    .getByRole("button", { name: "Insert in CODE", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText('SPAWN("@dot"');
  // SPAWN centres the 16×16 sprite on (80,120), so pixel (0,0) lands on (72,112).
  await editSource(page, 'CLS\nHERO = SPAWN("@dot",80,120)');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => screenPixel(page, 72, 112)).toBe("255,255,0,255");
  await expect.poll(() => screenPixel(page, 73, 112)).toBe("255,255,0,255");
  await expect.poll(() => screenPixel(page, 72, 113)).toBe("255,255,0,255");
  await expect.poll(() => screenPixel(page, 74, 112)).toBe("0,0,0,255");
  await page.screenshot({ path: "test-results/sprite-run.png" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => screenPixel(page, 72, 112)).toBe("255,255,0,255");

  // The exported .randusr carries the sprite pixels but strips private cloud IDs.
  const downloadWait = page.waitForEvent("download");
  await openMore(page);
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const download = await downloadWait;
  const raw = await readFile((await download.path())!, "utf8");
  const portable = JSON.parse(raw);
  expect(portable.assetManifest.sprites[0].sprite.pixels.slice(0, 3)).toEqual([
    14, 14, 0,
  ]);
  expect(raw).not.toMatch(/"(?:assetId|versionId)"/);

  // Import into a clean guest context and run the self-contained sprite.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  guest.on("dialog", (dialog) => void dialog.accept());
  try {
    await guest.goto(origin + "/create", { waitUntil: "networkidle" });
    await guest.locator("input[type=file]").setInputFiles({
      name: "dot.randusr",
      mimeType: "application/json",
      buffer: Buffer.from(raw, "utf8"),
    });
    await expect(guest.locator(".cm-content")).toContainText('SPAWN("@dot"');
    await guest.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect.poll(() => screenPixel(guest, 72, 112)).toBe("255,255,0,255");
  } finally {
    await guestContext.close();
  }
  expect(errors).toEqual([]);
});

test("editing a sprite creates a new version and keeps the alias", async ({
  browser,
}) => {
  const page = await openDemo(browser);
  await openNewSprite(page);
  await page.locator('.px-swatch[data-slot="14"]').click();
  await drawCell(page, 0, 0);
  await page.locator(".px-name input").fill("Versioned");
  await page.getByRole("button", { name: "Save sprite" }).click();
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "@versioned",
  );
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator("dialog.px")).toBeVisible();
  await expect(page.locator(".px-name input")).toHaveValue("Versioned");
  await page.locator('.px-swatch[data-slot="4"]').click();
  await drawCell(page, 0, 1);
  await page.locator(".px-name input").fill("Versioned two");
  await page.getByRole("button", { name: "Save sprite" }).click();
  await expect(page.locator("dialog.px")).toHaveCount(0);
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "@versioned",
  );
  await expect(page.locator(".inv-title h3")).toHaveText("Versioned two");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // The newest version carries both the old and the new pixel.
  await editSource(page, 'CLS\nHERO = SPAWN("@versioned",80,120)');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => screenPixel(page, 72, 112)).toBe("255,255,0,255");
  await expect.poll(() => screenPixel(page, 72, 113)).toBe("0,191,0,255");
});

test("a published project shows the pinned sprite to an anonymous visitor", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60000);
  const page = await openDemo(browser);
  // A blank SCREEN keeps the published pixel check deterministic.
  await editSource(page, "CLS");
  await openNewSprite(page);
  await page.locator('.px-swatch[data-slot="10"]').click();
  await drawCell(page, 0, 0);
  await drawCell(page, 1, 1);
  await page.locator(".px-name input").fill("Pinned");
  await page.getByRole("button", { name: "Save sprite" }).click();
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "@pinned",
  );
  await page.getByRole("button", { name: "Insert in CODE", exact: true }).click();
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await openMore(page);
  await page.getByRole("button", { name: "Share" }).first().click();
  const share = page.locator("dialog[open]");
  await share.locator("input[name=visibility][value=public]").check({ force: true });
  await openShareDetails(share);
  await share.locator("input[name=title]").fill("Pinned sprite game");
  await share.locator("form button").click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  const code = (await share
    .locator('a[href^="/p/"]')
    .getAttribute("href"))!.replace("/p/", "");
  await share.getByRole("button", { name: "Close" }).first().click();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${origin}/p/${code}`, { waitUntil: "networkidle" });
  await expect(visitor.getByRole("heading", { name: "Pinned sprite game" })).toBeVisible();
  await visitor.getByRole("button", { name: /RUN/ }).first().click();
  await expect
    .poll(() => screenPixel(visitor, 72, 112))
    .toBe("255,0,0,255");
  await expect
    .poll(() => screenPixel(visitor, 73, 113))
    .toBe("255,0,0,255");
  await expect.poll(() => screenPixel(visitor, 74, 112)).toBe("0,0,0,255");
  await visitor.screenshot({ path: "test-results/sprite-published.png" });

  // Editing the library after publication must not mutate the pinned version.
  await page.getByRole("button", { name: "INVENTORY", exact: true }).click();
  await page.getByRole("button", { name: /My assets/ }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('.px-swatch[data-slot="4"]').click();
  await drawCell(page, 2, 0);
  await page.getByRole("button", { name: "Save sprite" }).click();
  await expect(page.locator("dialog.px")).toHaveCount(0);
  await page.getByRole("button", { name: "Insert in CODE", exact: true }).click();
  await editSource(page, 'CLS\nHERO = SPAWN("@pinned",80,120)');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => screenPixel(page, 74, 112)).toBe("0,191,0,255");

  await visitor.reload({ waitUntil: "networkidle" });
  await visitor.getByRole("button", { name: /RUN/ }).first().click();
  await expect.poll(() => screenPixel(visitor, 74, 112)).toBe("0,0,0,255");
  await expect.poll(() => screenPixel(visitor, 72, 112)).toBe("255,0,0,255");
  await visitor.setViewportSize({ width: 390, height: 844 });
  await expect(visitor.locator(".workspace")).toHaveClass(/layout-stack/);
  const viewerInfo = await visitor.locator(".viewer-info").boundingBox();
  expect(viewerInfo?.width).toBeGreaterThan(280);
  if (testInfo.project.name === "chromium") {
    await visitor.screenshot({ path: "docs/qa-113/screens/viewer-en-390x844.png" });
  }
  await visitor.context().close();
});

test("tools, shortcuts, resize guard and export work", async ({ browser }) => {
  const page = await openDemo(browser);
  await openNewSprite(page);
  // Pencil, eraser, fill, rectangle and flips are all reachable.
  await page.locator('.px-swatch[data-slot="15"]').click();
  await drawCell(page, 0, 0);
  await page.locator('[data-tool="eraser"]').click();
  await drawCell(page, 0, 0);
  // The erased pixel is transparent again (alpha 0) on the editor canvas.
  await expect
    .poll(() =>
      page.locator(".px-canvas").evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext("2d")!;
        const size =
          canvas.width / Number(canvas.getAttribute("data-sprite-width"));
        return context.getImageData(size / 2, size / 2, 1, 1).data[3];
      }),
    )
    .toBe(0);
  await page.locator('[data-tool="rect"]').click();
  const { box, size } = await pixelSize(page);
  await page.mouse.move(box.x + size, box.y + size);
  await page.mouse.down();
  await page.mouse.move(box.x + size * 4, box.y + size * 4);
  await page.mouse.up();
  await page.locator('[data-tool="fill"]').click();
  await drawCell(page, 2, 2);
  await page.locator('[data-tool="picker"]').click();
  await drawCell(page, 2, 2);
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await page.locator('.px-tool[data-tool="pencil"]').click();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  // Keyboard painting: arrow to a cell, Enter paints it.
  await page.locator(".px-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  // Resize asks first, keeps the drawing, and undo brings the old size back.
  await page.locator('.px-size[data-size="8"]').click();
  await expect(page.locator(".px-confirm")).toBeVisible();
  await page.locator(".px-cancel").click();
  await expect(page.locator(".px-canvas")).toHaveAttribute(
    "data-sprite-width",
    "16",
  );
  await page.locator('.px-size[data-size="8"]').click();
  await page.locator(".px-confirm-ok").click();
  await expect(page.locator(".px-canvas")).toHaveAttribute(
    "data-sprite-width",
    "8",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".px-canvas")).toHaveAttribute(
    "data-sprite-width",
    "16",
  );
  await expect(page.locator("dialog.px")).toHaveJSProperty("open", true);
  // Grid, zoom and pan controls.
  await page.locator(".px-canvas").click();
  await page.keyboard.press("g");
  await expect(page.locator("dialog.px")).toHaveJSProperty("open", true);
  await page.locator(".px-grid").click();
  await page.locator(".px-zoom-in").click();
  await page.locator(".px-zoom-out").click();
  await page.locator(".px-fit").click();
  await page.locator(".px-help summary").click();
  await expect(page.locator(".px-help p")).toBeVisible();
  // A dirty editor asks before closing.
  await page.locator(".px-name input").fill("Draft");
  await page.locator(".px-close").click();
  await expect(page.locator(".px-confirm")).toBeVisible();
  await page.locator(".px-cancel").click();
  await expect(page.locator("dialog.px")).toBeVisible();
  await page.screenshot({ path: "test-results/sprite-editor-tools.png" });
  const download = page.waitForEvent("download");
  await page.locator(".px-export").click();
  expect((await download).suggestedFilename()).toBe("Draft.png");
});

test("the editor fits 1024×768 and a narrow phone without page scroll", async ({
  browser,
}) => {
  const page = await openDemo(browser);
  await openNewSprite(page);
  for (const [width, height] of [
    [1024, 768],
    [820, 1180],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(() => ({
        width: document.documentElement.scrollWidth <= innerWidth,
        height: document.documentElement.scrollHeight <= innerHeight,
      })),
    ).toEqual({ width: true, height: true });
    await expect(page.locator(".px-canvas")).toBeVisible();
    await expect(page.locator(".px-save")).toBeInViewport();
    await page.screenshot({
      path: `test-results/sprite-editor-${width}.png`,
    });
  }
});
