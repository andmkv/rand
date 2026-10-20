import { expect, test, type Page } from "@playwright/test";
import { appOrigin, createVerifiedUser, editSource } from "./hosted-helpers";

// Card 107/108: project instructions are editable project metadata with one source everywhere.
test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable hosted API");
test.setTimeout(90_000);

async function setInstructions(page: Page, text: string) {
  await page.getByRole("button", { name: "Project info", exact: true }).click();
  const info = page.getByRole("dialog", { name: "Project info" });
  await info.getByLabel("How to play").fill(text);
  await info.getByRole("button", { name: "Done" }).click();
  await expect(info).toBeHidden();
}
async function share(page: Page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share", exact: true });
  await dialog.locator("input[name=visibility][value=unlisted]").check({ force: true });
  await dialog.getByRole("button", { name: "Save sharing settings" }).click();
  await expect(dialog.getByRole("status")).toContainText("Sharing updated");
  const url = await dialog.getByLabel("Project link").inputValue();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  return url;
}
const help = (page: Page) => page.locator(".play-help");

test("Example → Editor: built-in controls become editable plain-text instructions", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/examples/alien-attack", { waitUntil: "networkidle" });
  // Shown once on the example page, in the info panel only.
  await expect(page.locator(".how-to-play")).toHaveCount(1);
  await expect(page.locator(".how-to-play")).toContainText("SPACE fire");
  await expect(page.locator(".code-panel")).not.toContainText("SPACE fire");
  await page.getByRole("button", { name: "Open in editor" }).click();
  await page.waitForURL("**/create");
  await expect(help(page)).toContainText("SPACE fire");
  const tricky = 'Arrows fly <b>bold</b> <img src=x onerror="window.pwned=1">\nЛуна 🌙';
  await setInstructions(page, tricky);
  await expect(help(page)).toContainText("<b>bold</b>");
  await expect(help(page).locator("b, img")).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect(help(page)).toContainText("Луна 🌙");
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  // Clearing the text removes the block entirely.
  await setInstructions(page, "");
  await expect(help(page)).toHaveCount(0);
  // The 2000 code point limit counts emoji as one.
  await page.getByRole("button", { name: "Project info", exact: true }).click();
  const field = page.getByRole("dialog", { name: "Project info" }).getByLabel("How to play");
  await field.fill("🌙".repeat(2100));
  expect(Array.from(await field.inputValue()).length).toBe(2000);
  await expect(page.getByRole("dialog", { name: "Project info" })).toContainText("2000 / 2000");
});

test("Demo → Cloud → Share: the link shows the published instructions, not later drafts", async ({ page, browser }) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: "Try Demo" }).click();
  await page.waitForURL("**/create");
  await page.getByRole("button", { name: "Sandbox" }).click();
  await editSource(page, 'INK 6\nFILLCIRCLE 128,96,40');
  await page.getByLabel("Project title").first().fill("Moon Jump");
  await setInstructions(page, "Press SPACE to jump over the moon.");
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const url = await share(page);
  await setInstructions(page, "DRAFT: not published yet");
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const visitorContext = await browser.newContext();
  try {
    const visitor = await visitorContext.newPage();
    await visitor.goto(url, { waitUntil: "networkidle" });
    await expect(visitor.locator(".how-to-play")).toHaveCount(1);
    await expect(visitor.locator(".how-to-play")).toContainText("Press SPACE to jump");
    await expect(visitor.locator("body")).not.toContainText("DRAFT: not published");
  } finally {
    await visitorContext.close();
  }
});

test("Remix → Edit: the copy's instructions change independently of the original", async ({ page, browser }, info) => {
  page.on("dialog", (d) => void d.accept());
  await createVerifiedUser(page, `instr-owner-${info.project.name}-${Date.now()}@example.invalid`);
  await page.goto(`${appOrigin}/create`, { waitUntil: "networkidle" });
  await editSource(page, 'PRINT "ORIGINAL"');
  await page.getByLabel("Project title").first().fill("Original game");
  await setInstructions(page, "Original rules: catch the stars.");
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const url = await share(page);
  const context = await browser.newContext(),
    visitor = await context.newPage();
  try {
    visitor.on("dialog", (d) => void d.accept());
    await createVerifiedUser(visitor, `instr-remixer-${info.project.name}-${Date.now()}@example.invalid`);
    await visitor.goto(url, { waitUntil: "networkidle" });
    await visitor.getByRole("button", { name: "Remix / Save a copy" }).click();
    await visitor.locator(".viewer-info").getByRole("status").getByRole("link", { name: "Open in editor" }).click();
    await expect(visitor.locator(".cloud-status")).toHaveText("Saved to cloud");
    await expect(help(visitor)).toContainText("Original rules");
    await setInstructions(visitor, "Remix rules: dodge the stars.");
    await expect(visitor.locator(".cloud-status")).toHaveText("Saved to cloud");
    const copy = (await (await visitor.request.get("/api/v1/projects")).json()).projects[0];
    await expect
      .poll(async () => (await (await visitor.request.get(`/api/v1/projects/${copy.id}`)).json()).snapshot.instructions)
      .toBe("Remix rules: dodge the stars.");
    // The original's published page and draft keep their own text.
    await visitor.goto(url, { waitUntil: "networkidle" });
    await expect(visitor.locator(".how-to-play")).toContainText("Original rules");
    await page.reload({ waitUntil: "networkidle" });
    await expect(help(page)).toContainText("Original rules");
  } finally {
    await context.close();
  }
});
