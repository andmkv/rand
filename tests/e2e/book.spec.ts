/**
 * Handbook (/book) in a real browser. Guest only: no API, no account. The BASIC examples themselves are
 * executed by tests/book.test.ts; this file checks the reader: navigation, search, copy, the safe
 * "Open in Sandbox" flow, locale fallback, phone and tablet layout, keyboard use and link integrity.
 */
import { test, expect, type Page } from "@playwright/test";

const projectKey = "randomize-usr.project.v1";
const localeKey = "randomize-usr.locale";

async function offlineApi(page: Page) {
  // The handbook must work with no API at all.
  await page.route("**/api/**", (route) => route.abort());
}
async function setLocale(page: Page, locale: string) {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [localeKey, locale],
  );
}
async function noOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".book-page")!;
    return {
      doc: document.documentElement.scrollWidth <= innerWidth,
      page: root.scrollWidth <= root.clientWidth,
    };
  });
}
async function chapterSlugs(page: Page) {
  await page.goto("/book");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const links = page.locator(".home-part li > a");
  await expect(links.first()).toBeVisible();
  return (await links.evaluateAll((els) =>
    els.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.replace("/book/", "")),
  )) as string[];
}

test.beforeEach(async ({ page }) => {
  await offlineApi(page);
});

test("a guest reads the beginner path, chapters 1 to 6, with Next links and no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/book");
  await expect(page.getByRole("heading", { level: 1, name: "Handbook" })).toBeVisible();
  await page.getByRole("link", { name: /Getting started/ }).first().click();
  const titles = [
    "Getting started",
    "Your first picture",
    "Shapes and text",
    "Variables, numbers and words",
    "Loops: doing things again and again",
    "Decisions, questions and mistakes",
  ];
  for (let i = 0; i < titles.length; i++) {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(titles[i]);
    await expect(page.locator(".toc a.current")).toHaveAttribute("aria-current", "page");
    expect(await noOverflow(page)).toEqual({ doc: true, page: true });
    if (i < titles.length - 1) await page.getByRole("link", { name: /^Next/ }).click();
  }
  expect(errors).toEqual([]);
});

test("every chapter, English and Russian, has working internal links and anchors", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "link integrity is browser independent");
  test.setTimeout(120000);
  for (const locale of ["en", "ru"]) {
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [localeKey, locale]);
    const slugs = await chapterSlugs(page);
    expect(slugs.length).toBeGreaterThanOrEqual(25);
    const targets = new Set<string>();
    for (const slug of slugs) {
      await page.goto(`/book/${slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".chapter").first()).toHaveAttribute("lang", locale);
      const result = await page.evaluate(() => {
        const bad: string[] = [];
        const cross: string[] = [];
        for (const a of document.querySelectorAll<HTMLAnchorElement>(".book-main a[href], .book-side a[href]")) {
          const href = a.getAttribute("href")!;
          if (href.startsWith("#")) {
            if (!document.getElementById(decodeURIComponent(href.slice(1)))) bad.push(href);
          } else if (href.startsWith("/book/") && href.includes("#")) cross.push(href);
        }
        return { bad, cross };
      });
      expect(result.bad, `${locale}/${slug} broken same-page anchors`).toEqual([]);
      result.cross.forEach((c) => targets.add(c));
    }
    for (const target of targets) {
      await page.goto(target);
      const id = decodeURIComponent(target.split("#")[1]);
      await expect(page.locator(`[id="${id}"]`), `${locale} ${target}`).toHaveCount(1);
    }
  }
});

test("search finds a command and jumps to its reference section", async ({ page }) => {
  await page.goto("/book/getting-started");
  const search = page.getByRole("searchbox", { name: "Search the handbook" });
  await search.fill("FILLCIRCLE");
  const result = page.locator(".results a", { hasText: "drawing" }).first();
  await expect(result).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Results for" })).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/book\/ref-drawing#cmd-fillcircle/);
  await expect(page.locator("#cmd-fillcircle")).toBeInViewport();
  await page.goto("/book");
  await page.getByRole("searchbox").fill("zzzznotfound");
  await expect(page.getByText("Nothing found")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("searchbox")).toHaveValue("");
});

test("Copy puts the exact program on the clipboard", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { copied: string }).copied = "";
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => ((window as unknown as { copied: string }).copied = t) },
      configurable: true,
    });
  });
  await page.goto("/book/loops");
  const first = page.locator("figure.code-block.basic").first();
  const shown = await first.locator("pre").innerText();
  await first.getByRole("button", { name: "Copy" }).click();
  await expect(first.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(copied.trim()).toBe(shown.trim());
  expect(copied).toContain("FOR X = 0 TO 255 STEP 8");
});

test("Open in Sandbox opens the example directly when nothing needs protecting", async ({ page }) => {
  await page.goto("/book/loops");
  await page.evaluate(() => localStorage.removeItem("randomize-usr.project.v1"));
  await page.locator("figure.code-block.basic").first().getByRole("button", { name: "Open in Sandbox" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.locator(".cm-content")).toContainText("FOR X = 0 TO 255 STEP 8");
  const saved = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), projectKey))!);
  expect(saved.mode).toBe("sandbox");
});

test("Open in Sandbox never silently replaces the child's own code", async ({ page }) => {
  await page.goto("/book/loops");
  const mine = {
    format: "randusr",
    version: 2,
    title: "My precious game",
    instructions: "",
    sourceCode: 'PRINT "MY OWN PRECIOUS CODE"\nPRINT "SECOND LINE"',
    mode: "sandbox",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: null,
  };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [projectKey, JSON.stringify(mine)]);
  const open = page.locator("figure.code-block.basic").first().getByRole("button", { name: "Open in Sandbox" });
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("My precious game");
  await expect(dialog).toContainText("2 lines");
  // Cancel keeps everything as it was.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/book\/loops$/);
  expect(await page.evaluate((k) => localStorage.getItem(k), projectKey)).toBe(JSON.stringify(mine));
  // Escape cancels too.
  await open.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The person can save the current project to a file first.
  await open.click();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save current project as a file" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("My precious game.randusr");
  // Only an explicit choice replaces the code.
  await dialog.getByRole("button", { name: "Replace and open" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.locator(".cm-content")).toContainText("FOR X = 0 TO 255 STEP 8");
  await expect(page.locator(".cm-content")).not.toContainText("PRECIOUS");
});

test("examples that need pictures and sounds carry them into Sandbox", async ({ page }) => {
  await page.goto("/book/pixel-editor");
  await page.evaluate((k) => localStorage.removeItem(k), projectKey);
  const block = page.locator("figure.code-block.basic", { hasText: '@buddy' }).first();
  await expect(block.getByText("Comes with its own sample pictures and sounds")).toBeVisible();
  await block.getByRole("button", { name: "Open in Sandbox" }).click();
  await expect(page).toHaveURL(/\/create$/);
  const saved = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), projectKey))!);
  expect(saved.assetManifest.sprites.map((s: { alias: string }) => s.alias)).toEqual(["@buddy", "@gem"]);
  expect(saved.assetManifest.sounds.map((s: { alias: string }) => s.alias)).toEqual(["@zap", "@pluck"]);
});

test("Russian is a full edition; Japanese falls back to English honestly", async ({ page }) => {
  await setLocale(page, "ru");
  await page.goto("/book/loops");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Циклы: делать снова и снова");
  await expect(page.locator(".fallback")).toHaveCount(0);
  await expect(page.locator("article.chapter")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("button", { name: "Копировать" }).first()).toBeVisible();
  await page.goto("/book");
  await expect(page.locator(".home-part .fb")).toHaveCount(0);
});

test("other languages show the English text with a notice, and say which chapters are not translated", async ({ page }) => {
  await setLocale(page, "ja");
  await page.goto("/book/loops");
  const article = page.locator("article.chapter");
  await expect(article).toHaveAttribute("lang", "en");
  await expect(page.locator(".fallback")).toContainText("英語版");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Loops: doing things again and again");
  await expect(page.locator(".brand span")).toHaveText("ハンドブック");
  await page.goto("/book");
  await expect(page.locator(".fallback")).toContainText("30");
  await expect(page.locator(".home-part .fb").first()).toBeVisible();
});

for (const size of [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
]) {
  test(`readable at ${size.width}px: no sideways scrolling, contents collapse, tap targets`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const slug of ["", "getting-started", "ref-errors", "ref-drawing", "ref-assets", "glossary", "challenges", "saving-and-sharing"]) {
      await page.goto(`/book/${slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await noOverflow(page), `${slug} at ${size.width}`).toEqual({ doc: true, page: true });
    }
    await page.goto("/book/loops");
    if (size.width < 860) {
      const toggle = page.getByRole("button", { name: "Contents" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#book-toc")).toBeHidden();
      await toggle.click();
      await expect(page.locator("#book-toc")).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.locator("#book-toc").getByRole("link", { name: /Sprites/ }).click();
      await expect(page).toHaveURL(/\/book\/sprites$/);
    }
    const button = page.locator("figure.code-block.basic .code-actions button").first();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    // Long code scrolls inside its own box instead of the page.
    const pre = page.locator("figure.code-block pre").first();
    expect(await pre.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    await page.screenshot({ path: `test-results/book-${size.name}.png` });
  });
}

test("keyboard: skip link, search, contents and the dialog are reachable without a mouse", async ({ page, browserName }) => {
  await page.goto("/book/loops");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  // The first stop in the page is the skip link; it becomes visible on focus.
  await page.locator("a.skip").focus();
  await expect(page.locator("a.skip")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
  await page.getByRole("searchbox").focus();
  await page.keyboard.type("sound");
  await expect(page.locator(".results a").first()).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  // Code blocks can be scrolled and read with the keyboard.
  const pre = page.locator("figure.code-block pre").first();
  await pre.focus();
  await expect(pre).toBeFocused();
  // The sandbox dialog traps focus and Escape closes it.
  await page.evaluate(
    (k) =>
      localStorage.setItem(
        k,
        JSON.stringify({
          format: "randusr",
          version: 2,
          title: "Mine",
          instructions: "",
          sourceCode: "PRINT 1\nPRINT 2\nPRINT 3",
          mode: "sandbox",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          storyId: "tower",
          sceneId: 0,
          unlocked: 0,
          exampleId: null,
        }),
      ),
    projectKey,
  );
  await page.getByRole("searchbox").fill("");
  await page.locator("figure.code-block.basic").first().getByRole("button", { name: "Open in Sandbox" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  if (browserName !== "webkit") {
    // (Safari does not tab to buttons by default, so the focus trap is asserted in Chromium.)
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the whole handbook downloads as one Markdown file and prints as one document", async ({ page }) => {
  await page.goto("/book");
  const download = page.waitForEvent("download");
  await page.locator("#book-main").getByRole("button", { name: "Download as Markdown" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("randomize-usr-handbook-en.md");
  const path = await file.path();
  const text = (await import("node:fs")).readFileSync(path!, "utf8");
  expect(text).toContain("# Getting started");
  expect(text).toContain("### `CIRCLE` {#cmd-circle}");
  expect(text.length).toBeGreaterThan(150000);
  await page.goto("/book/print");
  await expect(page.locator("article.print-chapter")).toHaveCount(30);
  await expect(page.locator("details.hint[open]").first()).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".book-header")).toBeHidden();
  await expect(page.locator(".code-actions")).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".book-page")!).overflow)).toBe("visible");
});

test("the handbook is reachable from the home page and from the Spellbook", async ({ page }) => {
  await page.route("**/api/v1/gallery?*", (route) => route.fulfill({ json: { projects: [], nextCursor: null } }));
  await page.goto("/");
  await page.getByRole("link", { name: "Handbook" }).first().click();
  await expect(page).toHaveURL(/\/book$/);
  await page.goto("/create?mode=sandbox");
  await page.getByRole("button", { name: "SPELLBOOK", exact: true }).click();
  const link = page.locator("a.handbook-link");
  await expect(link).toHaveAttribute("href", "/book");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("unknown chapters say so politely", async ({ page }) => {
  await page.goto("/book/no-such-chapter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page does not exist.");
  await expect(page.locator("#book-main").getByRole("link", { name: "Handbook home" })).toBeVisible();
});
