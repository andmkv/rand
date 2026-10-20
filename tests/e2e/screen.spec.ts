import { test, expect } from "@playwright/test";
const lit = async (page: import("@playwright/test").Page) =>
  page.locator("canvas").evaluate((c) => {
    const a = (c as HTMLCanvasElement)
      .getContext("2d")!
      .getImageData(0, 0, 256, 192).data;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] || a[i + 1] || a[i + 2]) n++;
    return n;
  });
test("original startup artifacts finish, reduced motion skips them", async ({
  page,
}) => {
  await page.goto("/create");
  await expect.poll(() => lit(page)).toBeGreaterThan(100);
  await expect.poll(() => lit(page), { timeout: 2500 }).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.locator("canvas").waitFor();
  await page.waitForTimeout(100);
  expect(await lit(page)).toBe(0);
});
test("heavy drawing builds over frames; a tiny program reacts promptly", async ({
  page,
}) => {
  await page.goto("/create");
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "INK 6\nFOR R=1 TO 80\nCIRCLE 128,96,R\nNEXT R",
  );
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("running");
  const start = await lit(page);
  await expect(page.getByRole("status")).toContainText("Finished.", {
    timeout: 5000,
  });
  expect(await lit(page)).toBeGreaterThan(start);
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText("INK 4\nPLOT 20,20");
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished.", {
    timeout: 1000,
  });
  await expect.poll(() => lit(page), { timeout: 1000 }).toBeLessThanOrEqual(1);
});

async function editScreen(
  page: import("@playwright/test").Page,
  source: string,
) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
}

test("STOP wipes the picture progressively and RESET plays a cancellable boot", async ({
  page,
}) => {
  await page.goto("/create");
  await editScreen(page, "PAPER 7\nCLS\nWAIT 20");
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => lit(page)).toBe(256 * 192);
  await page.getByRole("button", { name: "■ STOP", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Stopped");
  await expect
    .poll(async () => {
      const count = await lit(page);
      return count > 0 && count < 256 * 192;
    })
    .toBe(true);
  await expect.poll(() => lit(page), { timeout: 2000 }).toBe(0);
  await page.getByRole("button", { name: "↺ RESET", exact: true }).click();
  await expect.poll(() => lit(page)).toBeGreaterThan(100);
  await expect.poll(() => lit(page), { timeout: 2000 }).toBe(0);

  await editScreen(page, "INK 4\nPLOT 20,20");
  await page.getByRole("button", { name: "↺ RESET", exact: true }).click();
  await expect.poll(() => lit(page)).toBeGreaterThan(100);
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => lit(page)).toBe(1);
  await page.waitForTimeout(850);
  expect(await lit(page)).toBe(1);
});

test("RUN cancels a STOP wipe without an old frame resurfacing", async ({
  page,
}) => {
  await page.goto("/create");
  await editScreen(page, "PAPER 7\nCLS\nWAIT 20");
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => lit(page)).toBe(256 * 192);
  // Edit while the previous program waits, so RUN can follow STOP immediately.
  await editScreen(page, "INK 4\nPLOT 20,20");
  await page.getByRole("button", { name: "■ STOP", exact: true }).click();
  await expect
    .poll(async () => {
      const count = await lit(page);
      return count > 0 && count < 256 * 192;
    })
    .toBe(true);
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => lit(page)).toBe(1);
  await page.waitForTimeout(800);
  expect(await lit(page)).toBe(1);
});

test("reduced motion clears STOP and RESET immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/create");
  await editScreen(page, "PAPER 7\nCLS\nWAIT 20");
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect.poll(() => lit(page)).toBe(256 * 192);
  await page.getByRole("button", { name: "■ STOP", exact: true }).click();
  await expect.poll(() => lit(page), { timeout: 500 }).toBe(0);
  await page.getByRole("button", { name: "↺ RESET", exact: true }).click();
  await page.waitForTimeout(100);
  expect(await lit(page)).toBe(0);
});

test("SCREEN is drawn at an exact integer pixel scale in Story and Sandbox", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ])
    for (const mode of ["STORY", "Sandbox"]) {
      await page.setViewportSize(viewport);
      await page.goto("/create");
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      const box = await page.locator("canvas").evaluate((c) => {
        const r = c.getBoundingClientRect();
        return { w: r.width, h: r.height, dpr: devicePixelRatio };
      });
      const scale = box.w / 256;
      expect(Number.isInteger(scale * box.dpr), `${viewport.width} ${mode} scale ${scale}`).toBe(true);
      expect(box.h).toBeCloseTo(192 * scale, 3);
      expect(scale).toBeGreaterThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    }
});
