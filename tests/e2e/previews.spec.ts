import { openMore, openShareDetails } from "./more";
import { test, expect } from "@playwright/test";
import { appOrigin, createVerifiedUser, editSource } from "./hosted-helpers";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
test.skip(
  process.env.HOSTED_E2E !== "1",
  "Requires disposable fake-mail hosted API",
);
function pngHash(png: Buffer) {
  let colors: Buffer = Buffer.alloc(0);
  const idat: Buffer[] = [];
  expect(png.readUInt32BE(16)).toBe(256);
  expect(png.readUInt32BE(20)).toBe(192);
  for (let o = 8; o < png.length;) {
    const n = png.readUInt32BE(o),
      kind = png.toString("ascii", o + 4, o + 8);
    if (kind === "PLTE") colors = png.subarray(o + 8, o + 8 + n);
    if (kind === "IDAT") idat.push(png.subarray(o + 8, o + 8 + n));
    o += 12 + n;
  }
  const rows = inflateSync(Buffer.concat(idat)),
    rgba = Buffer.alloc(256 * 192 * 4);
  for (let y = 0; y < 192; y++)
    for (let x = 0; x < 256; x++) {
      const p = rows[y * 257 + x + 1] * 3,
        i = (y * 256 + x) * 4;
      rgba[i] = colors[p];
      rgba[i + 1] = colors[p + 1];
      rgba[i + 2] = colors[p + 2];
      rgba[i + 3] = 255;
    }
  return createHash("sha256").update(rgba).digest("hex");
}
async function screenHash(page: import("@playwright/test").Page) {
  return page.locator("canvas").evaluate(async (canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, 256, 192).data;
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  });
}
test("actual SCREEN preview stays private until publish, shows in library/gallery without running source, and missing images fall back", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const title = `Preview ${info.project.name} ${Date.now()}`;
  await createVerifiedUser(
    page,
    `previews-${info.project.name}-${Date.now()}@example.invalid`,
  );
  await page.getByLabel("Project title", { exact: true }).fill(title);
  await editSource(
    page,
    'PAPER 3\nCLS\nCAT = SPAWN("cat",128,96)\nTEXT 12,160,"MOON"',
  );
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.locator(".status")).toContainText("Finished.");
  const expected = await screenHash(page);
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await openMore(page);
  await page
    .getByRole("button", { name: "Update preview", exact: true })
    .click();
  await expect(
    page.getByText("Preview updated", { exact: true }),
  ).toBeVisible();
  expect(await screenHash(page)).toBe(expected);
  const summary = (await (await page.request.get("/api/v1/projects")).json())
    .projects[0];
  const project = await (
    await page.request.get(`/api/v1/projects/${summary.id}`)
  ).json();
  expect(
    pngHash(await (await page.request.get(project.previewUrl)).body()),
  ).toBe(expected);
  await openMore(page);
  await page.getByRole("button", { name: "My projects", exact: true }).click();
  const library = page.getByRole("dialog", {
      name: "My projects",
      exact: true,
    }),
    thumbnail = library.getByRole("img", { name: title, exact: true });
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() => thumbnail.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBe(256);
  expect(
    await thumbnail.evaluate((i) => getComputedStyle(i).imageRendering),
  ).toBe("pixelated");
  await page.screenshot({
    path: `test-results/preview-library-${info.project.name}.png`,
  });
  await library.getByRole("button", { name: "Close", exact: true }).click();
  await openMore(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  let share = page.getByRole("dialog", { name: "Share", exact: true });
  await expect(share).toContainText("current SCREEN frame");
  await share.locator("input[name=visibility][value=public]")
    .check({ force: true });
  await openShareDetails(share);
  await share
    .getByLabel("Short description", { exact: true })
    .fill("A purple moon cat");
  await share.getByLabel("Art", { exact: true }).check();
  await share
    .getByRole("button", { name: "Save sharing settings", exact: true })
    .click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  await share.getByRole("button", { name: "Close", exact: true }).click();
  const published = await (
    await page.request.get(`/api/v1/shared/${project.shortCode}`)
  ).json();
  expect(
    pngHash(await (await page.request.get(published.previewUrl)).body()),
  ).toBe(expected);
  await editSource(page, 'PAPER 4\nCLS\nTEXT 12,160,"PRIVATE CHANGE"');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.locator(".status")).toContainText("Finished.");
  await expect(page.locator(".cloud-status")).toHaveText("Saved to cloud");
  await openMore(page);
  await page
    .getByRole("button", { name: "Update preview", exact: true })
    .click();
  expect(
    pngHash(await (await page.request.get(published.previewUrl)).body()),
  ).toBe(expected);
  const context = await browser.newContext();
  const guest = await context.newPage();
  let sourceFetched = false;
  guest.on("request", (r) => {
    if (r.url().endsWith(`/api/v1/shared/${project.shortCode}`))
      sourceFetched = true;
  });
  try {
    expect(
      (
        await guest.request.get(`${appOrigin}${project.previewUrl}`)
      ).status(),
    ).toBe(401);
    await guest.goto(`${appOrigin}/`);
    const card = guest.locator(".gallery-card").filter({ hasText: title }),
      image = card.getByRole("img", { name: title, exact: true });
    await card.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBe(256);
    await expect(card.locator("canvas")).toHaveCount(0);
    expect(sourceFetched).toBe(false);
    await guest.screenshot({
      path: `test-results/preview-gallery-${info.project.name}.png`,
    });
    await guest.route(`${appOrigin}${published.previewUrl}`, (r) =>
      r.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"error":{"code":"NOT_FOUND"}}',
      }),
    );
    await guest.reload();
    await guest
      .locator(".gallery-card")
      .filter({ hasText: title })
      .scrollIntoViewIfNeeded();
    await expect(
      guest
        .locator(".gallery-card")
        .filter({ hasText: title })
        .locator("svg.gallery-preview"),
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
  await openMore(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  share = page.getByRole("dialog", { name: "Share", exact: true });
  await share.locator("input[name=visibility][value=private]")
    .check({ force: true });
  await share
    .getByRole("button", { name: "Save sharing settings", exact: true })
    .click();
  await expect(share.getByRole("status")).toContainText("Sharing updated");
  await share.getByRole("button", { name: "Close", exact: true }).click();
  expect((await page.request.get(published.previewUrl)).status()).toBe(404);
  await openMore(page);
  await page.getByRole("button", { name: "My projects", exact: true }).click();
  await expect(page.locator(".library-card img")).toHaveCount(1);
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .token;
  await page.request.post("/api/v1/auth/logout", {
    headers: { origin: appOrigin, "x-csrf-token": csrf },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".library-card img")).toHaveCount(0);
});
