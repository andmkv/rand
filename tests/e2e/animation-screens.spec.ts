import { expect, test, type Browser, type Page } from "@playwright/test";

// Card 120 screenshot evidence: the animation timeline in EN/RU/DE/JA at every
// review size. Screenshots only, so it runs on request:
//   ANIM_SCREENS=1 HOSTED_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:5183 \
//     npx playwright test animation-screens --project=chromium
test.skip(
  process.env.ANIM_SCREENS !== "1" || process.env.HOSTED_E2E !== "1",
  "Screenshot run only; needs the disposable server/tests/serve.ts API",
);
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const out = process.env.ANIM_SCREENS_DIR ?? "docs/qa-120";
const locales = (process.env.ANIM_LOCALES ?? "en,ru,de,ja").split(",");
const sizes = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "820x874", width: 820, height: 874 },
  { name: "390x844", width: 390, height: 844 },
];

let session: { page: Page } | null = null;

async function demoPage(browser: Browser): Promise<Page> {
  if (session) return session.page;
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
  session = { page };
  return page;
}

async function setLocale(page: Page, locale: string) {
  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await page.locator(".cm-content").waitFor();
  await page.locator('button[aria-controls="more-panel"]').click();
  await page.locator("#more-panel select.language-picker").selectOption(locale);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function drawCell(page: Page, x: number, y: number) {
  const box = (await page.locator(".px-canvas").boundingBox())!;
  const width = Number(
    await page.locator(".px-canvas").getAttribute("data-sprite-width"),
  );
  const size = box.width / width;
  await page.mouse.move(box.x + (x + 0.5) * size, box.y + (y + 0.5) * size);
  await page.mouse.down();
  await page.mouse.up();
}

/** Four-frame walk from the built-in cat: duplicate, then move one leg per frame. */
async function drawWalk(page: Page) {
  await page.locator(".inventory-handle").click();
  await page.locator(".inv-new").click();
  await expect(page.locator("dialog.px")).toBeVisible();
  await page.locator('.px-template[data-template="cat"]').click();
  await page.locator('.px-swatch[data-slot="14"]').click();
  await page.locator(".px-animate").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "2");
  // The 8x8 cat sits at (4,4)..(11,11); rows 12 are free for a stepping leg.
  await drawCell(page, 4, 12);
  await page.locator(".px-duplicate-frame").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "3");
  await page.locator('.px-tool[data-tool="eraser"]').click();
  await drawCell(page, 4, 12);
  await page.locator('.px-tool[data-tool="pencil"]').click();
  await drawCell(page, 8, 12);
  await page.locator(".px-duplicate-frame").click();
  await expect(page.locator(".px-anim")).toHaveAttribute("data-frames", "4");
  await page.locator('.px-tool[data-tool="eraser"]').click();
  await drawCell(page, 8, 12);
  await page.locator('.px-tool[data-tool="pencil"]').click();
  await page.locator(".px-fps select").selectOption("4");
  await page.locator(".px-onion").click();
  await page.locator('.px-anim-thumb[data-frame-index="1"]').click();
}

test("animation timeline screenshots", async ({ browser }) => {
  const page = await demoPage(browser);
  for (const locale of locales) {
    await setLocale(page, locale);
    await drawWalk(page);
    const shots: string[] = [];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `${locale} ${size.name} horizontal overflow`,
      ).toBe(true);
      const file = `${out}/anim-${locale}-${size.name}.png`;
      await page.screenshot({ path: file });
      shots.push(file);
    }
    console.log(`${locale}: ${shots.join(", ")}`);
    // Reset for the next locale.
    await page.setViewportSize(sizes[0]);
    await page.locator(".px-close").click();
    await page.locator(".px-confirm-ok").click();
    await expect(page.locator("dialog.px")).toHaveCount(0);
  }
});
