import { expect, test, type Page } from "@playwright/test";

// Screenshot evidence for UX reviews (card 108): every main view at the review sizes and locales.
// Run against the disposable harness: UX_SCREENS=1 HOSTED_E2E=1 npx playwright test ux-screens --project=chromium
test.skip(
  process.env.UX_SCREENS !== "1" || process.env.HOSTED_E2E !== "1",
  "Screenshot run only; needs the disposable server/tests/serve.ts API",
);
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const out = process.env.UX_SCREENS_DIR ?? "test-results/ux";
const sizes = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "820x874", width: 820, height: 874 },
];
const locales = (process.env.UX_LOCALES ?? "en,ru").split(",");

async function shoot(page: Page, view: string, locale: string) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `${view} ${size.name} ${locale} horizontal overflow`).toBe(false);
    await page.screenshot({ path: `${out}/${view}-${locale}-${size.name}.png` });
  }
}
async function setLocale(page: Page, locale: string) {
  await page.addInitScript((l) => {
    if (!sessionStorage.getItem("ux-locale-set")) {
      localStorage.setItem("randomize-usr.locale", l);
      sessionStorage.setItem("ux-locale-set", "1");
    }
  }, locale);
}

for (const locale of locales) {
  test(`guest views (${locale})`, async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    await setLocale(page, locale);
    await page.goto("/", { waitUntil: "networkidle" });
    await shoot(page, "01-home", locale);
    await page.goto("/create", { waitUntil: "networkidle" });
    await page.locator(".cm-content").waitFor();
    await shoot(page, "02-first-open", locale);
    await page.locator(".mode-controls button, [data-mode]").nth(0).click();
    await page.waitForTimeout(300);
    await shoot(page, "03-story", locale);
    await page.locator(".mode-controls button, [data-mode]").nth(1).click();
    await page.waitForTimeout(300);
    await shoot(page, "04-sandbox", locale);
    await page.goto("/examples/alien-attack", { waitUntil: "networkidle" });
    await page.locator(".cm-content").waitFor();
    await shoot(page, "05-example-viewer", locale);
  });

}

test("demo account: saved project, My projects and the shared page", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await page.setViewportSize(sizes[0]);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: "Try Demo" }).click();
  await page.waitForURL("**/create");
  await page.getByRole("button", { name: "Sandbox" }).click();
  await page.goto("/create?mode=sandbox", { waitUntil: "networkidle" });
  // A remix-like start: the Alien Attack example in the editor.
  await page.getByRole("button", { name: "EXAMPLES", exact: true }).click();
  await page
    .locator('[data-example="alien-attack"]')
    .getByRole("button", { name: "Load", exact: true })
    .click();
  await page.getByLabel("Project title").first().fill("Moon Defence");
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share", exact: true });
  await share.locator("input[name=visibility][value=unlisted]").check({ force: true });
  await share.getByRole("button", { name: "Save sharing settings" }).click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  const link = await share.getByLabel("Project link").inputValue();
  await share.getByRole("button", { name: "Close" }).click();
  for (const locale of locales) {
    // A signed-in language choice is stored on the account, so pick it the way a user does.
    await page.goto("/create", { waitUntil: "networkidle" });
    await page.locator(".cm-content").waitFor();
    await page.setViewportSize(sizes[0]);
    await page.locator('button[aria-controls="more-panel"]').click();
    await page.locator("#more-panel select.language-picker").selectOption(locale);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await shoot(page, "06-demo-saved-project", locale);
    await page.locator(".info-button").click();
    await page.locator("dialog.project-info[open]").waitFor();
    await shoot(page, "10-project-info", locale);
    await page.keyboard.press("Escape");
    await page.locator('button[aria-controls="more-panel"]').click();
    await shoot(page, "07-project-menu", locale);
    await page.locator("#more-panel .menu-group > button").first().click();
    await page.locator("dialog[open]").first().waitFor();
    await shoot(page, "08-my-projects", locale);
    await page.keyboard.press("Escape");
    await page.goto(new URL(link).pathname, { waitUntil: "networkidle" });
    await page.locator(".cm-content").waitFor();
    await shoot(page, "09-shared-viewer", locale);
  }
});
