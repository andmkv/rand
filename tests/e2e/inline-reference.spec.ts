import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { content, t, type Locale } from "../../src/i18n";
import { spells } from "../../src/content/spellbook";

const CODE = [
  "INK 6",
  "CIRCLE 128,96,30",
  "FOR N = 1 TO 3",
  "  PLOT N,N",
  "NEXT N",
  "R = RND(1,6)",
  "REM CIRCLE in a comment",
  'TEXT 1,1,"CIRCLE in a string"',
  'CAT = SPAWN("cat",70,120)',
  "CAT.MOVE_BY 2,0",
  "IF 5 >= 3 AND 2 <> 4 OR NOT FALSE THEN",
  '  PRINT "OK"',
  "END IF",
].join("\n");

const key = "randomize-usr.project.v1";
const source = (page: Page) =>
  page.evaluate((storageKey) => {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored).sourceCode : "";
  }, key);

const dialog = (page: Page) => page.locator(".inline-reference");

async function edit(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
  await expect.poll(() => source(page)).toBe(code);
  // Let the last input transaction settle before a mouse selection follows.
  await page.waitForTimeout(250);
}

async function tokenPoint(
  page: Page,
  line: number,
  token: string,
  occurrence = 0,
) {
  return page.evaluate(
    ({ line, token, occurrence }) => {
      const element = document.querySelectorAll(".cm-line")[line];
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Array<{ node: Node; start: number; end: number }> = [];
      let full = "";
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        nodes.push({
          node,
          start: full.length,
          end: full.length + text.length,
        });
        full += text;
      }
      let index = full.indexOf(token);
      for (let seen = 0; index >= 0; seen++) {
        if (seen === occurrence) {
          const startNode = nodes.find(
            (entry) => entry.start <= index && index < entry.end,
          );
          const endIndex = index + token.length;
          const endNode = nodes.find(
            (entry) => entry.start < endIndex && endIndex <= entry.end,
          );
          if (!startNode || !endNode) return null;
          const range = document.createRange();
          range.setStart(startNode.node, index - startNode.start);
          range.setEnd(endNode.node, endIndex - endNode.start);
          const rect = range.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }
        index = full.indexOf(token, index + token.length);
      }
      return null;
    },
    { line, token, occurrence },
  );
}

async function doubleClickToken(
  page: Page,
  line: number,
  token: string,
  occurrence = 0,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator(".cm-line").nth(line).scrollIntoViewIfNeeded();
    const point = await tokenPoint(page, line, token, occurrence);
    if (!point) throw new Error(`Token ${token} not found on line ${line}`);
    await page.mouse.dblclick(point.x, point.y);
    const selected = await page.evaluate(
      () => document.getSelection()?.toString() ?? "",
    );
    if (selected.length > 0) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Double-click did not select ${token} on line ${line}`);
}

async function selectTokenWithKeyboard(
  page: Page,
  code: string,
  line: number,
  token: string,
) {
  const lineText = code.split("\n")[line];
  const start = lineText.indexOf(token);
  if (start < 0) throw new Error(`Token ${token} not found on line ${line}`);
  await page.locator(".cm-line").nth(line).click();
  await page.keyboard.press("Home");
  for (let i = 0; i < start; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift");
  for (let i = 0; i < token.length; i++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
}

async function summaryFor(id: string, locale: Locale) {
  return content("spells", spells, locale).find((spell) => spell.id === id)!
    .summary;
}

test.beforeAll(() => {
  mkdirSync("test-results/inline-reference", { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto("/create");
});

test("mouse selection opens the matching Spellbook card for acceptance tokens", async ({
  page,
}) => {
  await edit(page, CODE);
  const cases: Array<[number, string, string, string]> = [
    [1, "CIRCLE", "CIRCLE", "circle"],
    [2, "FOR", "FOR", "for"],
    [5, "RND", "RND", "rnd-random"],
    [8, "SPAWN", "SPAWN", "spawn"],
    [9, "MOVE_BY", ".MOVE_BY", "move-by"],
    [10, "AND", "AND", "and-or-not"],
    [10, ">=", ">=", "comparisons"],
  ];
  for (const [line, token, shown, spellId] of cases) {
    await doubleClickToken(page, line, token);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator(".reference-token")).toHaveText(shown);
    await expect(dialog(page).locator(".reference-summary")).toHaveText(
      await summaryFor(spellId, "en"),
    );
    await expect(dialog(page).locator(".reference-code")).not.toBeEmpty();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
      token,
    );
  }

  await doubleClickToken(page, 10, ">");
  await expect(dialog(page).locator(".reference-token")).toHaveText(">=");
  await page.keyboard.press("Escape");

  await doubleClickToken(page, 1, "IRCL");
  await expect(dialog(page).locator(".reference-token")).toHaveText("CIRCLE");
  await page.keyboard.press("Escape");

  await doubleClickToken(page, 9, "CAT.MOVE_BY");
  await expect(dialog(page).locator(".reference-token")).toHaveText(".MOVE_BY");
  await page.keyboard.press("Escape");
});

test("words in comments and quoted strings never open a reference", async ({
  page,
}) => {
  await edit(page, CODE);
  for (const line of [6, 7]) {
    await doubleClickToken(page, line, "CIRCLE");
    await page.waitForTimeout(450);
    await expect(dialog(page)).toHaveCount(0);
  }
  await doubleClickToken(page, 7, '"CIRCLE in a string"');
  await page.waitForTimeout(450);
  await expect(dialog(page)).toHaveCount(0);
});

test("hover waits, never steals focus and ignores comments and strings", async ({
  page,
}) => {
  await edit(page, CODE);
  await page.mouse.move(10, 10);
  await page.locator(".cm-line").nth(1).scrollIntoViewIfNeeded();
  const circle = await tokenPoint(page, 1, "CIRCLE");
  await page.mouse.move(circle!.x, circle!.y);
  await expect(dialog(page)).toBeVisible({ timeout: 2000 });
  expect(
    await page.evaluate(() =>
      document.activeElement?.classList.contains("cm-content"),
    ),
  ).toBe(true);
  await page.mouse.move(10, 10);
  await expect(dialog(page)).toBeHidden({ timeout: 2000 });

  for (const [line, token] of [
    [6, "CIRCLE"],
    [7, "CIRCLE"],
    [1, "128"],
  ] as Array<[number, string]>) {
    await page.locator(".cm-line").nth(line).scrollIntoViewIfNeeded();
    const point = await tokenPoint(page, line, token);
    await page.mouse.move(point!.x, point!.y);
    await page.waitForTimeout(700);
    await expect(dialog(page)).toHaveCount(0);
  }
});

test("F1 is keyboard help; Tab stays inside; Escape returns focus and copy still works", async ({
  page,
}) => {
  await edit(page, CODE);
  await selectTokenWithKeyboard(page, CODE, 1, "CIRCLE");
  await expect(dialog(page)).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __copied: string }).__copied = "";
    document.addEventListener("copy", () => {
      (window as unknown as { __copied: string }).__copied =
        document.getSelection()?.toString() ?? "";
    });
  });
  await page.keyboard.press("ControlOrMeta+C");
  expect(
    await page.evaluate(
      () => (window as unknown as { __copied: string }).__copied,
    ),
  ).toBe("CIRCLE");
  await expect(dialog(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
    "CIRCLE",
  );

  await page.locator(".cm-line").nth(1).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("F1");
  await expect(dialog(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.closest(".inline-reference") !== null,
      ),
    )
    .toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => document.activeElement?.closest(".inline-reference") !== null,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.classList.contains("cm-content"),
      ),
    )
    .toBe(true);
});

test("Tab/Shift+Tab still indent while the helper is open or closed", async ({
  page,
}) => {
  await edit(page, CODE);
  await page.locator(".cm-content").press("ControlOrMeta+A");
  await page.waitForTimeout(300);
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect
    .poll(() => source(page))
    .toBe(
      CODE.split("\n")
        .map((line) => "  " + line)
        .join("\n"),
    );
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => source(page)).toBe(CODE);

  await selectTokenWithKeyboard(page, CODE, 1, "CIRCLE");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect.poll(() => source(page)).toContain("  CIRCLE 128,96,30");
  await page.waitForTimeout(550);
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(() => source(page)).toBe(CODE);
});

test("copy example, safe insert below and the Spellbook link work", async ({
  page,
}) => {
  await edit(page, CODE);
  await selectTokenWithKeyboard(page, CODE, 1, "CIRCLE");
  await expect(dialog(page)).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Copy example", exact: true })
    .click();
  await expect(dialog(page).locator(".reference-status")).toHaveText(
    "Example copied.",
  );

  await dialog(page)
    .getByRole("button", { name: "Insert example", exact: true })
    .click();
  await expect(dialog(page)).toContainText(
    "The example can replace your selected code",
  );
  await dialog(page)
    .getByRole("button", { name: "Insert below", exact: true })
    .click();
  await expect(dialog(page)).toBeHidden();
  await expect
    .poll(() => source(page))
    .toContain("CIRCLE 128,96,30\nINK 6\nCIRCLE 128,96,40");
  expect(await source(page)).toContain("CAT.MOVE_BY 2,0");
  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(() => source(page)).toBe(CODE);

  await selectTokenWithKeyboard(page, CODE, 1, "CIRCLE");
  await expect(dialog(page)).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Read more in Spellbook", exact: true })
    .click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator(".drawer.spellbook")).toBeVisible();
  await expect(page.locator('[data-spell-id="circle"]')).toBeVisible();
  await expect(
    page.locator('[data-spell-id="circle"]').getByRole("heading", {
      name: "CIRCLE",
      exact: true,
    }),
  ).toBeVisible();
});

for (const size of [
  { width: 1024, height: 768 },
  { width: 820, height: 874 },
]) {
  test(`reference flips and stays inside ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(size);
    await edit(page, CODE);
    await page.locator(".cm-line").nth(12).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("F1");
    await expect(dialog(page)).toBeVisible();
    const box = await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    if (info.project.name === "chromium")
      await page.screenshot({
        path: `test-results/inline-reference/en-${size.width}x${size.height}.png`,
      });
  });
}

for (const locale of ["en", "ru", "de", "ja"] as Locale[]) {
  test(`${locale}: localized reference content`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    if (locale !== "en") {
      await page.evaluate(
        (value) => localStorage.setItem("randomize-usr.locale", value),
        locale,
      );
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }
    await edit(page, CODE);
    await doubleClickToken(page, 1, "CIRCLE");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator(".reference-summary")).toHaveText(
      await summaryFor("circle", locale),
    );
    await expect(dialog(page).locator(".reference-kind")).toHaveText(
      t("referenceKindCommand", locale),
    );
    if (info.project.name === "chromium" && locale !== "en")
      await page.screenshot({
        path: `test-results/inline-reference/${locale}-1024x768.png`,
      });
  });
}
