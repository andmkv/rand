import { test, expect } from "@playwright/test";
import { appOrigin, createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable hosted API");
test("administrator manages users, reads/moderates source and records deletion without SQL", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Single configured bootstrap admin in disposable fixture",
  );
  test.setTimeout(90000);
  await createVerifiedUser(page, "admin@example.invalid");
  const memberContext = await browser.newContext(),
    member = await memberContext.newPage(),
    email = `admin-member-${Date.now()}@example.invalid`,
    password = "A very secret testing password";
  try {
    await createVerifiedUser(member, email);
    const memberId = (
      await (await member.request.get("/api/v1/auth/me")).json()
    ).id;
    await editSource(member, 'PRINT "PRIVATE SUPPORT SOURCE"');
    await member
      .getByLabel("Project title", { exact: true })
      .fill("Support toy");
    await member
      .getByRole("button", { name: "Save to cloud", exact: true })
      .click();
    await expect(member.locator(".cloud-status")).toHaveText("Saved to cloud");
    const project = (
      await (await member.request.get("/api/v1/projects")).json()
    ).projects[0];
    await member.goto(`${appOrigin}/admin`);
    await expect(member.getByRole("alert")).toContainText(
      "does not have administrator access",
    );
    expect((await member.request.get("/api/v1/admin/users")).status()).toBe(
      403,
    );
    await page.goto("/admin");
    await page
      .getByRole("textbox", { name: "Search", exact: true })
      .fill(email);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .locator(".admin-grid article")
      .filter({ hasText: email })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    const detail = page.locator(".admin-detail");
    async function action(button: string, withPassword = false) {
      await detail
        .getByLabel("Administrative reason", { exact: true })
        .fill("Browser support case");
      if (withPassword)
        await detail
          .getByLabel("Current password", { exact: true })
          .fill(password);
      page.once("dialog", (d) => d.accept());
      await detail.getByRole("button", { name: button, exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        "Administrative action recorded.",
      );
    }
    await action("Send reset link");
    expect(await detail.innerText()).not.toContain("token=");
    await action("Grant administrator rights", true);
    await expect(
      detail.getByRole("button", {
        name: "Revoke administrator rights",
        exact: true,
      }),
    ).toBeVisible();
    await action("Revoke administrator rights", true);
    await action("Suspend account");
    await expect(
      detail.getByRole("button", { name: "Reactivate account", exact: true }),
    ).toBeVisible();
    await action("Reactivate account");
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Search", exact: true })
      .fill("Support toy");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .locator(".admin-grid article")
      .filter({ hasText: "Support toy" })
      .getByRole("link", { name: "Inspect source", exact: true })
      .click();
    await expect(page.locator(".cm-content")).toContainText(
      "PRIVATE SUPPORT SOURCE",
    );
    await expect(page.locator(".cm-content")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect(page.locator(".status")).toContainText("Finished.");
    await page
      .locator(".viewer-info details")
      .first()
      .locator("summary")
      .click();
    await page
      .getByLabel("Moderation action", { exact: true })
      .selectOption("block");
    await page
      .getByLabel("Administrative reason", { exact: true })
      .fill("Review sharing safety");
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Apply moderation", exact: true })
      .click();
    await expect(page.locator(".viewer-info")).toContainText("Sharing blocked");
    await page.goto(`/admin?tab=audit`);
    await page
      .getByRole("textbox", { name: "Target ID", exact: true })
      .fill(project.id);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".audit-list")).toContainText(
      "admin.project_block",
    );
    await page.goto("/admin");
    await page
      .getByRole("textbox", { name: "Search", exact: true })
      .fill(email);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .locator(".admin-grid article")
      .filter({ hasText: email })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await action("Delete account", true);
    await expect(
      detail.getByLabel("Administrative reason", { exact: true }),
    ).toBeDisabled();
    expect(
      (await (await page.request.get(`/api/v1/admin/users/${memberId}`)).json())
        .state,
    ).toBe("deleted");
    await page.screenshot({ path: "test-results/admin-console-chromium.png" });
  } finally {
    await memberContext.close();
  }
});
