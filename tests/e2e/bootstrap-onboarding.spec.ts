import { test, expect, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";

test.skip(
  process.env.BOOTSTRAP_E2E !== "1",
  "Requires the email-first bootstrap harness",
);
const owner = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "bootstrap@example.invalid",
  password = "A very secret testing password",
  outbox = "/tmp/randusr-e2e-mail";

async function mailFor(email: string, marker: string) {
  let found: { text: string; html: string } | undefined;
  await expect
    .poll(async () => {
      for (const name of (await readdir(outbox)).sort().reverse()) {
        const mail = JSON.parse(await readFile(`${outbox}/${name}`, "utf8"));
        if (mail.to === email && mail.text.includes(marker)) {
          found = { text: mail.text, html: mail.html };
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  return found!;
}
function linkFrom(text: string) {
  return text.match(/https?:\/\/[^\s]+/)![0];
}
async function closeDialog(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
}
test("owner receives an invitation email, registers in the browser and gets admin access", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "One bootstrap administrator per disposable fixture",
  );
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await page.goto("/invite");
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Closed-test invitation");
  await dialog
    .getByRole("button", { name: "Email me a new link", exact: true })
    .click();
  await expect(dialog).toContainText(
    "If this closed test is available, a new invitation has been sent",
  );
  const invite = await mailFor(owner, "/invite#");
  expect(invite.html).toContain("Create your account");
  // Force a full document load: navigating from /invite to /invite#token is a
  // same-document hash change and would not re-run authLink initialization.
  await page.goto("/create");
  await page.goto(linkFrom(invite.text));
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Closed-test data notice");
  expect(page.url()).not.toContain("token=");
  await expect(
    dialog.getByLabel("How will you use Randomize USR?"),
  ).toHaveCount(0);
  await dialog.getByLabel("Email address", { exact: true }).fill(owner);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog
    .getByLabel("Display name", { exact: true })
    .fill("Fixture Owner");
  await dialog
    .getByLabel("I have read the closed-test data notice.", { exact: true })
    .check();
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(dialog).toContainText("Please confirm your email");
  const verify = await mailFor(owner, "/verify#");
  await page.goto(linkFrom(verify.text));
  await expect(page).toHaveURL(/\/verify$/);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm email", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Email confirmed");
  await closeDialog(page);

  // The verified bootstrap address is an admin on an ordinary account.
  await page.goto("/admin");
  await expect(page.locator(".admin-filters")).toBeVisible();

  // Log out and back in to prove the chosen password is the normal login path.
  await page.goto("/create");
  await page.locator(".account-button").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log out", exact: true })
    .click();
  const login = page.getByRole("dialog");
  await expect(login.getByLabel("Email address", { exact: true })).toBeVisible();
  await login.getByLabel("Email address", { exact: true }).fill(owner);
  await login.getByLabel("Password", { exact: true }).fill(password);
  await login.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(login.getByText(owner, { exact: true })).toBeVisible();
  await closeDialog(page);
});
