import { expect, test, type Page } from "@playwright/test";
import { openMore } from "./more";

test.skip(
  process.env.HOSTED_E2E !== "1",
  "Requires the disposable server/tests/serve.ts API",
);
test.use({ viewport: { width: 1440, height: 900 } });

const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test("missing, malformed and unpublished links share one friendly page", async ({
  page,
}) => {
  for (const code of ["AAAAAAAAAAAAAAAA", "00000000-0000-0000-0000-000000000000"]) {
    await page.goto(`${origin}/p/${code}`, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Project not available" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("isn’t available");
    await expect(page.locator("body")).not.toContainText("check the fields");
    await expect(page.getByRole("link", { name: "Browse examples" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in editor" })).toBeVisible();
    await expect(page.getByLabel("Language")).toBeVisible();
  }
});

test("guest /me/projects explains the account and keeps local code", async ({
  page,
}) => {
  await page.goto(`${origin}/create`, { waitUntil: "networkidle" });
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText('PRINT "KEEP ME"');
  await page.goto(`${origin}/me/projects`, { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog", { name: "My projects needs an account" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Back to the editor" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.locator(".cm-content")).toContainText("KEEP ME");
});

test("demo: sharing keeps SCREEN and picture, inline rename, titled duplicate, honest account dialog, localized bar", async ({
  page,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: "Try Demo" }).click();
  await page.waitForURL("**/create");
  await page.getByRole("button", { name: "Sandbox" }).click();
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText('INK 6\nFILLCIRCLE 128,96,40\nINK 2\nTEXT 80,20,"MOON"');
  await page.getByLabel("Project title").fill("Moon Garden");
  await page.getByRole("button", { name: "▶ PRESS RUN" }).click();
  await expect(page.locator(".code-panel .status")).toHaveText("Finished.");
  const lit = (p: Page) =>
    p.locator("canvas").evaluate((c) => {
      const d = (c as HTMLCanvasElement)
        .getContext("2d")!
        .getImageData(0, 0, 256, 192).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) n++;
      return n;
    });
  const before = await lit(page);
  expect(before).toBeGreaterThan(500);
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");

  // Sharing: SCREEN stays, the chosen picture is published, later visibility changes keep it.
  await openMore(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share", exact: true });
  await share.locator("input[name=visibility][value=unlisted]").check({ force: true });
  await expect(share.getByText("Use the current SCREEN")).toBeVisible();
  await expect(share.getByRole("button", { name: "Save sharing settings" })).toBeInViewport();
  await share.getByRole("button", { name: "Save sharing settings" }).click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  expect(await lit(page)).toBe(before);
  const link = await share.getByLabel("Project link").inputValue();
  const code = link.split("/p/")[1];
  const pictureOf = async () => {
    const shared = await (await page.request.get(`/api/v1/demo/shared/${code}`)).json();
    return Buffer.from(
      await (await page.request.get(shared.previewUrl)).body(),
    ).toString("base64");
  };
  const first = await pictureOf();
  expect(first.length).toBeGreaterThan(200);
  for (const value of ["public", "unlisted", "public"]) {
    await share.locator(`input[name=visibility][value=${value}]`).check({ force: true });
    await share.getByRole("button", { name: "Save sharing settings" }).click();
    await expect(share.getByRole("status")).toContainText("Sharing updated");
  }
  expect(await pictureOf()).toBe(first);
  expect(await lit(page)).toBe(before);
  await share.getByRole("button", { name: "Close" }).click();

  // Inline rename and titled duplicate.
  await openMore(page);
  await page.getByRole("button", { name: "My projects" }).click();
  const library = page.locator("dialog[open]");
  await library.getByRole("button", { name: "Duplicate" }).first().click();
  await expect(library.getByRole("heading", { name: "Copy of Moon Garden" })).toBeVisible();
  await library.getByRole("button", { name: "Rename" }).first().click();
  await library.getByLabel("Project title").fill("Moon Garden Deluxe");
  await library.getByRole("button", { name: "Save title" }).click();
  await expect(library.getByRole("heading", { name: "Moon Garden Deluxe" })).toBeVisible();
  await expect(page.getByLabel("Project title").first()).toHaveValue(/Moon Garden/);
  await library.getByRole("button", { name: "Close" }).first().click();

  // Account dialog: demo copy only.
  await page.getByRole("button", { name: "My account" }).click();
  const account = page.locator("dialog[open]");
  await expect(account).toContainText("temporary demo session");
  await expect(account).not.toContainText("Keep playing as a guest");
  await expect(account).not.toContainText("invited adult testers");
  await expect(account.getByRole("button", { name: "Forgot password" })).toHaveCount(0);
  await expect(account.getByRole("button", { name: "Log in" })).toHaveCount(0);
  await expect(account.getByRole("button", { name: "Exit demo" })).toBeVisible();
  await account.getByRole("button", { name: "Close" }).click();

  // The DEMO bar follows the language.
  await openMore(page);
  await page.getByLabel("Language").selectOption("ru");
  await expect(page.locator(".demo-badge")).toContainText("ДЕМО-РЕЖИМ");
  await expect(page.locator(".demo-badge")).toContainText("Режим практики");
});

test("empty password-reset email shows a localized message and sends nothing", async ({
  page,
}) => {
  let sent = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/forgot")) sent++;
  });
  await page.addInitScript(() => localStorage.setItem("randomize-usr.locale", "ru"));
  await page.goto(`${origin}/create`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Войти" }).first().click();
  await page.getByRole("button", { name: "Забыли пароль" }).click();
  await page.locator("dialog[open] form button[type=submit]").click();
  await expect(page.locator("dialog[open] #auth-field-error")).toHaveText("Заполни это поле.");
  await expect(page.locator("dialog[open] input[name=email]")).toBeFocused();
  await expect(page.locator("dialog[open] input[name=email]")).toHaveAttribute("aria-invalid", "true");
  expect(sent).toBe(0);
  await page.addInitScript(() => localStorage.setItem("randomize-usr.locale", "en"));
  await page.goto(`${origin}/create`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.getByRole("button", { name: "Forgot password" }).click();
  await page.locator("dialog[open] form button[type=submit]").click();
  await expect(page.locator("dialog[open] #auth-field-error")).toHaveText("Please fill in this field.");
});
