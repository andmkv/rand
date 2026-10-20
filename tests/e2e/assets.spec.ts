import { test, expect } from "@playwright/test";
import { appOrigin, createVerifiedUser } from "./hosted-helpers";

test("guest imports a self-contained sprite package and runs it with legacy sprites", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/create");
  const raw = JSON.stringify({
    format: "randusr",
    version: 2,
    title: "Portable hero",
    instructions: "",
    sourceCode: 'CLS\nCAT = SPAWN("cat",40,40)\nHERO = SPAWN("@hero",10,20)',
    mode: "sandbox",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: null,
    assetManifest: {
      version: 1,
      sprites: [
        {
          type: "sprite",
          alias: "@hero",
          name: "Hero",
          sprite: {
            format: "randusr.indexed-sprite",
            version: 1,
            width: 2,
            height: 2,
            pixels: [0, 1, 1, 0],
            palette: [15, 4],
            transparentIndex: 0,
          },
        },
      ],
    },
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "hero.randusr",
    mimeType: "application/json",
    buffer: Buffer.from(raw, "utf8"),
  });
  await expect(page.locator(".cm-content")).toContainText('SPAWN("@hero",10,20)');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished.");
  const pixel = () =>
    page.locator("canvas").evaluate((element) => {
      const [red, green, blue] = (element as HTMLCanvasElement)
        .getContext("2d")!
        .getImageData(10, 19, 1, 1).data;
      return `${red},${green},${blue}`;
    });
  await expect.poll(pixel).toBe("0,191,0");
});

test("anonymous guest imports and runs a portable pinned SFX recipe", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/create");
  const now = new Date().toISOString();
  const raw = JSON.stringify({
    format: "randusr",
    version: 2,
    title: "Portable sound",
    instructions: "",
    sourceCode: 'SOUND "@portable-laser"',
    mode: "sandbox",
    createdAt: now,
    updatedAt: now,
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: null,
    assetManifest: {
      version: 1,
      sprites: [],
      sounds: [{
        type: "sfx",
        alias: "@portable-laser",
        name: "Portable laser",
        recipe: {
          format: "randusr.sfx",
          version: 1,
          waveform: "sawtooth",
          pulseWidth: 0.5,
          noiseAmount: 0,
          volume: 0.5,
          envelope: { attackMs: 0, decayMs: 0, sustainLevel: 1, releaseMs: 0 },
          startFrequencyHz: 1000,
          endFrequencyHz: 180,
          durationMs: 120,
        },
      }],
    },
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "portable-sound.randusr",
    mimeType: "application/json",
    buffer: Buffer.from(raw, "utf8"),
  });
  await expect(page.locator(".cm-content")).toContainText('SOUND "@portable-laser"');
  await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finished.");
});

test("guest imports and reloads a self-contained looping animation", async ({ page }) => {
  test.setTimeout(20000);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/create");
  const now = new Date().toISOString();
  const raw = JSON.stringify({
    format: "randusr",
    version: 2,
    title: "Animated guest sprite",
    instructions: "",
    sourceCode: 'HERO = SPAWN("@walker",80,120)',
    mode: "sandbox",
    createdAt: now,
    updatedAt: now,
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: null,
    assetManifest: {
      version: 1,
      sprites: [{
        type: "sprite",
        alias: "@walker",
        name: "Walker",
        sprite: {
          format: "randusr.animated-sprite",
          version: 1,
          width: 2,
          height: 2,
          frames: [[0, 0, 0, 0], [1, 1, 1, 1]],
          palette: [15, 4],
          transparentIndex: null,
          fps: 2,
          loop: true,
        },
      }],
    },
  });
  const importFile = () => page.locator("input[type=file]").setInputFiles({
    name: "walker.randusr",
    mimeType: "application/json",
    buffer: Buffer.from(raw, "utf8"),
  });
  await importFile();
  const pixel = () => page.locator("canvas").first().evaluate((element) => {
    const [red, green, blue] = (element as HTMLCanvasElement)
      .getContext("2d")!
        .getImageData(79, 119, 1, 1).data;
    return `${red},${green},${blue}`;
  });
  const run = async () => {
    await page.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Finished.");
    const frameWait = { timeout: 10_000, intervals: [25, 50, 100] };
    await expect.poll(pixel, frameWait).toBe("255,255,255");
    await expect.poll(pixel, frameWait).toBe("0,191,0");
  };
  await run();
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText('SPAWN("@walker",80,120)');
  const loaded = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("randomize-usr.project.v1")!).assetManifest.sprites[0].sprite,
  );
  expect(loaded.frames).toEqual([[0, 0, 0, 0], [1, 1, 1, 1]]);
  await run();
});

test("verified owner publishes a pinned animation that a guest can play without private IDs", async ({
  page,
  browser,
}, info) => {
  test.skip(process.env.HOSTED_E2E !== "1", "Requires disposable PostgreSQL API");
  test.setTimeout(60000);
  await createVerifiedUser(
    page,
    `asset-${info.project.name}-${Date.now()}@example.invalid`,
  );
  const csrfResponse = await page.request.get("/api/v1/auth/csrf");
  const csrf = (await csrfResponse.json()).token as string;
  const writeHeaders = { origin: appOrigin, "x-csrf-token": csrf };
  const sprite = {
    format: "randusr.animated-sprite",
    version: 1,
    width: 2,
    height: 2,
    frames: [[0, 0, 0, 0], [1, 1, 1, 1]],
    palette: [15, 4],
    transparentIndex: null,
    fps: 2,
    loop: true,
  };
  const assetResponse = await page.request.post("/api/v1/assets", {
    data: { name: "E2E hero", sprite },
    headers: writeHeaders,
  });
  expect(assetResponse.status()).toBe(200);
  const asset = await assetResponse.json();
  const now = new Date().toISOString();
  const projectResponse = await page.request.post("/api/v1/projects", {
    data: {
      snapshot: {
        format: "randusr",
        version: 2,
        title: "Published sprite",
        instructions: "",
        sourceCode: 'CLS\nHERO = SPAWN("@e2e-hero",10,20)',
        mode: "sandbox",
        createdAt: now,
        updatedAt: now,
        storyId: "tower",
        sceneId: 0,
        unlocked: 0,
        exampleId: null,
        assetManifest: {
          version: 1,
          sprites: [{
            type: "sprite",
            alias: asset.alias,
            name: asset.name,
            assetId: asset.id,
            versionId: asset.selectedVersion.id,
            version: asset.selectedVersion.number,
            sprite: asset.sprite,
          }],
        },
      },
    },
    headers: writeHeaders,
  });
  expect(projectResponse.status()).toBe(200);
  const project = await projectResponse.json();
  const shareResponse = await page.request.post(
    `/api/v1/projects/${project.id}/share`,
    {
      data: { version: project.version, visibility: "public", title: project.title },
      headers: writeHeaders,
    },
  );
  expect(shareResponse.status()).toBe(200);
  const share = await shareResponse.json();
  const changedAnimation = {
    ...sprite,
    frames: [...sprite.frames].reverse(),
    fps: 12,
  };
  const nextVersion = await page.request.post(`/api/v1/assets/${asset.id}/versions`, {
    data: { baseVersion: 1, sprite: changedAnimation },
    headers: writeHeaders,
  });
  expect(nextVersion.status()).toBe(200);
  const publicResponse = await page.request.get(
    `/api/v1/shared/${share.shortCode}`,
  );
  expect(publicResponse.status()).toBe(200);
  const publicProject = await publicResponse.json();
  const publicBinding = publicProject.snapshot.assetManifest.sprites[0];
  expect(publicBinding.sprite).toEqual(sprite);
  expect(publicBinding).not.toHaveProperty("assetId");
  expect(publicBinding).not.toHaveProperty("versionId");

  const secondAccountContext = await browser.newContext();
  try {
    const secondAccount = await secondAccountContext.newPage();
    await createVerifiedUser(
      secondAccount,
      `asset-other-${info.project.name}-${Date.now()}@example.invalid`,
    );
    const privateAsset = await secondAccount.request.get(
      `/api/v1/assets/${asset.id}`,
    );
    expect(privateAsset.status()).toBe(404);
    const secondLibrary = await secondAccount.request.get("/api/v1/assets");
    expect(secondLibrary.status()).toBe(200);
    expect((await secondLibrary.json()).assets).toEqual([]);
  } finally {
    await secondAccountContext.close();
  }

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(`${appOrigin}/p/${share.shortCode}`);
    await expect(guest.locator(".cm-content")).toContainText(
      'SPAWN("@e2e-hero",10,20)',
    );
    await guest.getByRole("button", { name: "▶ RUN", exact: true }).click();
    await expect(guest.getByRole("status")).toContainText("Finished.");
    const pixel = () =>
      guest.locator("canvas").evaluate((element) => {
        const [red, green, blue] = (element as HTMLCanvasElement)
          .getContext("2d")!
          .getImageData(9, 19, 1, 1).data;
        return `${red},${green},${blue}`;
      });
    const frameWait = { timeout: 10_000, intervals: [25, 50, 100] };
    await expect.poll(pixel, frameWait).toBe("255,255,255");
    await expect.poll(pixel, frameWait).toBe("0,191,0");
  } finally {
    await guestContext.close();
  }
});
