import { expect, test, type Browser, type Page } from "@playwright/test";
import { t, type Locale } from "../../src/i18n";
import { hostedCopy } from "../../shared/copy";
import { closeMore, openMore, openShareDetails } from "./more";

test.skip(
  process.env.HOSTED_E2E !== "1",
  "Requires the disposable server/tests/serve.ts API",
);
test.describe.configure({ mode: "serial" });

test.use({ viewport: { width: 1440, height: 900 } });

const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const languages: Locale[] = ["ru", "ja", "de"];

const picker = (page: Page, locale: Locale) =>
  page.getByLabel(t("locale", locale)).first();

async function expectLocale(page: Page, locale: Locale) {
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  // The visible picker is labelled in the chosen language, so a silent reset fails here too.
  await expect(picker(page, locale)).toHaveValue(locale);
  expect(
    await page.evaluate(() => localStorage.getItem("randomize-usr.locale")),
  ).toBe(locale);
}

async function chooseLocale(page: Page, locale: Locale) {
  await openMore(page);
  await page.locator("select.language-picker").selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await closeMore(page);
}

async function openDemo(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: "Try Demo" }).click();
  await page.waitForURL("**/create");
  await expect(page.locator(".demo-badge")).toBeVisible();
  return page;
}

async function setCode(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(code, { delay: 1 });
}

/** Publish a private demo project so the shared viewer can be part of the locale walk. */
async function publish(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Sandbox" }).click();
  await setCode(page, 'CLS\nINK 6\nTEXT 24,80,"LOCALE"\n');
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await openMore(page);
  await page.getByRole("button", { name: "Share" }).first().click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("input[name=visibility][value=public]").check({ force: true });
  await openShareDetails(dialog);
  await dialog.locator("input[name=title]").fill("Locale walk project");
  await dialog.locator("form button").click();
  await expect(dialog.getByRole("status")).toContainText("Sharing updated");
  const link = await dialog.locator('a[href^="/p/"]').getAttribute("href");
  await dialog.getByRole("button", { name: "Close" }).first().click();
  return link!.replace("/p/", "");
}

test("demo: the chosen language survives Home, editor, My Projects, shared viewer, Back and reload", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const page = await openDemo(browser);
  page.setDefaultNavigationTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const code = await publish(page);

  for (const locale of languages) {
    await page.goto(origin + "/create", { waitUntil: "networkidle" });
    await chooseLocale(page, locale);
    await expectLocale(page, locale);

    // Home is where the reset was first seen, including its gallery and hero copy.
    await page.goto(origin + "/", { waitUntil: "networkidle" });
    await expectLocale(page, locale);
    await expect(
      page.getByRole("link", { name: hostedCopy("startStory", locale) }),
    ).toBeVisible();

    // Editor: the chosen language is on the toolbar and the person's code is untouched.
    await page.goto(origin + "/create", { waitUntil: "networkidle" });
    await expectLocale(page, locale);
    await expect(
      page.getByRole("button", { name: t("run", locale), exact: true }),
    ).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText('"LOCALE"');

    // My Projects keeps the language and the demo badge.
    await openMore(page);
    await page.getByRole("button", { name: hostedCopy("myProjects", locale) }).click();
    await expect(
      page.locator("dialog[open]").getByRole("heading", {
        name: hostedCopy("myProjects", locale),
      }),
    ).toBeVisible();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: t("close", locale) })
      .first()
      .click();

    // The temporary shared viewer and Back from it.
    await page.goto(`${origin}/p/${code}`, { waitUntil: "networkidle" });
    await expectLocale(page, locale);
    await expect(page.locator(".demo-badge")).toBeVisible();
    await page.goBack({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/create/);
    await expectLocale(page, locale);

    // Reload keeps the choice instead of falling back to the session default.
    await page.reload({ waitUntil: "networkidle" });
    await expectLocale(page, locale);
  }

  expect(errors).toEqual([]);
});

test("guest: a chosen language survives navigation and reload", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await chooseLocale(page, "de");
  await expectLocale(page, "de");
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await expectLocale(page, "de");
  await page.reload({ waitUntil: "networkidle" });
  await expectLocale(page, "de");
});

test("registered account: the saved language survives navigation and reload", async ({
  browser,
}, testInfo) => {
  const email = `locale-walk-${testInfo.project.name}-${Date.now()}@example.invalid`;
  const page = await (await browser.newContext()).newPage();
  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await page.locator(".account-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await dialog.getByLabel("Email address", { exact: true }).fill(email);
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("A very secret testing password");
  await dialog.getByLabel("Display name", { exact: true }).fill("Locale Walker");
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(
    dialog.getByText("Please confirm your email", { exact: false }),
  ).toBeVisible();
  const { readFile, readdir } = await import("node:fs/promises");
  let link = "";
  await expect
    .poll(async () => {
      for (const file of (await readdir("/tmp/randusr-e2e-mail")).sort().reverse()) {
        const mail = JSON.parse(await readFile(`/tmp/randusr-e2e-mail/${file}`, "utf8"));
        if (mail.to === email && mail.text.includes("/verify#")) {
          link = mail.text.match(/https?:\/\/[^\s]+/)![0];
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  await page.goto(link);
  await page.getByRole("button", { name: "Confirm email", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Email confirmed");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  await page.goto(origin + "/create", { waitUntil: "networkidle" });
  await chooseLocale(page, "de");
  await expectLocale(page, "de");
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await expectLocale(page, "de");
  await page.reload({ waitUntil: "networkidle" });
  await expectLocale(page, "de");
});
