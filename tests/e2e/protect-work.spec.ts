import { test, expect, type Page } from "@playwright/test";
import { openMore } from "./more";
const key = "randomize-usr.project.v1";
const source = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).sourceCode, key);
async function edit(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
  await expect.poll(() => source(page)).toBe(code);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/create");
});
test("Tab and Shift+Tab indent a selection without deleting code", async ({
  page,
}) => {
  const code = 'INK 2\nTEXT 10,10,"HI"\nCIRCLE 20,20,5';
  await edit(page, code);
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => source(page))
    .toBe('  INK 2\n  TEXT 10,10,"HI"\n  CIRCLE 20,20,5');
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => source(page)).toBe(code);
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(() => source(page)).toBe(code);
});
test("chapter switching remembers the child's code per chapter", async ({
  page,
}) => {
  await page.evaluate((k) => {
    const now = new Date().toISOString();
    localStorage.setItem(
      k,
      JSON.stringify({
        format: "randusr",
        version: 2,
        title: "",
        sourceCode: "INK 1",
        mode: "story",
        createdAt: now,
        updatedAt: now,
        storyId: "tower",
        sceneId: 0,
        unlocked: 3,
        exampleId: null,
      }),
    );
  }, key);
  await page.reload();
  const code = 'INK 3\nTEXT 5,5,"MINE"';
  await edit(page, code);
  const nav = page.locator(".story nav button");
  await nav.nth(1).click();
  await expect.poll(() => source(page)).not.toBe(code);
  await nav.nth(0).click();
  await expect.poll(() => source(page)).toBe(code);
});
test("EXAMPLES Load asks before replacing modified code", async ({ page }) => {
  const code = 'INK 2\nTEXT 10,10,"MY WORK"';
  await edit(page, code);
  await page.getByRole("button", { name: "Sandbox", exact: true }).click();
  await page.getByRole("button", { name: "EXAMPLES" }).click();
  const dialogs: string[] = [];
  page.once("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Load", exact: true }).first().click();
  expect(dialogs).toHaveLength(1);
  expect(await source(page)).toBe(code);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Load", exact: true }).first().click();
  await expect.poll(() => source(page)).not.toBe(code);
});
test("Reset project keeps Sandbox mode; Save file confirms in the app", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Sandbox", exact: true }).click();
  await edit(page, "INK 1");
  page.once("dialog", (d) => void d.accept());
  await openMore(page);
  await page.getByRole("button", { name: "Reset project" }).click();
  await expect(
    page.getByRole("button", { name: "Sandbox", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await openMore(page);
  await page.getByRole("button", { name: "Save file" }).click();
  await expect(page.getByRole("status")).toContainText("Saved project.randusr");
});
test("invalid file import shows no line number", async ({ page }) => {
  page.once("dialog", (d) => void d.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "bad.randusr",
    mimeType: "application/json",
    buffer: Buffer.from("hello"),
  });
  const status = page.getByRole("status");
  await expect(status).toContainText("not a Randomize USR project");
  await expect(status).not.toContainText("Line 1");
});
