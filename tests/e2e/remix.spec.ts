import { openMore, openViewerMore } from "./more";
import { test, expect } from "@playwright/test";
import { createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable hosted API");
test("remix published source into a private cloud project without overwriting local work", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  await createVerifiedUser(
    page,
    `remix-owner-${info.project.name}-${Date.now()}@example.invalid`,
  );
  await page.getByLabel("Project title", { exact: true }).fill("Moon to remix");
  await editSource(page, 'PRINT "PUBLISHED MOON"');
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const original = (await (await page.request.get("/api/v1/projects")).json())
    .projects[0];
  await openMore(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share", exact: true });
  await share
    .locator("input[name=visibility][value=unlisted]")
    .check({ force: true });
  await share
    .getByRole("button", { name: "Save sharing settings", exact: true })
    .click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  const url = await share
    .getByLabel("Project link", { exact: true })
    .inputValue();
  await share.getByRole("button", { name: "Close", exact: true }).click();
  await editSource(page, 'PRINT "OWNERS SECRET DRAFT"');
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/v1/projects/${original.id}`)
          ).json()
        ).snapshot.sourceCode,
    )
    .toBe('PRINT "OWNERS SECRET DRAFT"');
  const context = await browser.newContext(),
    visitor = await context.newPage();
  try {
    await createVerifiedUser(
      visitor,
      `remix-visitor-${info.project.name}-${Date.now()}@example.invalid`,
    );
    await editSource(visitor, 'PRINT "VISITORS OWN LOCAL TOY"');
    await expect
      .poll(() =>
        visitor.evaluate(() =>
          localStorage.getItem("randomize-usr.project.v1"),
        ),
      )
      .toContain("VISITORS OWN LOCAL TOY");
    const local = await visitor.evaluate(() =>
      localStorage.getItem("randomize-usr.project.v1"),
    );
    await visitor.goto(url);
    await visitor
      .getByRole("button", { name: "Remix / Save a copy", exact: true })
      .click();
    await expect(
      visitor.locator(".viewer-info").getByRole("status"),
    ).toContainText("Your private copy is saved");
    expect(
      await visitor.evaluate(() =>
        localStorage.getItem("randomize-usr.project.v1"),
      ),
    ).toBe(local);
    const copy = (await (await visitor.request.get("/api/v1/projects")).json())
      .projects[0];
    expect(copy.visibility).toBe("private");
    expect(copy.id).not.toBe(original.id);
    visitor.once("dialog", (d) => d.accept());
    await visitor
      .getByRole("status")
      .getByRole("link", { name: "Open in editor", exact: true })
      .click();
    await expect(visitor.locator(".cm-content")).toContainText(
      "PUBLISHED MOON",
    );
    await expect(visitor.locator(".cm-content")).not.toContainText(
      "SECRET DRAFT",
    );
    await expect(visitor.locator(".cloud-status")).toHaveText("Saved to cloud");
    await editSource(visitor, 'PRINT "MY OWN REMIX"');
    await expect
      .poll(
        async () =>
          (
            await (
              await visitor.request.get(`/api/v1/projects/${copy.id}`)
            ).json()
          ).snapshot.sourceCode,
      )
      .toBe('PRINT "MY OWN REMIX"');
    expect(
      (await (await page.request.get(`/api/v1/projects/${original.id}`)).json())
        .snapshot.sourceCode,
    ).toBe('PRINT "OWNERS SECRET DRAFT"');
    await page.goto(url);
    await expect(
      page.getByRole("link", { name: "Edit my draft", exact: true }),
    ).toBeVisible();
    await openViewerMore(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await share
      .locator("input[name=visibility][value=private]")
    .check({ force: true });
    await share
      .getByRole("button", { name: "Save sharing settings", exact: true })
      .click();
    await expect
      .poll(async () =>
        (
          await visitor.request.get(`/api/v1/shared/${url.split("/").at(-1)}`)
        ).status(),
      )
      .toBe(404);
  } finally {
    await context.close();
  }
});
test("admin curates a publication then blocks it with a recorded reason from its viewer", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "One configured bootstrap admin in the disposable DB",
  );
  test.setTimeout(60000);
  await createVerifiedUser(page, "admin@example.invalid");
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Admin curation moon");
  await editSource(page, 'PRINT "CURATED MOON"');
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const project = (await (await page.request.get("/api/v1/projects")).json())
    .projects[0];
  await openMore(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share", exact: true });
  await share.locator("input[name=visibility][value=public]")
    .check({ force: true });
  await share
    .getByRole("button", { name: "Save sharing settings", exact: true })
    .click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  const url = await share
    .getByLabel("Project link", { exact: true })
    .inputValue();
  await page.goto("/");
  await page
    .getByLabel("Find a project", { exact: true })
    .fill("Admin curation moon");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const card = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Admin curation moon",
      exact: true,
    }),
  });
  await card
    .getByRole("button", { name: "Feature this version", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Remove from featured", exact: true }),
  ).toBeVisible();
  await page.goto(url);
  await openViewerMore(page);
  await page
    .getByRole("button", { name: "Moderate project", exact: true })
    .click();
  const moderation = page.getByRole("dialog", {
    name: "Moderate project",
    exact: true,
  });
  await moderation
    .getByLabel("Reason for moderation (recorded privately)", { exact: true })
    .fill("Browser fixture review");
  page.once("dialog", (d) => d.accept());
  await moderation
    .getByRole("button", { name: "Block shared project", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "This project isn’t available.",
  );
  expect(
    (await (await page.request.get(`/api/v1/projects/${project.id}`)).json())
      .snapshot.sourceCode,
  ).toBe('PRINT "CURATED MOON"');
});
