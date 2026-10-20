import { openMore } from "./more";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("mode switching preserves code; .randusr download and reload/import restores project", async ({
  page,
}) => {
  await page.goto("/create");
  await page.getByRole("button", { name: "Sandbox", exact: true }).click();
  await expect(page.locator(".story-panel")).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText('TEXT 10,10,"Привет, Даня! Živjo"');
  await page.getByLabel("Project title").fill("Мой проект");
  await page.getByRole("button", { name: "STORY", exact: true }).click();
  await expect(page.locator(".story-panel")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Привет, Даня!");
  await page.getByRole("button", { name: "Sandbox", exact: true }).click();
  const waitDownload = page.waitForEvent("download");
  await openMore(page);
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const download = await waitDownload;
  expect(download.suggestedFilename().normalize("NFC")).toBe(
    "Мой проект.randusr",
  );
  const raw = await readFile((await download.path())!, "utf8");
  const saved = JSON.parse(raw);
  expect(saved.mode).toBe("sandbox");
  expect(saved.sourceCode).toBe('TEXT 10,10,"Привет, Даня! Živjo"');
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sandbox", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator("input[type=file]").setInputFiles({
    name: "project.randusr",
    mimeType: "application/json",
    buffer: Buffer.from(raw, "utf8"),
  });
  await expect(page.locator(".cm-content")).toContainText(
    "Привет, Даня! Živjo",
  );
  await expect(page.getByLabel("Project title")).toHaveValue("Мой проект");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.randusr",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.getByRole("status")).toContainText("newer Randomize");
  await expect(page.locator(".cm-content")).toContainText(
    "Привет, Даня! Živjo",
  );
});

test("opening a built-in example seeds editable project instructions", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/examples/alien-attack");
  await page
    .getByRole("button", { name: "Open in editor", exact: true })
    .click();
  await page.waitForURL("**/create");

  const instructions = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("randomize-usr.project.v1")!)
          .instructions,
    );
  await expect
    .poll(instructions)
    .toBe(
      "← → move · SPACE fire · R restart after win/loss. Click SCREEN to return to the controls.",
    );

  await page.getByRole("button", { name: "EXAMPLES", exact: true }).click();
  await page
    .locator('[data-example="alien-attack"]')
    .getByRole("button", { name: "Load", exact: true })
    .click();
  await expect.poll(instructions).toContain("SPACE fire");
});

test("story progress is portable and Sandbox never unlocks a chapter", async ({
  page,
}) => {
  await page.goto("/create");
  await page.getByRole("button", { name: "Sandbox", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText('TEXT 20,90,"HELLO"');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished.");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("randomize-usr.project.v1")!).unlocked,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "STORY", exact: true }).click();
  await page.getByRole("button", { name: "Show example", exact: true }).click();
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Next chapter →", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Next chapter →", exact: true })
    .click();
  const waitDownload = page.waitForEvent("download");
  await openMore(page);
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const raw = await readFile((await (await waitDownload).path())!, "utf8");
  const saved = JSON.parse(raw);
  expect(saved.sceneId).toBe(1);
  expect(saved.unlocked).toBe(1);
  const replaceDialog = page.waitForEvent("dialog");
  await page.locator("input[type=file]").setInputFiles({
    name: "story.randusr",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await (await replaceDialog).accept();
  await expect(
    page.getByRole("heading", { name: "A pocket companion", exact: true }),
  ).toBeVisible();
});
