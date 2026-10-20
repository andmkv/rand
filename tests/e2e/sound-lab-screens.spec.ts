import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installFakeSoundAdapter } from "./sound-lab-fake";

// Card #124 screenshot evidence: Sound Lab in EN/RU/DE/JA at every review size. Screenshots only:
//   SOUND_SCREENS=1 HOSTED_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:5190 \
//     npx playwright test sound-lab-screens --project=chromium
test.skip(
  process.env.SOUND_SCREENS !== "1" || process.env.HOSTED_E2E !== "1",
  "Screenshot run only; needs the disposable server/tests/serve.ts API",
);
test.setTimeout(240_000);
const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const out = process.env.SOUND_SCREENS_DIR ?? "docs/qa-124";
const locales = (process.env.SOUND_LOCALES ?? "en,ru,de,ja").split(",");
const sizes = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "820x874", width: 820, height: 874 },
  { name: "390x844", width: 390, height: 844 },
];

async function open(page: Page) {
  await page.getByRole("button", { name: "INVENTORY", exact: true }).click().catch(() => undefined);
  await page.locator(".inv-new-sound").click();
  await expect(page.locator("dialog.sl")).toBeVisible();
}

test("sound lab screenshots", async ({ browser }) => {
  await mkdir(out, { recursive: true });
  const page = await (await browser.newContext()).newPage();
  await installFakeSoundAdapter(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: "Try Demo" }).click();
  await page.waitForURL("**/create");
  for (const locale of locales) {
    await page.evaluate((value) => localStorage.setItem("randomize-usr.locale", value), locale);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.goto(origin + "/create", { waitUntil: "networkidle" });
      await page.locator(".cm-content").waitFor();
      await page.locator(".inventory-handle").click();
      await page.locator(".inv-new-sound").click();
      await expect(page.locator("dialog.sl")).toBeVisible();
      await page.locator('[data-preset="laser"]').click();
      await page.locator('[data-direction="falling"]').click();
      await page.locator(".sl-preview").click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/sound-lab-${locale}-${size.name}.png` });
      if (locale === "en" || size.name === "390x844") {
        await page.locator(".sl-preview").click();
        await page.locator(".sl-kind").nth(1).click();
        await page.screenshot({ path: `${out}/sound-lab-instrument-${locale}-${size.name}.png` });
      }
    }
  }

  // Integration evidence: the saved personal SFX is visible in Inventory, and the Story panel
  // remains accessible in the same disposable Demo session.
  await page.evaluate(() => localStorage.setItem("randomize-usr.locale", "en"));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await page.locator(".inventory-handle").click();
  await page.locator(".inv-new-sound").click();
  await page.locator('[data-preset="laser"]').click();
  await page.locator(".sl-name input").fill("QA Laser");
  await page.locator(".sl-save").click();
  await expect(page.locator(".sl-status")).toHaveText("Saved");
  await page.locator(".sl-close").click();
  await page.getByRole("button", { name: /My assets/ }).click();
  const personalSound = page.locator('[data-source="mine"][data-asset="@qa-laser"]');
  await expect(personalSound).toBeVisible();
  await personalSound.click();
  await page.screenshot({ path: `${out}/inventory-sfx-en-1024x768.png` });

  await page.goto(origin + "/create?mode=story", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".story-panel")).toBeVisible();
  await page.screenshot({ path: `${out}/story-en-1024x768.png` });
  await page.context().close();
});
