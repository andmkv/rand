import { openMore } from "./more";
import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
test.skip(
  process.env.HOSTED_E2E !== "1",
  "Requires the disposable server/tests/serve.ts API and local mail sink",
);
const outbox = "/tmp/randusr-e2e-mail";
async function mailLink(email: string, path: string) {
  let link = "";
  await expect
    .poll(async () => {
      for (const name of (await readdir(outbox)).sort().reverse()) {
        const mail = JSON.parse(await readFile(`${outbox}/${name}`, "utf8"));
        if (mail.to === email && mail.text.includes(path)) {
          link = mail.text.match(/https?:\/\/[^\s]+/)[0];
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  return link;
}
test("register, verify, logout, reset and login preserve local code", async ({
  page,
}, info) => {
  const email = `child-${info.project.name}-${Date.now()}@example.invalid`;
  await page.goto("/create");
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText('PRINT "MY LOCAL MAGIC"');
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await dialog.getByLabel("Email address", { exact: true }).fill(email);
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("My very secret password 123");
  await dialog
    .getByLabel("Display name", { exact: true })
    .fill("Pixel Explorer");
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(
    dialog.getByText("Please confirm your email", { exact: false }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("MY LOCAL MAGIC");
  await page.goto(await mailLink(email, "/verify#"));
  await expect(page).toHaveURL(/\/verify$/); // fragment removed before any UI interaction
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm email", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Email confirmed");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "My account", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log out", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Forgot password", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Email address", { exact: true })
    .fill(email);
  await page
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "If this address has an account",
  );
  await page.goto(await mailLink(email, "/reset-password#"));
  await page
    .getByRole("dialog")
    .getByLabel("Password", { exact: true })
    .fill("My entirely new password 456");
  await page
    .getByRole("button", { name: "Save new password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Password changed");
  await page
    .getByRole("dialog")
    .getByLabel("Email address", { exact: true })
    .fill(email);
  await page
    .getByRole("dialog")
    .getByLabel("Password", { exact: true })
    .fill("My entirely new password 456");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log in", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText(email, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("MY LOCAL MAGIC");
  await page.locator(".account-button").click();
  const settings = page.getByRole("dialog");
  await settings.getByLabel("Display name", { exact: true }).fill("New Pixel");
  await settings
    .getByLabel("Preferred language", { exact: true })
    .selectOption("de");
  await settings
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Profil gespeichert.");
  const principal = (await (await page.request.get("/api/v1/session")).json())
    .principal;
  expect(principal.canTeach).toBeUndefined();
  expect(principal.canLearn).toBeUndefined();
  await settings
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
  await openMore(page);
  await page.locator("#more-panel select").selectOption("uk");
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/v1/auth/me")).json()).locale,
    )
    .toBe("uk");
  await page.goto("/settings");
  await expect(page.locator("#more-panel select")).toHaveValue("uk");
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: /New Pixel/ }),
  ).toBeVisible();
  await page.screenshot({ path: `test-results/auth-${info.project.name}.png` });
});
