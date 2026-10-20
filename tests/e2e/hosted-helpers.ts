import { expect, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
/** The web origin under test; a second worktree can run its own harness on other ports. */
export const appOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
export async function createVerifiedUser(page: Page, email: string) {
  await page.goto("/create");
  await page.locator(".account-button").click();
  const dialog = page.getByRole("dialog");
  if (email === "admin@example.invalid") {
    await dialog.getByLabel("Email address", { exact: true }).fill(email);
    await dialog
      .getByLabel("Password", { exact: true })
      .fill("A very secret testing password");
    await dialog.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(dialog.getByText(email, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    return;
  }
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await dialog.getByLabel("Email address", { exact: true }).fill(email);
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("A very secret testing password");
  await dialog.getByLabel("Display name", { exact: true }).fill("Moon Maker");
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(
    dialog.getByText("Please confirm your email", { exact: false }),
  ).toBeVisible();
  let link = "";
  await expect
    .poll(async () => {
      for (const file of (await readdir("/tmp/randusr-e2e-mail"))
        .sort()
        .reverse()) {
        const mail = JSON.parse(
          await readFile(`/tmp/randusr-e2e-mail/${file}`, "utf8"),
        );
        if (mail.to === email && mail.text.includes("/verify#")) {
          link = mail.text.match(/https?:\/\/[^\s]+/)[0];
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  await page.goto(link);
  await page
    .getByRole("button", { name: "Confirm email", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Email confirmed");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
}
export async function editSource(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
}
