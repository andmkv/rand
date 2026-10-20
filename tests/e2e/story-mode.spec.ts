import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createVerifiedUser } from "./hosted-helpers";
import { openMore } from "./more";

const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const projectKey = "randomize-usr.project.v1";
const linkKey = "randomize-usr.cloud-link.v1";

const modeButton = (page: Page, name: "STORY" | "Sandbox") =>
  page.getByRole("button", { name, exact: true });

async function storedMode(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null")?.mode,
    projectKey,
  );
}

async function setCode(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).sourceCode,
        projectKey,
      ),
    )
    .toBe(code);
}

async function startAccount(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  // The disposable harness seeds this verified fixture account; no production account is used.
  await createVerifiedUser(page, "admin@example.invalid");
  await page.waitForSelector(".cm-content");
  return { context, page };
}

async function saveSandboxCopy(page: Page, code: string) {
  await modeButton(page, "Sandbox").click();
  await setCode(page, code);
  // Keep Story progress in the saved snapshot: chapter 3 of 9, five unlocked.
  await page.evaluate(
    ({ key }) => {
      const project = JSON.parse(localStorage.getItem(key)!);
      localStorage.setItem(
        key,
        JSON.stringify({ ...project, sceneId: 2, unlocked: 4 }),
      );
    },
    { key: projectKey },
  );
  await page.reload();
  await page.waitForSelector(".cm-content");
  await expect(page.locator(".cm-content")).toContainText("STORY KEEP");
  await page.getByRole("button", { name: "Save to cloud", exact: true }).click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    linkKey,
  ) as Promise<{ id: string; ownerId: string }>;
}

test.describe("STORY keeps priority over a Sandbox program", () => {
  test("guest: Sandbox example, STORY click, reload and back to Sandbox", async ({
    page,
  }) => {
    await page.goto("/create?mode=story");
    await expect(page.locator(".story-panel")).toBeVisible();
    await expect(modeButton(page, "STORY")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await modeButton(page, "Sandbox").click();
    await page.getByRole("button", { name: "EXAMPLES", exact: true }).click();
    await page
      .locator(".card")
      .first()
      .getByRole("button", { name: "Load", exact: true })
      .click();
    await expect(page.locator(".sandbox-layout")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("ALIEN ATTACK");

    await modeButton(page, "STORY").click();
    await expect(page.locator(".story-panel")).toBeVisible();
    await expect(page.locator(".story h2")).toHaveText("Darkness");
    await expect(modeButton(page, "STORY")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => storedMode(page)).toBe("story");

    // The Story screen is mode state, not a one-off flash: a refresh keeps it.
    await page.reload();
    await expect(page.locator(".story-panel")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("ALIEN ATTACK");

    // Sandbox keeps its program and still switches back to Story.
    await modeButton(page, "Sandbox").click();
    await expect(page.locator(".sandbox-layout")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("ALIEN ATTACK");
    await modeButton(page, "STORY").click();
    await expect(page.locator(".story-panel")).toBeVisible();

    // Back/Forward restore the persisted mode, not a blank editor.
    await page.goto("/");
    await page.goBack();
    await expect(page.locator(".story-panel")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("ALIEN ATTACK");
    await page.goForward();
    await expect(page.locator('a[href="/create?mode=story"]')).toBeVisible();
  });

  test.describe("narrow RU", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("STORY after a Sandbox program at 390px in Russian", async ({
      page,
    }) => {
      await page.goto("/create?mode=sandbox");
      await openMore(page);
      await page.getByLabel("Language").selectOption("ru");
      await expect(
        page.getByRole("button", { name: "Песочница", exact: true }),
      ).toBeVisible();
      await setCode(page, 'INK 2\nTEXT 20,20,"ПЕСОЧНИЦА"');
      await page.getByRole("button", { name: "ИСТОРИЯ", exact: true }).click();
      await expect(page.locator(".story-panel")).toBeVisible();
      await expect(page.locator(".cm-content")).toContainText("ПЕСОЧНИЦА");
      await expect(
        page.getByRole("button", { name: "ИСТОРИЯ", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
});

test.describe("hosted: an async project load cannot take STORY away", () => {
  test.skip(
    process.env.HOSTED_E2E !== "1",
    "Requires the disposable server/tests/serve.ts API",
  );

  test("explicit STORY wins over the opened cloud snapshot", async ({
    browser,
  }) => {
    const { context, page } = await startAccount(browser);
    const code = 'INK 2\nTEXT 20,20,"STORY KEEP"\n';
    const link = await saveSandboxCopy(page, code);

    // The deep link asks for the project and STORY; the snapshot says Sandbox.
    const storyAutosave = page.waitForResponse((response) => {
      if (
        response.request().method() !== "PUT" ||
        !response.url().includes(`/projects/${link.id}`)
      )
        return false;
      const body = JSON.parse(response.request().postData() ?? "{}");
      return body?.snapshot?.mode === "story";
    });
    await page.goto(origin + `/create?project=${link.id}&mode=story`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".story-panel")).toBeVisible({ timeout: 15000 });
    await expect(modeButton(page, "STORY")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".cm-content")).toContainText("STORY KEEP");
    // Story progress and chapter selection come from the opened project.
    await expect(page.locator(".story .eyebrow")).toContainText("3 / 9");
    const chapters = page.locator(".story nav button");
    await expect(chapters.nth(4)).toBeEnabled();
    await expect(chapters.nth(5)).toBeDisabled();
    await expect.poll(() => storedMode(page)).toBe("story");

    // The autosave keeps STORY after a plain refresh.
    await storyAutosave;
    await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
    await page.reload();
    await expect(page.locator(".story-panel")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("STORY KEEP");

    // Sandbox still holds the same program; STORY is one click away.
    await modeButton(page, "Sandbox").click();
    await expect(page.locator(".sandbox-layout")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("STORY KEEP");
    await modeButton(page, "STORY").click();
    await expect(page.locator(".story-panel")).toBeVisible();
    await context.close();
  });

  test("STORY clicked while a deep link is still restoring is not reverted", async ({
    browser,
  }) => {
    const { context, page } = await startAccount(browser);
    const code = 'INK 2\nTEXT 20,20,"STORY KEEP"\n';
    const link = await saveSandboxCopy(page, code);
    expect(await storedMode(page)).toBe("sandbox");

    // A slow session check and a slow project fetch reproduce the real race:
    // the child reaches STORY while the editor is still restoring the project.
    await page.route("**/api/v1/session", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });
    await page.route(`**/api/v1/projects/${link.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    const sessionDone = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/session") &&
        response.status() === 200,
    );
    await page.goto(origin + `/create?project=${link.id}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".cm-content");
    await expect(modeButton(page, "Sandbox")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await modeButton(page, "STORY").click();
    await expect(page.locator(".story-panel")).toBeVisible();

    // Let the delayed session and the automatic project restore finish.
    await sessionDone;
    const loading = page.locator(
      'dialog[aria-label="Opening cloud project…"]',
    );
    await expect(loading).toBeVisible({ timeout: 10000 });
    await expect(loading).toBeHidden({ timeout: 10000 });

    // The late load must not undo the explicit STORY choice.
    await expect(page.locator(".cm-content")).toContainText("STORY KEEP");
    await expect(page.locator(".story-panel")).toBeVisible();
    await expect(modeButton(page, "STORY")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => storedMode(page)).toBe("story");
    await context.close();
  });
});
