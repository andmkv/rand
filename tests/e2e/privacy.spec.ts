import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable hosted API");
test("download private account export, delete account and keep explicitly local browser work", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const email = `privacy-browser-${info.project.name}-${Date.now()}@example.invalid`;
  await createVerifiedUser(page, email);
  await editSource(page, 'PRINT "KEEP MY LOCAL MOON"');
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await page.locator(".account-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Account data and deletion", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await dialog
    .getByRole("link", { name: "Download account data", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("randomize-usr-account.ndjson");
  const file = await download.path();
  expect(file).toBeTruthy();
  const text = await readFile(file!, "utf8");
  const rows = text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(rows.find((r) => r.recordType === "profile").data.email).toBe(email);
  expect(text).toContain("KEEP MY LOCAL MOON");
  expect(rows.at(-1).recordType).toBe("complete");
  expect(text).not.toContain("passwordHash");
  await dialog.locator("summary").filter({ hasText: "Delete account" }).click();
  const form = dialog
    .locator("form")
    .filter({
      has: page.getByRole("button", {
        name: "Permanently close my account",
        exact: true,
      }),
    });
  await form
    .getByLabel("Type your account email to confirm", { exact: true })
    .fill(email);
  await form
    .getByLabel("Current password", { exact: true })
    .fill("A very secret testing password");
  page.once("dialog", (d) => d.accept());
  await form
    .getByRole("button", { name: "Permanently close my account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Your account has been closed",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("KEEP MY LOCAL MOON");
  expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("randomize-usr.cloud-link.v1"),
    ),
  ).toBeNull();
  await page.goto("/privacy");
  await expect(page.getByRole("status")).toContainText("Policy placeholder");
  await expect(page.locator("main")).toContainText(
    "guardian consent rules",
  );
  await expect(page.locator("main")).toContainText("support address yet");
  await page.getByRole("link", { name: "Terms of Use", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Terms of Use",
  );
  await page.screenshot({
    path: `test-results/privacy-${info.project.name}.png`,
    fullPage: true,
  });
});
