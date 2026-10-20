import { test, expect } from "@playwright/test";
import { editSource } from "./hosted-helpers";
test.skip(
  process.env.SECURITY_E2E !== "1",
  "Requires compiled Caddy stack, not Vite",
);
test("compiled CSP permits the coding toy, fonts, audio and examples without script generation", async ({
  page,
}, info) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    (window as any).cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as any).cspViolations.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
      }),
    );
  });
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  await expect(
    page.getByRole("heading", { name: "Randomize USR", exact: true }),
  ).toBeVisible();
  await page.goto("/create");
  await editSource(
    page,
    'BORDER 3\nPAPER 0\nINK 7\nPRINT "SECURE MOON"\nBEEP 440,0.05',
  );
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.locator(".status")).toContainText("Finished.");
  expect(
    (await (await page.request.get("/api/v1/analytics/config")).json()).enabled,
  ).toBe(false);
  await expect(page.locator(".usage-control")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("randusr-usage-choice")),
  ).toBeNull();
  expect(await page.evaluate(() => document.fonts.check('18px "Victor Mono"'))).toBe(
    true,
  );
  expect(await page.evaluate(() => (window as any).cspViolations)).toEqual([]);
  const api = await page.request.get("/api/v1/limits");
  expect(api.ok()).toBe(true);
  expect((await api.json()).autosavesPerMinute).toBe(120);
  const privatePage = await page.request.get("/admin");
  expect(privatePage.headers()["x-robots-tag"]).toContain("noindex");
  await page.goto("/examples/tunnel");
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "■ STOP", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "■ STOP", exact: true }).click();
  expect(await page.evaluate(() => (window as any).cspViolations)).toEqual([]);
  await page.screenshot({
    path: `test-results/security-compiled-${info.project.name}.png`,
  });
});
