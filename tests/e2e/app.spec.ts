import { openMore } from "./more";
import { test, expect, type Page } from "@playwright/test";
async function edit(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("randomize-usr.project.v1")!)
            .sourceCode,
      ),
    )
    .toBe(code);
}
async function run(page: Page) {
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
}
async function finished(page: Page) {
  await expect(page.getByRole("status")).toContainText("Finished.", {
    timeout: 20000,
  });
}
test.beforeEach(async ({ page }) => {
  await page.goto("/create");
});
test("default magic, persistence, locale and tablet fit", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await run(page);
  await finished(page);
  expect(
    await page.locator("canvas").evaluate((c) => {
      const a = (c as HTMLCanvasElement)
        .getContext("2d")!
        .getImageData(0, 0, 256, 192).data;
      let colored = 0;
      for (let i = 0; i < a.length; i += 4)
        if (a[i] || a[i + 1] || a[i + 2]) colored++;
      return colored;
    }),
  ).toBeGreaterThan(300);
  await edit(page, 'INK 4\nTEXT 20,90,"I CHANGED IT"');
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("I CHANGED IT");
  await openMore(page);
  await page.getByLabel("Language").selectOption("ru");
  await expect(
    page.getByRole("button", { name: "▶ ЗАПУСК", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "▶ ЗАПУСК", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/${info.project.name}-workspace.png`,
    fullPage: true,
  });
});
test("full story from clean browser", async ({ page }) => {
  for (let i = 0; i < 9; i++) {
    await page
      .getByRole("button", { name: "Show example", exact: true })
      .click();
    await run(page);
    if (i === 8) {
      await expect(page.getByLabel("Your answer")).toBeVisible();
      await page.getByLabel("Your answer").fill("MIRA");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await finished(page);
    if (i < 8)
      await page
        .getByRole("button", { name: "Next chapter →", exact: true })
        .click();
  }
  await expect(
    page.getByText("The tower is awake. Make it your own!"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("The tower is awake. Make it your own!"),
  ).toBeVisible();
});
test("errors, cancellation, input and repeat runs", async ({ page }) => {
  await edit(page, "CIRLCE 10,20,30");
  await run(page);
  await expect(page.getByRole("status")).toContainText("Did you mean CIRCLE?");
  await edit(page, "FOR X=1 TO 999999999\nNEXT X");
  await run(page);
  await expect(page.getByRole("status")).toContainText("lot of magic", {
    timeout: 10000,
  });
  for (let i = 0; i < 3; i++) {
    await edit(page, "BEEP 440,10\nWAIT 20");
    await run(page);
    await page.getByRole("button", { name: "■ STOP", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Stopped");
    await edit(page, "INK 6\nCIRCLE 128,96,30");
    await run(page);
    await finished(page);
  }
  await edit(page, 'INPUT "Name?",N\nPRINT N');
  await run(page);
  await expect(page.getByLabel("Your answer")).toBeVisible();
  await page.getByRole("button", { name: "↺ RESET", exact: true }).click();
  await expect(page.getByLabel("Your answer")).toHaveCount(0);
  await edit(page, 'PRINT "OK"');
  await page.locator(".cm-content").press("ControlOrMeta+Enter");
  await finished(page);
  await expect(page.getByRole("log")).toContainText("OK");
});
test("spellbook search, insert, load and examples", async ({ page }) => {
  await page.getByRole("button", { name: "SPELLBOOK", exact: true }).click();
  await page.getByRole("searchbox").fill("random");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("RND");
  await run(page);
  await finished(page);
  await page.getByRole("button", { name: "EXAMPLES", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(15);
  await page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", { name: "MAGIC NAME", exact: true }),
    })
    .getByRole("button", { name: "Load & Run", exact: true })
    .click();
  await page.getByLabel("Your answer").fill("NOVA");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await finished(page);
});
