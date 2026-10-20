import { openMore } from "./more";
import { test, expect } from "@playwright/test";
import { appOrigin, createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable hosted API");
test("private cloud library, offline recovery, second browser and version conflict preserve both programs", async ({
  page,
  browser,
  context,
}, info) => {
  test.setTimeout(60000);
  await createVerifiedUser(
    page,
    `cloud-${info.project.name}-${Date.now()}@example.invalid`,
  );
  await page.getByLabel("Project title", { exact: true }).fill("My cloud toy");
  await editSource(page, 'PRINT "HELLO 日本語"');
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const list = await (await page.request.get("/api/v1/projects")).json();
  const id = list.projects[0].id;
  expect(list.projects[0].visibility).toBe("private");
  await page.route("**/api/v1/projects/*", (route) =>
    route.request().method() === "PUT"
      ? route.abort("failed")
      : route.continue(),
  );
  await editSource(page, 'PRINT "LOCAL AFTER NETWORK"');
  await expect(page.locator(".cloud-status")).toContainText(
    "Cloud unavailable",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("randomize-usr.project.v1")!)
          .sourceCode,
    ),
  ).toBe('PRINT "LOCAL AFTER NETWORK"');
  await page.unroute("**/api/v1/projects/*");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".cloud-status")).toHaveText(
    "Choose which version to keep",
  );
  await page
    .getByRole("button", { name: "Choose which version to keep", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry local changes", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  expect(
    (await (await page.request.get(`/api/v1/projects/${id}`)).json()).snapshot
      .sourceCode,
  ).toBe('PRINT "LOCAL AFTER NETWORK"');
  const secondContext = await browser.newContext({
    storageState: { cookies: await context.cookies(), origins: [] },
  });
  const second = await secondContext.newPage();
  try {
    await second.goto(`${appOrigin}/me/projects`);
    await expect(
      second.getByRole("dialog", { name: "My projects", exact: true }),
    ).toBeVisible();
    second.once("dialog", (d) => d.accept());
    await second.getByRole("button", { name: "Open", exact: true }).click();
    await expect(second.locator(".cm-content")).toContainText(
      "LOCAL AFTER NETWORK",
    );
    await editSource(second, 'PRINT "NEWER REMOTE PROGRAM"');
    await expect(second.locator(".cloud-status")).toHaveText("Saved to cloud");
    await expect
      .poll(
        async () =>
          (await (await second.request.get(`/api/v1/projects/${id}`)).json())
            .snapshot.sourceCode,
      )
      .toBe('PRINT "NEWER REMOTE PROGRAM"');
    await editSource(page, 'PRINT "MY CONFLICTING LOCAL PROGRAM"');
    await expect(page.locator(".cloud-status")).toHaveText(
      "Choose which version to keep",
    );
    await page
      .getByRole("button", {
        name: "Choose which version to keep",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Save a separate copy", exact: true })
      .click();
    await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
    expect(
      (await (await page.request.get(`/api/v1/projects/${id}`)).json()).snapshot
        .sourceCode,
    ).toBe('PRINT "NEWER REMOTE PROGRAM"');
    await page.reload();
    await expect(page.locator(".cm-content")).toContainText(
      "MY CONFLICTING LOCAL PROGRAM",
    );
    await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
    const copied = (
      await (await page.request.get("/api/v1/projects")).json()
    ).projects.find((p: any) => p.id !== id);
    await editSource(page, 'PRINT "EXPERIMENT"');
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/v1/projects/${copied.id}`)
            ).json()
          ).snapshot.sourceCode,
      )
      .toBe('PRINT "EXPERIMENT"');
    await openMore(page);
    await page.getByRole("button", { name: "History", exact: true }).click();
    const history = page.getByRole("dialog", { name: "History", exact: true });
    await history
      .getByRole("button", { name: "Version 1", exact: true })
      .click();
    await expect(history.getByLabel("Past code · read only")).toContainText(
      "MY CONFLICTING LOCAL PROGRAM",
    );
    page.once("dialog", (d) => d.accept());
    await history
      .getByRole("button", { name: "Restore this version", exact: true })
      .click();
    await expect(history.getByRole("status")).toContainText("Version restored");
    await expect(page.locator(".cm-content")).toContainText(
      "MY CONFLICTING LOCAL PROGRAM",
    );
    await history
      .getByRole("button", { name: "Version 1", exact: true })
      .click();
    await history
      .getByRole("button", { name: "Save a copy of this version", exact: true })
      .click();
    await expect(history.getByRole("status")).toContainText(
      "A private copy is ready",
    );
    await history.getByRole("button", { name: "Close", exact: true }).click();
    await openMore(page);
    await page
      .getByRole("button", { name: "My projects", exact: true })
      .click();
    await expect(page.locator(".library-card")).toHaveCount(3);
    await page.screenshot({
      path: `test-results/cloud-${info.project.name}.png`,
    });
  } finally {
    await secondContext.close();
  }
});
test("cancel a slow cloud opening and keep local edits when its late response arrives", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await createVerifiedUser(
    page,
    `slow-open-${info.project.name}-${Date.now()}@example.invalid`,
  );
  await editSource(page, 'PRINT "FIRST CLOUD PROJECT"');
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  const first = (await (await page.request.get("/api/v1/projects")).json())
    .projects[0];
  page.once("dialog", (d) => d.accept());
  await openMore(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await editSource(page, 'PRINT "MY CURRENT LOCAL PROJECT"');
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("randomize-usr.project.v1")),
    )
    .toContain("MY CURRENT LOCAL PROJECT");
  let release!: () => void, finished!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    done = new Promise<void>((r) => {
      finished = r;
    });
  await page.route(`**/api/v1/projects/${first.id}`, async (route) => {
    try {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    } catch {
      /* The browser aborts this request when opening is cancelled. */
    } finally {
      finished();
    }
  });
  page.once("dialog", (d) => d.accept());
  await page.goto(`/create?project=${first.id}`);
  const loading = page.getByRole("dialog", {
    name: "Opening cloud project…",
    exact: true,
  });
  await expect(loading).toBeVisible();
  await loading
    .getByRole("button", { name: "Keep current project", exact: true })
    .click();
  await expect(loading).not.toBeVisible();
  await editSource(page, 'PRINT "EDIT AFTER CANCELLING"');
  release();
  await done;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator(".cm-content")).toContainText(
    "EDIT AFTER CANCELLING",
  );
  expect(
    (await (await page.request.get(`/api/v1/projects/${first.id}`)).json())
      .snapshot.sourceCode,
  ).toBe('PRINT "FIRST CLOUD PROJECT"');
});
