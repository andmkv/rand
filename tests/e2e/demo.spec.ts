import { openMore, openShareDetails, openViewerMore } from "./more";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  process.env.HOSTED_E2E !== "1",
  "Requires the disposable server/tests/serve.ts API",
);
test.describe.configure({ mode: "serial" });

test.use({ viewport: { width: 1440, height: 900 } });

const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

async function tryDemo(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Try Demo" })).toBeVisible();
  await page.getByRole("button", { name: "Try Demo" }).click();
  await page.waitForURL("**/create");
  await expect(page.locator(".demo-badge")).toContainText("DEMO MODE");
  return { context, page };
}

async function setCode(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(code, { delay: 1 });
}

async function closeDialog(page: Page) {
  const dialog = page.locator("dialog[open]");
  if (await dialog.count())
    await dialog.getByRole("button", { name: "Close" }).first().click();
}

let shared: { context: BrowserContext; page: Page; code: string; projectId: string };

test("demo: create, autosave, reload, history restore", async ({ browser }) => {
  const { context, page } = await tryDemo(browser);
  shared = { context, page, code: "", projectId: "" };
  await page.getByRole("button", { name: "Sandbox" }).click();
  await setCode(page, 'CLS\nINK 6\nTEXT 20,20,"DEMO V1"\n');
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");

  await setCode(page, 'CLS\nINK 2\nTEXT 20,20,"DEMO V2"\n');
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".cm-content")).toContainText("DEMO V2");
  await expect(page.locator(".demo-badge")).toBeVisible();

  await openMore(page);

  await page.getByRole("button", { name: "History" }).first().click();
  const history = page.locator("dialog[open]");
  await expect(history.locator("article").first()).toBeVisible();
  await history.locator("article button").last().click();
  await expect(history.locator(".revision-source")).toContainText("DEMO V1");
  await history.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".cm-content")).toContainText("DEMO V1");
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await closeDialog(page);

  const link = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("randomize-usr.cloud-link.v1") ?? "null"),
  );
  shared.projectId = link.id;
  expect(link.ownerId).toMatch(/^demo:/);
});

test("demo: public share opens anonymously and appears in the temporary gallery", async () => {
  const { page } = shared;
  await openMore(page);
  await page.getByRole("button", { name: "Share" }).first().click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("input[name=visibility][value=public]").check({ force: true });
  await openShareDetails(dialog);
  await dialog.locator("input[name=title]").fill("E2E Demo Project");
  await dialog.locator("input[value=art]").check();
  await dialog.locator("form button").click();
  await expect(dialog.getByRole("status")).toContainText("Sharing updated");
  shared.code = (await dialog
    .locator('a[href^="/p/"]')
    .getAttribute("href"))!.replace("/p/", "");
  expect(shared.code).toMatch(/^[A-Za-z0-9_-]{16}$/);
  await closeDialog(page);

  const anonymous = await page.context().browser()!.newContext();
  const guest = await anonymous.newPage();
  await guest.goto(`${origin}/p/${shared.code}`, { waitUntil: "networkidle" });
  await expect(guest.getByRole("heading", { name: "E2E Demo Project" })).toBeVisible();
  await expect(guest.getByText("Temporary demo project.")).toBeVisible();
  await expect(guest.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await guest.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(guest.locator(".code-panel .status")).toHaveText("Finished.");
  await anonymous.close();

  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await expect(page.locator(".gallery-card h3", { hasText: "E2E Demo Project" })).toBeVisible();
});

test("demo: remix creates an independent private copy", async () => {
  const { page } = shared;
  await page.goto(`${origin}/p/${shared.code}`, { waitUntil: "networkidle" });
  // On their own page the owner finds Remix under More (Edit my draft comes first).
  await openViewerMore(page);
  await page.getByRole("button", { name: /Remix/ }).click();
  await expect(page.getByText(/Your private copy is saved/)).toBeVisible();
  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await openMore(page);
  await page.getByRole("button", { name: "My projects" }).click();
  await expect(page.locator("dialog[open] article")).toHaveCount(2);
  await closeDialog(page);
});

test("demo: two sessions are isolated and demo/demo works", async ({ browser }) => {
  test.setTimeout(90_000);
  const other = await tryDemo(browser);
  await openMore(other.page);
  await other.page.getByRole("button", { name: "My projects" }).click();
  await expect(other.page.locator("dialog[open] article")).toHaveCount(0);
  await closeDialog(other.page);

  // A different session can view and run the public link; Remix is replaced by an explanation.
  await other.page.goto(`${origin}/p/${shared.code}`, { waitUntil: "networkidle" });
  await expect(other.page.getByRole("button", { name: /Remix/ })).toHaveCount(0);
  await expect(other.page.getByText("Only the demo session that made this project can remix it")).toBeVisible();
  await other.page.goto(origin + "/create", { waitUntil: "networkidle" });
  await openMore(other.page);
  await other.page.getByRole("button", { name: "My projects" }).click();
  await expect(other.page.locator("dialog[open] article")).toHaveCount(0);
  await closeDialog(other.page);
  await other.context.close();

  const explicit = await browser.newContext();
  const page = await explicit.newPage();
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await page.locator("dialog[open] input[name=email]").fill("demo");
  await page.locator("dialog[open] input[name=password]").fill("demo");
  await page.locator("dialog[open] form button").click();
  await page.waitForURL("**/create");
  await expect(page.locator(".demo-badge")).toBeVisible();
  await explicit.close();
});

test("demo: no admin entry, exit restores the local project and revokes the link", async () => {
  const { page, context } = shared;
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Exit demo" }).click();
  await page.waitForURL("**/create");
  await expect(page.locator(".demo-badge")).toHaveCount(0);
  await expect(page.locator(".cm-content")).not.toContainText("DEMO V1");
  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names).not.toContain("randusr_demo_session");
  expect(names).not.toContain("randusr_demo");

  const guest = await (await context.browser()!.newContext()).newPage();
  await guest.goto(`${origin}/p/${shared.code}`, { waitUntil: "networkidle" });
  await expect(guest.getByRole("heading", { name: "Demo project expired" })).toBeVisible();
  await context.close();
});
