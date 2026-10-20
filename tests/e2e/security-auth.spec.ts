import { test, expect } from "@playwright/test";
import { createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable hosted API");
test("server limits are observable and signing out hides an owner's private shared source", async ({
  page,
}, info) => {
  test.setTimeout(45000);
  await createVerifiedUser(
    page,
    `private-viewer-${info.project.name}-${Date.now()}@example.invalid`,
  );
  await editSource(page, 'PRINT "PRIVATE OWNER VIEW"');
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const p = (await (await page.request.get("/api/v1/projects")).json())
    .projects[0];
  await page.locator(".account-button").click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator("summary")
    .filter({ hasText: "Limits on this server" })
    .click();
  await expect(dialog).toContainText("Code characters per cloud project");
  await expect(dialog).toContainText("100,000");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const sharing = await (
    await page.request.get(`/api/v1/projects/${p.id}/share`)
  ).json();
  await page.goto(`/p/${sharing.shortCode}`);
  await expect(page.locator(".cm-content")).toContainText("PRIVATE OWNER VIEW");
  await page.locator(".account-button").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log out", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "This project isn’t available.",
  );
});
