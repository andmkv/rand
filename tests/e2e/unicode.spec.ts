import { test, expect } from "@playwright/test";
test("Cyrillic is real SCREEN output and input/speech/PRINT preserve text", async ({
  page,
}, info) => {
  await page.goto("/create");
  await page.getByRole("button", { name: "Sandbox", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(
    'INK 6\nTEXT 88,94,"ПРИВЕЕЕТ"\nINPUT "Как тебя зовут?",NAME\nPRINT "Привет, " + NAME\nTEXT 20,130,"Hello, " + NAME\nCAT=SPAWN("cat",100,55)\nCAT.SAY "Привет!"\nTEXT 20,160,"Živjo Ćao Љубав Єнот"',
  );
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(
    page.getByText("Как тебя зовут?", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Your answer").fill("Даня");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished.");
  await expect(page.getByRole("log")).toContainText("Привет, Даня");
  expect(
    await page.locator("canvas").evaluate((c) => {
      const a = (c as HTMLCanvasElement)
        .getContext("2d")!
        .getImageData(88, 94, 70, 18).data;
      let n = 0;
      for (let i = 0; i < a.length; i += 4)
        if (a[i] || a[i + 1] || a[i + 2]) n++;
      return n;
    }),
  ).toBeGreaterThan(40);
  await page.screenshot({
    path: `test-results/unicode-${info.project.name}.png`,
  });
});
