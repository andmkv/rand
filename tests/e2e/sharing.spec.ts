import { openMore, openShareDetails } from "./more";
import { test, expect } from "@playwright/test";
import { appOrigin, createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable hosted API");
test("share pinned version, run as guest without changing local work, rotate and revoke link", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  await createVerifiedUser(
    page,
    `share-${info.project.name}-${Date.now()}@example.invalid`,
  );
  await page.getByLabel("Project title", { exact: true }).fill("Shared moon");
  await editSource(page, 'PRINT "ORIGINAL PUBLISHED"');
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const id = (await (await page.request.get("/api/v1/projects")).json())
    .projects[0].id;
  await openMore(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share", exact: true });
  await share
    .locator("input[name=visibility][value=unlisted]")
    .check({ force: true });
  await openShareDetails(share);
  await share
    .getByLabel("Short description", { exact: true })
    .fill("Try my moon");
  await share.getByLabel("Art", { exact: true }).check();
  await share
    .getByRole("button", { name: "Save sharing settings", exact: true })
    .click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  const url = await share
    .getByLabel("Project link", { exact: true })
    .inputValue();
  await share.getByRole("button", { name: "Close", exact: true }).click();
  await editSource(page, 'PRINT "NEWER DRAFT"');
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/projects/${id}`)).json())
          .snapshot.sourceCode,
    )
    .toBe('PRINT "NEWER DRAFT"');
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(`${appOrigin}/create`);
    await editSource(guest, 'PRINT "MY OWN LOCAL WORK"');
    await expect
      .poll(() =>
        guest.evaluate(
          () =>
            JSON.parse(localStorage.getItem("randomize-usr.project.v1")!)
              .sourceCode,
        ),
      )
      .toBe('PRINT "MY OWN LOCAL WORK"');
    const local = await guest.evaluate(() =>
      localStorage.getItem("randomize-usr.project.v1"),
    );
    await guest.goto(url);
    await expect(guest.locator(".cm-content")).toContainText(
      "ORIGINAL PUBLISHED",
    );
    await expect(guest.locator(".cm-content")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect(guest.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await guest.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect(guest.getByRole("status")).toContainText("Finished.");
    expect(
      await guest.evaluate(() =>
        localStorage.getItem("randomize-usr.project.v1"),
      ),
    ).toBe(local);
    await openMore(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await share
      .getByRole("button", { name: "Replace link", exact: true })
      .click();
    await expect(share.getByRole("status")).toContainText(
      "The old link is closed",
    );
    const rotated = await share
      .getByLabel("Project link", { exact: true })
      .inputValue();
    expect(rotated).not.toBe(url);
    expect(
      (
        await guest.request.get(`/api/v1/shared/${url.split("/").at(-1)}`)
      ).status(),
    ).toBe(404);
    await guest.goto(rotated);
    await expect(guest.locator(".cm-content")).toContainText(
      "ORIGINAL PUBLISHED",
    );
    await share
      .locator("input[name=visibility][value=private]")
    .check({ force: true });
    await share
      .getByRole("button", { name: "Save sharing settings", exact: true })
      .click();
    await expect(share.getByRole("status")).toContainText("Sharing updated");
    expect(
      (
        await guest.request.get(`/api/v1/shared/${rotated.split("/").at(-1)}`)
      ).status(),
    ).toBe(404);
    expect(
      (await (await page.request.get(`/api/v1/projects/${id}`)).json()).snapshot
        .sourceCode,
    ).toBe('PRINT "NEWER DRAFT"');
    await share
      .locator("input[name=visibility][value=public]")
    .check({ force: true });
    await share
      .getByRole("button", { name: "Save sharing settings", exact: true })
      .click();
    await expect(share.getByRole("status")).toContainText("Sharing updated");
    await guest.goto(rotated);
    await expect(guest.locator(".cm-content")).toContainText("NEWER DRAFT");
    await guest.goto(`${appOrigin}/`);
    await guest
      .getByLabel("Find a project", { exact: true })
      .fill("Shared moon");
    await guest.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      guest.locator(`a[href="/p/${rotated.split("/").at(-1)}"]`).last(),
    ).toBeVisible();
    await guest.screenshot({
      path: `test-results/shared-${info.project.name}.png`,
    });
  } finally {
    await guestContext.close();
  }
});
