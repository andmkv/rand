import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { appOrigin, editSource } from "./hosted-helpers";
test.skip(
  process.env.CLOSED_TEST_E2E !== "1",
  "Requires closed disposable invitation fixture",
);
test("closed test hides open signup but accepts an invited adult after explicit data notice and email verification", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const invite = JSON.parse(
    await readFile(
      `/tmp/randusr-e2e-invites/${info.project.name}.json`,
      "utf8",
    ),
  );
  await page.goto("/create");
  await page.locator(".account-button").click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Closed test");
  await expect(
    dialog.getByRole("button", { name: "Sign up", exact: true }),
  ).toHaveCount(0);
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  const denied = await page.request.post("/api/v1/auth/register", {
    headers: { origin: appOrigin, "x-csrf-token": csrf.token },
    data: {
      email: "uninvited@example.invalid",
      password: "Closed test password 12345",
      displayName: "Uninvited",
      locale: "en",
    },
  });
  expect(denied.status()).toBe(403);
  await page.goto(invite.url);
  expect(page.url()).not.toContain("token=");
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Closed-test data notice");
  await expect(dialog).toContainText(
    "legal policies are still unapproved drafts",
  );
  await dialog.getByLabel("Email address", { exact: true }).fill(invite.email);
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("Closed test password 12345");
  await dialog
    .getByLabel("Display name", { exact: true })
    .fill("Invited adult");
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(
    dialog.getByLabel("I have read the closed-test data notice.", {
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(dialog).not.toContainText("Please confirm your email");
  await dialog
    .getByLabel("I have read the closed-test data notice.", { exact: true })
    .check();
  await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(dialog).toContainText("Please confirm your email");
  let link = "";
  await expect
    .poll(async () => {
      for (const name of (await readdir("/tmp/randusr-e2e-mail"))
        .sort()
        .reverse()) {
        const mail = JSON.parse(
          await readFile(`/tmp/randusr-e2e-mail/${name}`, "utf8"),
        );
        if (mail.to === invite.email && mail.text.includes("/verify#")) {
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
  await editSource(page, 'PRINT "INVITED ADULT WORK"');
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const data = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(data).not.toContain(new URL(invite.url).hash.slice(1));
  await page.locator(".account-button").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log out", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign up", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByLabel("Email address", { exact: true })
    .fill(invite.email);
  await page
    .getByRole("dialog")
    .getByLabel("Password", { exact: true })
    .fill("Closed test password 12345");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log in", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Invited adult");
  await page.screenshot({
    path: `test-results/closed-test-${info.project.name}.png`,
  });
});
