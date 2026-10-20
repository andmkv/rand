import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  installFakeSoundAdapter,
  setFakeMode,
  soundCalls,
  type FakeMode,
} from "./sound-lab-fake";

declare global {
  interface Window {
    __nativeAudioStats?: { contexts: number; created: number; disconnected: number };
  }
}

// Sound Lab UI (card #124). Hosted harness: Inventory → New sound needs a registered/demo session.
// The engine is replaced by a recording fake; nothing here proves audible sound.
const hosted = process.env.HOSTED_E2E === "1";
test.skip(!hosted, "Requires the disposable server/tests/serve.ts API");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1024, height: 768 } });
const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// Demo creation is rate limited per IP, so every test reuses one demo session and reloads.
let shared: Page | null = null;
test.afterAll(async () => {
  await shared?.context().close();
});
async function openDemo(browser: Browser, mode: FakeMode = "ok"): Promise<Page> {
  if (!shared) {
    const page = await (await browser.newContext()).newPage();
    await installFakeSoundAdapter(page);
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(origin + "/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByRole("button", { name: "Try Demo" }).click();
    await page.waitForURL("**/create");
    await expect(page.locator(".demo-badge")).toBeVisible();
    shared = page;
  }
  await shared.setViewportSize({ width: 1024, height: 768 });
  await setFakeMode(shared, mode);
  await expect(shared.locator(".demo-badge")).toBeVisible();
  return shared;
}
async function openLab(page: Page) {
  const create = page.getByRole("button", { name: /New sound/ });
  if (!(await create.isVisible()))
    await page.getByRole("button", { name: "INVENTORY", exact: true }).click();
  await create.click();
  await expect(page.locator("dialog.sl")).toBeVisible();
}
const noOverflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <= innerWidth &&
      [...document.querySelectorAll("dialog.sl *")].every((el) => {
        const r = el.getBoundingClientRect();
        return r.width === 0 || (r.left >= -1 && r.right <= innerWidth + 1);
      }),
  );
const setRange = (page: Page, id: string, value: number) =>
  page.locator(`#sl-${id}`).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

test("laser flow: preset, edit, preview, stop, undo/redo, save, insert, run", async ({
  browser,
}) => {
  const page = await openDemo(browser);
  await openLab(page);
  await expect(page.locator(".sl-engine")).toHaveCount(0);
  await page.locator('[data-preset="laser"]').click();
  await expect(page.locator('[data-preset="laser"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('[data-wave="saw"]').click();
  await page.locator('[data-direction="rising"]').click();
  await expect(page.locator('[data-direction="rising"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Moving a slider never makes a sound by itself.
  await setRange(page, "duration", 0.8);
  expect((await soundCalls(page)).filter((c) => c.type === "preview")).toHaveLength(0);
  await page.locator(".sl-preview").click();
  await expect(page.locator(".sl-preview")).toHaveAttribute("aria-pressed", "true");
  const calls = await soundCalls(page);
  const played = calls.find((c) => c.type === "preview") as unknown as {
    draft: { waveform: string; pitchEnd: number; pitchStart: number; duration: number };
  };
  expect(played.draft.waveform).toBe("saw");
  expect(played.draft.pitchEnd).toBeGreaterThan(played.draft.pitchStart);
  expect(played.draft.duration).toBe(0.8);
  await page.locator(".sl-preview").click(); // Stop
  await expect(page.locator(".sl-preview")).toHaveAttribute("aria-pressed", "false");
  // Undo/redo walks back through the edits.
  await page.locator(".sl-undo").click();
  await expect(page.locator("#sl-duration")).not.toHaveValue("0.8");
  await page.locator(".sl-redo").click();
  await expect(page.locator("#sl-duration")).toHaveValue("0.8");
  // Choosing a preset suggests its name; saving still needs one.
  await expect(page.locator(".sl-name input")).toHaveValue("Laser");
  await page.locator(".sl-name input").fill("");
  await page.locator(".sl-save").click();
  await expect(page.locator(".sl-status")).toContainText("Give the sound a name");
  await page.locator(".sl-name input").fill("My laser");
  await page.locator(".sl-save").click();
  await expect(page.locator(".sl-saved code")).toHaveText('SOUND "@my-laser"');
  await expect(page.locator(".sl-status")).toHaveText("Saved");
  // Found in My assets, then inserted at the CODE caret and run.
  await page.locator(".sl-close").click();
  await expect(page.locator("dialog.sl")).toHaveCount(0);
  await page.getByRole("button", { name: /My assets/ }).click();
  await page.getByRole("option", { name: /My laser/ }).click();
  const inventoryPreview = page.locator(".inv-actions button").nth(1);
  await inventoryPreview.click();
  await expect(inventoryPreview).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await soundCalls(page)).filter((c) => c.type === "preview").length).toBeGreaterThan(1);
  await inventoryPreview.click();
  await page.getByRole("button", { name: "Insert in CODE" }).click();
  await expect(page.locator(".cm-content")).toContainText('SOUND "@my-laser"');
});

test("a saved sound reopens from My assets and saves a new version", async ({ browser }) => {
  const page = await openDemo(browser);
  await openLab(page);
  await page.locator('[data-preset="jump"]').click();
  await page.locator(".sl-name input").fill("Hop");
  await page.locator(".sl-save").click();
  await expect(page.locator(".sl-status")).toHaveText("Saved");
  await page.locator(".sl-close").click();
  await page.getByRole("button", { name: /My assets/ }).click();
  await page.getByRole("option", { name: /Hop/ }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator("dialog.sl")).toBeVisible();
  await expect(page.locator(".sl-name input")).toHaveValue("Hop");
  await expect(page.locator('[data-preset="jump"]')).toHaveAttribute("aria-pressed", "true");
  // The kind of a saved sound cannot be switched.
  await expect(page.locator(".sl-kind").nth(1)).toBeDisabled();
  await setRange(page, "volume", 0.3);
  await expect(page.locator(".sl-status")).toHaveText("Unsaved changes");
  await page.locator(".sl-save").click();
  await expect(page.locator(".sl-status")).toHaveText("Saved");
  const saves = (await soundCalls(page)).filter((c) => c.type === "save") as unknown as {
    input: { existing?: { baseVersion: number } };
  }[];
  expect(saves[saves.length - 1].input.existing?.baseVersion).toBe(1);
  // Save copy always creates a new sound and keeps the original name untouched in the library.
  await page.locator(".sl-save-copy").click();
  await expect(page.locator(".sl-name input")).toHaveValue("Hop copy");
});

test("unsaved work is protected and keyboard shortcuts work", async ({ browser }) => {
  const page = await openDemo(browser);
  await openLab(page);
  await page.locator(".sl-close").click();
  await expect(page.locator("dialog.sl")).toHaveCount(0); // untouched: closes at once
  await openLab(page);
  await page.locator('[data-preset="coin"]').click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".sl-preview")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".sl-preview")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[data-preset="laser"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator('[data-preset="coin"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  const alert = page.getByRole("alertdialog");
  await expect(alert).toBeVisible();
  await expect(page.locator(".sl-keep")).toBeFocused();
  await page.locator(".sl-keep").click();
  await expect(page.locator("dialog.sl")).toBeVisible();
  await page.locator(".sl-close").click();
  await page.locator(".sl-discard").click();
  await expect(page.locator("dialog.sl")).toHaveCount(0);
  // Focus returns to the control that opened the lab.
  await expect(page.getByRole("button", { name: /New sound/ })).toBeFocused();
});

test("instrument mode: note keys play the pressed note, kind is explained", async ({
  browser,
}) => {
  const page = await openDemo(browser);
  await openLab(page);
  await page.locator(".sl-kind").nth(1).click();
  await expect(page.locator(".sl-keys .sl-key")).toHaveCount(8);
  await expect(page.locator('[data-field="pitchEnd"]')).toHaveCount(0);
  await page.locator("body").press("a");
  await page.locator("body").press("h");
  const previews = (await soundCalls(page)).filter((c) => c.type === "preview") as unknown as {
    options: { noteHz: number };
    draft: { kind: string };
  }[];
  expect(previews).toHaveLength(2);
  expect(previews[0].draft.kind).toBe("instrument");
  expect(Math.round(previews[0].options.noteHz)).toBe(262); // C4
  expect(Math.round(previews[1].options.noteHz)).toBe(440); // A4
  await page.locator(".sl-name input").fill("Soft lead");
  await page.locator(".sl-save").click();
  await expect(page.locator(".sl-saved code")).toHaveText('NOTE "C4",0.5,"@soft-lead"');
});

test("integrated Preview unlocks native WebAudio and Stop disconnects the voice", async ({ browser }) => {
  const page = await openDemo(browser, "off");
  await page.addInitScript(() => {
    const stats = { contexts: 0, created: 0, disconnected: 0 };
    (window as unknown as { __nativeAudioStats: typeof stats }).__nativeAudioStats = stats;
    const NativeAudioContext = window.AudioContext;
    class TrackedAudioContext extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        stats.contexts++;
      }
      private track<T extends AudioNode>(node: T): T {
        stats.created++;
        const disconnect = node.disconnect.bind(node);
        node.disconnect = (() => {
          stats.disconnected++;
          disconnect();
        }) as typeof node.disconnect;
        return node;
      }
      override createOscillator() { return this.track(super.createOscillator()); }
      override createGain() { return this.track(super.createGain()); }
      override createBufferSource() { return this.track(super.createBufferSource()); }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: TrackedAudioContext });
  });
  await page.reload({ waitUntil: "networkidle" });
  await openLab(page);
  await page.locator('[data-preset="laser"]').click();
  await setRange(page, "duration", 3.5);
  await page.locator(".sl-preview").click();
  await expect.poll(() => page.evaluate(() => window.__nativeAudioStats?.contexts ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__nativeAudioStats?.created ?? 0)).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => [...document.querySelectorAll("dialog.sl")].length)).toBe(1);
  expect(await page.evaluate(() => window.__nativeAudioStats?.disconnected ?? 0)).toBe(0);

  await page.locator(".sl-preview").click();
  await expect(page.locator(".sl-preview")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.__nativeAudioStats?.disconnected ?? 0)).toBeGreaterThanOrEqual(2);
  const nodes = await page.evaluate(() => window.__nativeAudioStats ?? null);
  if (!nodes) throw new Error("native audio instrumentation was not installed");
  expect(nodes.created - nodes.disconnected).toBe(1); // only the shared output gain remains

  // The real Demo asset route saves the exact recipe; insert pins it into the project
  // snapshot, and BASIC's SOUND command uses that same native engine.
  await page.locator(".sl-name input").fill("Integrated laser");
  await page.locator(".sl-save").click();
  await expect(page.locator(".sl-status")).toHaveText("Saved");
  await page.locator(".sl-insert").click();
  await expect(page.locator("dialog.sl")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText('SOUND "@integrated-laser"');
  await page.locator(".runtime-controls button.primary").click();
  await expect.poll(() => page.evaluate(() => window.__nativeAudioStats?.created ?? 0)).toBeGreaterThan(3);
  await page.getByRole("button", { name: /STOP/ }).click();
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__nativeAudioStats ?? null);
    return current ? current.created - current.disconnected : -1;
  }).toBe(1);
});

test("advanced controls only offer what the engine supports, and mute reaches the adapter", async ({
  browser,
}) => {
  const page = await openDemo(browser);
  await openLab(page);
  await page.locator(".sl-advanced summary").click();
  // Square: pulse width + noise mix. Noise waveform: neither pulse width nor noise mix.
  await expect(page.locator("#sl-pulseWidth")).toBeVisible();
  await expect(page.locator("#sl-noiseAmount")).toBeVisible();
  await setRange(page, "pulseWidth", 0.25);
  await page.locator('[data-wave="triangle"]').click();
  await expect(page.locator("#sl-pulseWidth")).toHaveCount(0);
  await page.locator('[data-wave="noise"]').click();
  await expect(page.locator("#sl-noiseAmount")).toHaveCount(0);
  await page.locator('[data-wave="square"]').click();
  await page.locator(".sl-preview").click();
  const played = (await soundCalls(page)).find((c) => c.type === "preview") as unknown as {
    draft: { pulseWidth: number };
  };
  expect(played.draft.pulseWidth).toBe(0.25);
  await page.locator(".sl-mute").click();
  await expect(page.locator(".sl-mute")).toHaveAttribute("aria-pressed", "true");
  expect((await soundCalls(page)).some((c) => c.type === "mute" && c.muted === true)).toBe(true);
  // Instrument: fine tune appears, the sound-effect glide does not.
  await page.locator(".sl-kind").nth(1).click();
  await expect(page.locator("#sl-tuning")).toBeVisible();
  await expect(page.locator("#sl-pitchStart")).toHaveCount(0);
});

test("blocked audio is reported honestly and the shared engine is connected", async ({ browser }) => {
  const blocked = await openDemo(browser, "blocked");
  await openLab(blocked);
  await blocked.locator(".sl-preview").click();
  await expect(blocked.getByRole("alert")).toContainText("blocked audio");
  await expect(blocked.locator(".sl-preview")).toHaveAttribute("aria-pressed", "false");
  const connected = await openDemo(browser, "off");
  await openLab(connected);
  await expect(connected.locator(".sl-engine")).toHaveCount(0);
  await expect(connected.locator(".sl-preview")).toBeEnabled();
  await expect(connected.locator(".sl-save")).toBeEnabled();
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 820, height: 874 },
  { width: 390, height: 844 },
]) {
  test(`fits ${size.width}x${size.height} without horizontal overflow`, async ({
    browser,
  }) => {
    const page = await openDemo(browser);
    await page.setViewportSize(size);
    await openLab(page);
    expect(await noOverflow(page)).toBe(true);
    await page.locator(".sl-kind").nth(1).click();
    expect(await noOverflow(page)).toBe(true);
    for (const id of ["Preview", "Save"]) {
      const box = await page
        .locator(id === "Preview" ? ".sl-preview" : ".sl-save")
        .boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    }
  });
}
