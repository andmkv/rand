import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openMore, openShareDetails } from "./more";

// Card 120 — animation timeline, preview and onion skin.
// Run against the disposable harness:
//   E2E_API_PORT=3011 E2E_WEB_ORIGIN=http://localhost:5183 npx tsx server/tests/serve.ts
//   HOSTED_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:5183 npx playwright test animation --workers=1
const hosted = process.env.HOSTED_E2E === "1";
test.skip(!hosted, "Requires the disposable server/tests/serve.ts API");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });
// WebKit replays many small pointer and keyboard steps per test; keep the suite
// stable on a loaded machine without hiding real hangs.
test.setTimeout(90_000);

const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// The demo login endpoint allows 10 sessions per 15 minutes per IP, so the whole
// file shares one session and resets the editor between serial tests instead of
// creating a throwaway demo account per test.
let session: { context: BrowserContext; page: Page } | null = null;

async function demoPage(browser: Browser): Promise<Page> {
  if (session && !session.page.isClosed()) return session.page;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: "Try Demo" }).click();
  await page.waitForURL("**/create");
  await expect(page.locator(".demo-badge")).toBeVisible();
  session = { context, page };
  return page;
}
/** Fresh editor page in the same demo session, at the default review viewport. */
async function resetEditor(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await page.locator(".cm-content").waitFor();
}
async function openNewSprite(page: Page) {
  await page.getByRole("button", { name: "INVENTORY", exact: true }).click();
  await page.getByRole("button", { name: /New sprite/ }).click();
  await expect(page.locator("dialog.px")).toBeVisible();
}
/** CSS pixels per sprite pixel, from the rendered canvas. */
async function zoomOf(page: Page) {
  const box = (await page.locator(".px-canvas").boundingBox())!;
  const width = Number(
    await page.locator(".px-canvas").getAttribute("data-sprite-width"),
  );
  return { box, size: box.width / width };
}
async function drawCell(page: Page, x: number, y: number) {
  const { box, size } = await zoomOf(page);
  await page.mouse.move(box.x + (x + 0.5) * size, box.y + (y + 0.5) * size);
  await page.mouse.down();
  await page.mouse.up();
}
/** RGBA of one sprite pixel on the editor canvas (ghosts included when drawn). */
async function canvasPixel(page: Page, x: number, y: number) {
  const { size } = await zoomOf(page);
  const rgba = await page.locator(".px-canvas").evaluate(
    (element, args) => {
      const [px, py, scale] = args as number[];
      const context = (element as HTMLCanvasElement).getContext("2d")!;
      const data = context.getImageData(
        Math.floor(px * scale + scale / 2),
        Math.floor(py * scale + scale / 2),
        1,
        1,
      ).data;
      return [data[0], data[1], data[2], data[3]];
    },
    [x, y, size],
  );
  return { rgba };
}
const frameCount = (page: Page) =>
  page.locator(".px-canvas").getAttribute("data-frame-count");
const canvasFrame = (page: Page) =>
  page.locator(".px-canvas").getAttribute("data-frame-index");
async function selectFrame(page: Page, index: number) {
  await page.locator(`.px-anim-thumb[data-frame-index="${index}"]`).click();
  await expect.poll(() => canvasFrame(page)).toBe(String(index));
}
/** Four frames: 0 = three pixels, 1 = copy + (6,6), 2 = blank + (10,10), 3 = copy of 2. */
async function drawFourFrames(page: Page) {
  await openNewSprite(page);
  await page.locator('.px-swatch[data-slot="14"]').click();
  await drawCell(page, 2, 2);
  await drawCell(page, 3, 2);
  await drawCell(page, 2, 3);
  // Progressive disclosure: the timeline only exists after the first extra frame.
  await expect(page.locator("[data-frames]")).toHaveCount(0);
  await page.locator(".px-animate").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "2");
  await drawCell(page, 6, 6);
  await page.locator(".px-add-frame").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "3");
  await drawCell(page, 10, 10);
  await page.locator(".px-duplicate-frame").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  // Frame 3 starts as a copy of frame 2; the extra pixel makes every frame unique.
  await drawCell(page, 12, 12);
  await expect(page.locator(".px-anim-thumb")).toHaveCount(4);
}

test("draws a four-frame walk and previews it at 12 and 1 FPS", async ({ browser }) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await drawFourFrames(page);

  // Frame 0 keeps its own pixels; frame 1 has both the copy and its new pixel.
  await selectFrame(page, 0);
  expect((await canvasPixel(page, 2, 2)).rgba[3]).toBe(255);
  expect((await canvasPixel(page, 6, 6)).rgba[3]).toBe(0);
  await selectFrame(page, 1);
  expect((await canvasPixel(page, 6, 6)).rgba[3]).toBe(255);
  expect((await canvasPixel(page, 2, 2)).rgba[3]).toBe(255);
  await selectFrame(page, 3);
  expect((await canvasPixel(page, 10, 10)).rgba[3]).toBe(255);

  // 12 FPS: the whole four-frame loop is visible within a second.
  await page.locator(".px-fps select").selectOption("12");
  await selectFrame(page, 0);
  await page.locator(".px-play").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-playing", "true");
  const seen = new Set<string>();
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline && seen.size < 4) {
    seen.add(String(await canvasFrame(page)));
    await page.waitForTimeout(25);
  }
  expect([...seen].sort()).toEqual(["0", "1", "2", "3"]);
  await page.locator(".px-play").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-playing", "false");

  // 1 FPS: one frame per second, measured between two observed frame changes.
  await page.locator(".px-fps select").selectOption("1");
  await selectFrame(page, 0);
  await page.locator(".px-play").click();
  await expect
    .poll(() => canvasFrame(page), { timeout: 3000, intervals: [50] })
    .toBe("1");
  const firstChange = Date.now();
  await expect
    .poll(() => canvasFrame(page), { timeout: 3000, intervals: [50] })
    .toBe("2");
  const gap = Date.now() - firstChange;
  expect(gap).toBeGreaterThanOrEqual(700);
  expect(gap).toBeLessThan(1600);
  await page.locator(".px-stop").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-playing", "false");
  expect(await canvasFrame(page)).toBe("0");
  expect(errors).toEqual([]);
});

test("stops at the last frame when loop is off and stops on hide", async ({ browser }) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  await drawFourFrames(page);
  await page.locator(".px-fps select").selectOption("12");
  await expect(page.locator(".px-loop")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".px-loop").click();
  await expect(page.locator(".px-loop")).toHaveAttribute("aria-pressed", "false");
  await selectFrame(page, 0);
  await page.locator(".px-play").click();
  await expect
    .poll(() => page.locator(".px-anim").getAttribute("data-playing"), { timeout: 3000 })
    .toBe("false");
  expect(await canvasFrame(page)).toBe("3");
  // The preview also stops when the tab is hidden and never outlives the dialog.
  await page.locator(".px-play").click();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".px-anim")).toHaveAttribute("data-playing", "false");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Keep the last-frame window long enough that a busy WebKit runner cannot
  // auto-stop a non-looping preview before its play state is observed.
  await page.locator(".px-fps select").selectOption("1");
  await page.locator(".px-play").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-playing", "true");
  await page.locator(".px-close").click();
  await page.locator(".px-confirm-ok").click();
  await expect(page.locator("dialog.px")).toHaveCount(0);
  // A closed editor cannot leave a preview timer behind.
  await page.waitForTimeout(300);
  expect(await page.locator(".px-anim").count()).toBe(0);
});

test("moves, duplicates and deletes frames with undo and redo intact", async ({ browser }) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  await drawFourFrames(page);
  const has = async (index: number, x: number, y: number) => {
    await selectFrame(page, index);
    return (await canvasPixel(page, x, y)).rgba[3] === 255;
  };
  // Frames: 0 = (2,2), 1 = copy + (6,6), 2 = (10,10), 3 = copy + (12,12).
  // Reorder frame 0 to the right: the marked pixels travel with their frame.
  await selectFrame(page, 0);
  await page.locator(".px-move-right").click();
  await expect(page.locator('.px-anim-thumb[data-frame-index="1"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await has(0, 6, 6)).toBe(true);
  expect(await has(1, 2, 2)).toBe(true);
  expect(await has(1, 6, 6)).toBe(false);
  // One undo restores the whole order, not half a move.
  await page.locator(".px-undo").click();
  await expect.poll(() => canvasFrame(page)).toBe("0");
  expect(await has(0, 2, 2)).toBe(true);
  expect(await has(1, 6, 6)).toBe(true);
  await page.locator(".px-redo").click();
  expect(await has(0, 6, 6)).toBe(true);

  // Delete the marked frame, then undo brings its exact pixels back.
  await selectFrame(page, 1);
  await page.locator(".px-delete-frame").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "3");
  await page.locator(".px-undo").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  expect(await has(1, 2, 2)).toBe(true);
  await page.locator(".px-redo").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "3");

  // Painting is undoable per stroke on the selected frame only.
  await selectFrame(page, 0);
  await page.locator('.px-swatch[data-slot="9"]').click();
  await drawCell(page, 12, 4);
  expect(await has(0, 12, 4)).toBe(true);
  await page.locator(".px-undo").click();
  expect(await has(0, 12, 4)).toBe(false);
  // No other frame was touched by that stroke.
  for (let index = 0; index < 3; index++) expect(await has(index, 12, 4)).toBe(false);
});

test("drags frames to reorder them with a pointer", async ({ browser }) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  await drawFourFrames(page);
  await selectFrame(page, 3);
  const source = (await page
    .locator('.px-anim-thumb[data-frame-index="3"]')
    .boundingBox())!;
  const target = (await page
    .locator('.px-anim-thumb[data-frame-index="0"]')
    .boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      await selectFrame(page, 0);
      return (await canvasPixel(page, 10, 10)).rgba[3];
    })
    .toBe(255);
  await expect(page.locator(".px-anim-thumb")).toHaveCount(4);
});

test("onion skin shows neighbours in the preview only", async ({ browser }) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  await drawFourFrames(page);
  await page.locator('.px-swatch[data-slot="14"]').click();
  // Put a unique pixel on frame 0 and keep frame 1 empty at that spot.
  await selectFrame(page, 0);
  await drawCell(page, 1, 12);
  await selectFrame(page, 1);
  expect((await canvasPixel(page, 1, 12)).rgba[3]).toBe(0);
  // Default: onion skin off.
  await expect(page.locator(".px-onion")).toHaveAttribute("aria-pressed", "false");
  await page.locator(".px-onion").click();
  await expect(page.locator(".px-onion")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".px-onion-prev")).toHaveAttribute("aria-pressed", "true");
  const ghost = await canvasPixel(page, 1, 12);
  expect(ghost.rgba[3]).toBeGreaterThan(20);
  expect(ghost.rgba[3]).toBeLessThan(160);
  // Warm tint marks the previous frame, never a saved colour.
  expect(ghost.rgba[0]).toBeGreaterThan(ghost.rgba[2]);
  // Turning the side off removes just that ghost.
  await page.locator(".px-onion-prev").click();
  await expect(page.locator(".px-onion-prev")).toHaveAttribute("aria-pressed", "false");
  expect((await canvasPixel(page, 1, 12)).rgba[3]).toBe(0);
  await page.locator(".px-onion-prev").click();
  // Disabling the overlay clears it completely and playback hides it.
  await page.locator(".px-onion").click();
  await expect(page.locator(".px-onion")).toHaveAttribute("aria-pressed", "false");
  expect((await canvasPixel(page, 1, 12)).rgba[3]).toBe(0);
  await page.locator(".px-onion").click();
  await page.locator(".px-play").click();
  await page.waitForTimeout(200);
  await page.locator(".px-play").click();
  // The frame's own pixels were never painted with the ghost.
  await selectFrame(page, 0);
  expect((await canvasPixel(page, 1, 12)).rgba[3]).toBe(255);
});

test("keeps the static single-frame editor and saves it unchanged", async ({ browser }) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  await openNewSprite(page);
  // No timeline, no frame controls: the comfortable Stage A layout.
  await expect(page.locator(".px-anim")).toHaveCount(0);
  await expect(page.locator(".px-add-frame")).toHaveCount(0);
  await expect(page.locator(".px-animate")).toHaveCount(1);
  await page.locator('.px-swatch[data-slot="14"]').click();
  await drawCell(page, 0, 0);
  await drawCell(page, 1, 0);
  await drawCell(page, 0, 1);
  await page.locator(".px-name input").fill("Static cat");
  await page.locator(".px-save").click();
  await expect(page.locator("dialog.px")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /My assets/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "@static-cat",
  );
  await expect(page.locator(".inv-snippet")).toHaveText(
    'SPRITE = SPAWN("@static-cat",80,120)',
  );
});

test("supports keyboard frame selection, reorder, playback and deletion", async ({
  browser,
}) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  await drawFourFrames(page);
  const selected = () =>
    page.locator('.px-anim-thumb[aria-selected="true"]').getAttribute("data-frame-index");
  // Roving tabindex: one tab stop inside the frame list.
  await expect(page.locator('.px-anim-thumb[tabindex="0"]')).toHaveCount(1);
  await page.locator('.px-anim-thumb[data-frame-index="3"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await selected())).toBe("2");
  await expect(page.locator('.px-anim-thumb[data-frame-index="2"]')).toBeFocused();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await selected())).toBe("0");
  await page.keyboard.press("End");
  await expect.poll(async () => (await selected())).toBe("3");
  await page.keyboard.press(".");
  await expect.poll(async () => (await selected())).toBe("3");
  await page.keyboard.press(",");
  await expect.poll(async () => (await selected())).toBe("2");
  // Alt + arrow reorders the selected frame.
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(async () => (await selected())).toBe("3");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect.poll(async () => (await selected())).toBe("2");
  // N / Shift+N / Delete and P / Shift+P / O / L keep working from the timeline.
  await page.keyboard.press("n");
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "5");
  await page.keyboard.press("Delete");
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  await page.keyboard.press("Shift+N");
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "5");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "5");
  await page.keyboard.press("p");
  await expect(page.locator(".px-anim")).toHaveAttribute("data-playing", "true");
  await page.keyboard.press("Shift+P");
  await expect(page.locator(".px-anim")).toHaveAttribute("data-playing", "false");
  await page.keyboard.press("o");
  await expect(page.locator(".px-onion")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("l");
  await expect(page.locator(".px-loop")).toHaveAttribute("aria-pressed", "false");
  // An empty frame can be deleted but never below one frame.
  await page.locator(".px-delete-frame").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  // Tool shortcuts still work while the timeline has focus.
  await page.locator('.px-anim-thumb[data-frame-index="0"]').focus();
  await page.keyboard.press("e");
  await expect(page.locator('.px-tool[data-tool="eraser"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The editor help documents the animation shortcuts.
  await page.locator(".px-help summary").click();
  await expect(page.locator(".px-help")).toContainText("Shift + N");
});

test("fits 1440x900, 1024x768, 820x874 and 390x844 without overflow", async ({
  browser,
}) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  await drawFourFrames(page);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 820, height: 874 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      `horizontal overflow at ${size.width}x${size.height}`,
    ).toBe(true);
    await expect(page.locator(".px-anim")).toBeVisible();
    await expect(page.locator(".px-anim-thumb")).toHaveCount(4);
    const canvas = (await page.locator(".px-canvas").boundingBox())!;
    expect(canvas.width, `canvas width at ${size.width}`).toBeGreaterThan(80);
    expect(canvas.height, `canvas height at ${size.width}`).toBeGreaterThan(80);
    for (const selector of [".px-play", ".px-add-frame", ".px-delete-frame"]) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x + box.width, `${selector} fits at ${size.width}`).toBeLessThanOrEqual(
        size.width + 1,
      );
    }
  }
});

test("selects and reorders frames with touch input", async ({ browser }) => {
  const shared = await demoPage(browser);
  // Reuse the same demo session in a touch context instead of a second login.
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies(await session!.context.cookies());
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await page.locator(".cm-content").waitFor();
  expect(shared).toBeTruthy();
  await openNewSprite(page);
  await page.locator(".px-animate").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "2");
  const box = (await page.locator('.px-anim-thumb[data-frame-index="0"]').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.px-anim-thumb[data-frame-index="0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // The explicit Move controls are the touch/keyboard alternative to dragging.
  await page.locator(".px-move-right").click();
  await expect(page.locator('.px-anim-thumb[data-frame-index="1"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".px-anim-thumb")).toHaveCount(2);
  await context.close();
});

test("resizes every frame safely and restores the old size with undo", async ({
  browser,
}) => {
  const page = await demoPage(browser);
  await resetEditor(page);
  await drawFourFrames(page);
  // A resize keeps the drawings centred in every frame, not only the selected one.
  await page.locator('.px-size[data-size="32"]').click();
  await expect(page.locator(".px-confirm")).toBeVisible();
  await page.locator(".px-confirm-ok").click();
  await expect(page.locator(".px-canvas")).toHaveAttribute(
    "data-sprite-width",
    "32",
  );
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  await selectFrame(page, 0);
  expect((await canvasPixel(page, 10, 10)).rgba[3]).toBe(255);
  await selectFrame(page, 3);
  expect((await canvasPixel(page, 20, 20)).rgba[3]).toBe(255);
  // One undo restores the previous size and the exact pixels.
  await page.locator(".px-undo").click();
  await expect(page.locator(".px-canvas")).toHaveAttribute(
    "data-sprite-width",
    "16",
  );
  await selectFrame(page, 3);
  expect((await canvasPixel(page, 12, 12)).rgba[3]).toBe(255);
  expect((await canvasPixel(page, 20, 20)).rgba[3]).toBe(0);
});

test("draws, versions, exports and anonymously runs the saved animation", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await demoPage(browser);
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(20_000);
  await resetEditor(page);
  await page.getByRole("button", { name: "Sandbox", exact: true }).click();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await drawFourFrames(page);
  await page.locator(".px-fps select").selectOption("2");
  await expect(page.locator(".px-loop")).toHaveAttribute("aria-pressed", "true");
  // Move the first drawing after the second: saved frame order must follow the timeline.
  await selectFrame(page, 0);
  await page.locator(".px-move-right").click();
  await expect.poll(() => canvasFrame(page)).toBe("1");
  await page.locator(".px-name input").fill("Walk cycle");
  await page.screenshot({ path: "docs/qa-121/animation-editor.png" });
  await page.locator(".px-save").click();
  await expect(page.locator("dialog.px")).toHaveCount(0);
  await expect(page.locator("[data-inspector]")).toHaveAttribute(
    "data-selected",
    "@walk-cycle",
  );
  await expect(page.locator(".inv-title h3")).toHaveText("Walk cycle");

  const savedAsset = await page.evaluate(async () => {
    const response = await fetch("/api/v1/demo/assets");
    const body = await response.json();
    const summary = body.assets.find((asset: { alias: string }) => asset.alias === "@walk-cycle");
    if (!summary) throw new Error("saved asset summary missing");
    const detail = await fetch(`/api/v1/demo/assets/${summary.id}`);
    return detail.json();
  });
  const saved = savedAsset.sprite;
  expect(saved).toMatchObject({
    format: "randusr.animated-sprite",
    version: 1,
    width: 16,
    height: 16,
    fps: 2,
    loop: true,
    transparentIndex: 0,
  });
  expect(saved.frames).toHaveLength(4);
  expect(saved.frames[0]).toHaveLength(256);
  const yellow = saved.palette.indexOf(14);
  expect(yellow).toBeGreaterThan(0);
  // First row is the former frame 1; transparency and the moved frame are retained.
  expect(saved.frames[0][6 * 16 + 6]).toBe(yellow);
  expect(saved.frames[1][6 * 16 + 6]).toBe(0);
  expect(saved.frames[2][10 * 16 + 10]).toBe(yellow);
  expect(saved.frames[3][12 * 16 + 12]).toBe(yellow);
  expect(saved.frames[0][15 * 16 + 15]).toBe(0);

  // Reopen the library asset and verify every saved frame and playback setting.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  await expect(page.locator('.px-fps select')).toHaveValue("2");
  await expect(page.locator(".px-loop")).toHaveAttribute("aria-pressed", "true");
  await selectFrame(page, 0);
  expect((await canvasPixel(page, 6, 6)).rgba[3]).toBe(255);
  await selectFrame(page, 1);
  expect((await canvasPixel(page, 6, 6)).rgba[3]).toBe(0);
  await selectFrame(page, 2);
  expect((await canvasPixel(page, 10, 10)).rgba[3]).toBe(255);
  await selectFrame(page, 3);
  expect((await canvasPixel(page, 12, 12)).rgba[3]).toBe(255);
  await page.locator(".px-close").click();
  await expect(page.locator("dialog.px")).toHaveCount(0);
  await page.getByRole("button", { name: "Insert in CODE", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText('CLS\nHERO = SPAWN("@walk-cycle",40,80)');
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.locator(".code-panel .status")).toHaveText("Finished.");
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");

  const worldPixel = (target: Page, x: number, y: number) =>
    target.locator("canvas").first().evaluate((element, point) => {
      const [red, green, blue] = (element as HTMLCanvasElement)
        .getContext("2d")!
        .getImageData(point[0], point[1], 1, 1).data;
      return `${red},${green},${blue}`;
    }, [x, y]);
  // The reordered first frame has the (6,6) pixel at world (38,78); it then
  // disappears and the last frame's (12,12) marker appears at (44,84).
  const pixelWait = { timeout: 3000, intervals: [25, 50, 100] };
  await expect.poll(() => worldPixel(page, 38, 78), pixelWait).toBe("255,255,0");
  await expect.poll(() => worldPixel(page, 38, 78), pixelWait).toBe("0,0,0");
  await expect.poll(() => worldPixel(page, 44, 84), pixelWait).toBe("255,255,0");

  // Cloud reload must retain the project binding, source and all animation data.
  const cloudBeforeReload = await page.evaluate(async () => {
    const link = JSON.parse(localStorage.getItem("randomize-usr.cloud-link.v1")!);
    const remote = await fetch(`/api/v1/demo/projects/${link.id}`).then((r) => r.json());
    return { link, remoteVersion: remote.version };
  });
  expect(cloudBeforeReload.remoteVersion).toBe(cloudBeforeReload.link.version);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".cm-content")).toContainText('SPAWN("@walk-cycle",40,80)');
  const cloudAfterReload = await page.evaluate(async () => {
    const link = JSON.parse(localStorage.getItem("randomize-usr.cloud-link.v1")!);
    const remote = await fetch(`/api/v1/demo/projects/${link.id}`).then((r) => r.json());
    return { link, remoteVersion: remote.version };
  });
  expect(cloudAfterReload.remoteVersion).toBe(cloudAfterReload.link.version);
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const projectAnimation = await page.evaluate(() => {
    const raw = localStorage.getItem("randomize-usr.project.v1");
    const bindings = raw ? JSON.parse(raw).assetManifest?.sprites ?? [] : [];
    return (
      bindings.find((binding: { alias: string }) => binding.alias === "@walk-cycle")?.sprite ??
      null
    );
  });
  expect(projectAnimation).toBeTruthy();
  expect(projectAnimation.frames).toEqual(saved.frames);
  expect(projectAnimation.fps).toBe(2);
  expect(projectAnimation.loop).toBe(true);
  await page.getByRole("button", { name: "INVENTORY", exact: true }).click();
  await page.getByRole("button", { name: /My assets/ }).click();
  await page.getByRole("option", { name: /Walk cycle/ }).click();
  await expect(page.locator(".inv-title h3")).toHaveText("Walk cycle");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  await expect(page.locator('.px-fps select')).toHaveValue("2");
  await page.locator(".px-close").click();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // The portable package carries frame pixels and settings, but no private IDs.
  const downloadWait = page.waitForEvent("download");
  await openMore(page);
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const download = await downloadWait;
  const raw = await readFile((await download.path())!, "utf8");
  const portable = JSON.parse(raw);
  const portableAnimation = portable.assetManifest.sprites.find(
    (binding: { alias: string }) => binding.alias === "@walk-cycle",
  ).sprite;
  expect(portableAnimation.frames).toEqual(saved.frames);
  expect(portableAnimation).toMatchObject({ fps: 2, loop: true, transparentIndex: 0 });
  expect(raw).not.toMatch(/"(?:assetId|versionId)"/);

  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guest = await guestContext.newPage();
  guest.on("dialog", (dialog) => void dialog.accept());
  try {
    await guest.goto(origin + "/create", { waitUntil: "networkidle" });
    await guest.locator("input[type=file]").setInputFiles({
      name: "walk-cycle.randusr",
      mimeType: "application/json",
      buffer: Buffer.from(raw, "utf8"),
    });
    await expect(guest.locator(".cm-content")).toContainText('SPAWN("@walk-cycle",40,80)');
    await guest.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect.poll(() => worldPixel(guest, 38, 78), pixelWait).toBe("255,255,0");
    await expect.poll(() => worldPixel(guest, 38, 78), pixelWait).toBe("0,0,0");
    await guest.screenshot({ path: "docs/qa-121/animation-guest-run.png" });
  } finally {
    await guestContext.close();
  }

  // Publish the cloud snapshot and check the real anonymous viewer.
  await openMore(page);
  await page.getByRole("button", { name: "Share", exact: true }).first().click();
  const share = page.locator("dialog[open]");
  await share.locator("input[name=visibility][value=public]").check({ force: true });
  await openShareDetails(share);
  await share.locator("input[name=title]").fill("Animated sprite game");
  await share.locator("form button").click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  const code = (await share.locator('a[href^="/p/"]').getAttribute("href"))!.replace("/p/", "");
  await share.getByRole("button", { name: "Close", exact: true }).first().click();
  const anonymousContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anonymous = await anonymousContext.newPage();
  try {
    await anonymous.goto(`${origin}/p/${code}`, { waitUntil: "networkidle" });
    await expect(anonymous.getByRole("heading", { name: "Animated sprite game" })).toBeVisible();
    await expect(anonymous.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    const privateLibrary = await anonymous.request.get("/api/v1/demo/assets");
    expect(privateLibrary.status()).toBe(401);
    await anonymous.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect.poll(() => worldPixel(anonymous, 38, 78), pixelWait).toBe("255,255,0");
    await expect.poll(() => worldPixel(anonymous, 38, 78), pixelWait).toBe("0,0,0");
    await anonymous.screenshot({ path: "docs/qa-121/animation-published.png" });

    // Edit the private source asset into a new version; the published snapshot stays pinned.
    await page.goto(origin + "/create", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "INVENTORY", exact: true }).click();
    await page.getByRole("button", { name: /My assets/ }).click();
    await page.getByRole("option", { name: /Walk cycle/ }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await selectFrame(page, 0);
    await page.locator('.px-swatch[data-slot="4"]').click();
    await drawCell(page, 15, 15);
    await page.locator(".px-save").click();
    await expect(page.locator("dialog.px")).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText('CLS\nHERO = SPAWN("@walk-cycle",40,80)');
    await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect.poll(() => worldPixel(page, 47, 87)).toBe("0,191,0");
    await anonymous.reload({ waitUntil: "networkidle" });
    await anonymous.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect.poll(() => worldPixel(anonymous, 47, 87)).toBe("0,0,0");
    await expect.poll(() => worldPixel(anonymous, 38, 78)).toBe("255,255,0");
  } finally {
    await anonymousContext.close();
  }
  expect(errors).toEqual([]);
});
