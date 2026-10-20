import { expect, it } from "vitest";
import {
  assertAnimatedSprite,
  assertIndexedSprite,
  assertProjectAssetManifest,
  spriteSpawnSnippet,
  type AnimatedSpriteV1,
  type IndexedSpriteV1,
  type ProjectAssetManifestV1,
  type ProjectSoundBindingV1,
  type SfxRecipeV1,
} from "../shared/assets";
import { freshProject, parseProject, serializeProject } from "../src/project";
import { Engine } from "../src/runtime/engine";
import { World, palette } from "../src/runtime/world";
import { animationFrameIndex, animationIsPlaying } from "../src/runtime/animation";
import { vi } from "vitest";

const sprite: IndexedSpriteV1 = {
  format: "randusr.indexed-sprite",
  version: 1,
  width: 2,
  height: 2,
  pixels: [0, 1, 1, 0],
  palette: [15, 4],
  transparentIndex: 0,
};
const animation: AnimatedSpriteV1 = {
  format: "randusr.animated-sprite",
  version: 1,
  width: 1,
  height: 1,
  frames: [[0], [1], [2], [3]],
  palette: [1, 2, 3, 4],
  transparentIndex: null,
  fps: 4,
  loop: true,
};
const soundRecipe: SfxRecipeV1 = {
  format: "randusr.sfx",
  version: 1,
  waveform: "pulse",
  pulseWidth: 0.3,
  noiseAmount: 0.15,
  volume: 0.7,
  envelope: { attackMs: 4, decayMs: 25, sustainLevel: 0.2, releaseMs: 50 },
  startFrequencyHz: 1200,
  endFrequencyHz: 120,
  durationMs: 180,
};
const manifest = (
  binding: ProjectAssetManifestV1["sprites"][number],
): ProjectAssetManifestV1 => ({ version: 1, sprites: [binding] });

it("bounds indexed sprites and rejects broken planes, colors, and transparency", () => {
  expect(() => assertIndexedSprite(sprite)).not.toThrow();
  for (const bad of [
    { ...sprite, width: 65 },
    { ...sprite, pixels: [0, 1] },
    { ...sprite, pixels: [0, 2, 1, 0] },
    { ...sprite, palette: [15, 16] },
    { ...sprite, transparentIndex: 2 },
    { ...sprite, unexpected: "data" },
  ])
    expect(() => assertIndexedSprite(bad)).toThrow();
});

it("validates bounded animation frames and shared palette metadata", () => {
  expect(() => assertAnimatedSprite(animation)).not.toThrow();
  for (const bad of [
    { ...animation, fps: 0 },
    { ...animation, fps: 13 },
    { ...animation, frames: [] },
    { ...animation, frames: Array.from({ length: 33 }, () => [0]) },
    { ...animation, frames: [[0, 1]] },
    { ...animation, frames: [[4]] },
    { ...animation, palette: [1, 1] },
    { ...animation, transparentIndex: 4 },
    { ...animation, loop: 1 },
  ])
    expect(() => assertAnimatedSprite(bad)).toThrow();
  expect(() =>
    assertProjectAssetManifest(
      manifest({ type: "sprite", alias: "@oversized", name: "Oversized", sprite: {
        ...animation,
        width: 64,
        height: 64,
        frames: Array.from({ length: 32 }, () => Array(4096).fill(0)),
      } }),
    ),
  ).not.toThrow();
});

it("selects exact FPS frames deterministically and holds the final non-loop frame", () => {
  expect(animationFrameIndex(animation, 0)).toBe(0);
  expect(animationFrameIndex(animation, 249)).toBe(0);
  expect(animationFrameIndex(animation, 250)).toBe(1);
  expect(animationFrameIndex(animation, 750)).toBe(3);
  expect(animationFrameIndex(animation, 1000)).toBe(0);
  const once = { ...animation, loop: false };
  expect(animationFrameIndex(once, 999)).toBe(3);
  expect(animationIsPlaying(once, 749)).toBe(true);
  expect(animationIsPlaying(once, 750)).toBe(false);
  expect(animationIsPlaying(animation, 300000)).toBe(true);
});

it("keeps minimum and maximum runtime FPS deterministic with both loop modes", () => {
  const slowLoop = { ...animation, fps: 1, loop: true };
  expect(animationFrameIndex(slowLoop, 999)).toBe(0);
  expect(animationFrameIndex(slowLoop, 1000)).toBe(1);
  expect(animationFrameIndex(slowLoop, 3999)).toBe(3);
  expect(animationFrameIndex(slowLoop, 4000)).toBe(0);
  expect(animationIsPlaying(slowLoop, 60_000)).toBe(true);

  const fastOnce = { ...animation, fps: 12, loop: false };
  expect(animationFrameIndex(fastOnce, 83)).toBe(0);
  expect(animationFrameIndex(fastOnce, 84)).toBe(1);
  expect(animationFrameIndex(fastOnce, 250)).toBe(3);
  expect(animationFrameIndex(fastOnce, 60_000)).toBe(3);
  expect(animationIsPlaying(fastOnce, 249)).toBe(true);
  expect(animationIsPlaying(fastOnce, 250)).toBe(false);
});

it("rejects duplicate project aliases and emits a valid BASIC snippet", () => {
  const binding = {
    type: "sprite" as const,
    alias: "@hero",
    name: "Hero",
    sprite,
  };
  expect(() => assertProjectAssetManifest(manifest(binding))).not.toThrow();
  expect(() =>
    assertProjectAssetManifest({ version: 1, sprites: [binding, binding] }),
  ).toThrow();
  expect(spriteSpawnSnippet("@hero")).toBe('SPRITE = SPAWN("@hero",80,120)');
  expect(() => spriteSpawnSnippet("cat")).toThrow();
});

it("runs @aliases through the same bounded SPAWN runtime and draws indexed pixels", async () => {
  const world = new World();
  const e = new Engine(world);
  world.setProjectAssets(
    manifest({ type: "sprite", alias: "@hero", name: "Hero", sprite }),
  );
  await e.run('HERO = SPAWN("@hero",10,20)');
  expect(world.events).toContain("SPAWN:@hero");

  const fills: Array<{ x: number; y: number; color: string }> = [];
  const context = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    fillRect(x: number, y: number) {
      fills.push({ x, y, color: String(this.fillStyle) });
    },
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: () => {},
  };
  world.canvas = {
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  world.paint();
  expect(fills).toContainEqual({ x: 10, y: 19, color: palette[4] });
  expect(fills).toContainEqual({ x: 9, y: 20, color: palette[4] });
  expect(fills.some((fill) => fill.x === 9 && fill.y === 19)).toBe(false);
});

it("spawns a four-frame animation and freezes its current frame on STOP", async () => {
  let now = 0;
  const world = new World(undefined, () => now);
  world.setProjectAssets(
    manifest({ type: "sprite", alias: "@walk", name: "Walk", sprite: animation }),
  );
  const engine = new Engine(world);
  await engine.run('HERO = SPAWN("@walk",10,20)');
  const fills: Array<{ x: number; y: number; color: string }> = [];
  const context = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    fillRect(x: number, y: number) {
      fills.push({ x, y, color: String(this.fillStyle) });
    },
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: () => {},
  };
  world.canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const cycle = [palette[1], palette[2], palette[3], palette[4], palette[1]];
  for (let index = 0; index < cycle.length; index++) {
    now = index * 250;
    fills.length = 0;
    world.paint(now);
    expect(fills).toContainEqual({ x: 10, y: 20, color: cycle[index] });
  }
  const canvas = world.canvas;
  world.canvas = undefined;
  now = 1500;
  engine.stop();
  world.canvas = canvas;
  now = 2000;
  fills.length = 0;
  world.paint(now);
  expect(fills).toContainEqual({ x: 10, y: 20, color: palette[3] });
});

it("keeps one shared animation RAF over a simulated five-minute RUN and cancels it on STOP", async () => {
  let now = 0;
  let nextId = 0;
  let maxPending = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    pending.set(id, callback);
    maxPending = Math.max(maxPending, pending.size);
    return id;
  });
  const cancel = vi.fn((id: number) => pending.delete(id));
  const interval = vi.spyOn(globalThis, "setInterval");
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  try {
    const context = {
      imageSmoothingEnabled: true,
      fillStyle: "",
      fillRect() {},
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData() {},
    };
    const world = new World(
      { getContext: () => context } as unknown as HTMLCanvasElement,
      () => now,
    );
    world.setProjectAssets(
      manifest({ type: "sprite", alias: "@walk", name: "Walk", sprite: animation }),
    );
    const engine = new Engine(world);
    await engine.run('HERO = SPAWN("@walk",10,20)');
    for (let frame = 0; frame <= 120; frame++) {
      now = frame * 2500;
      const first = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
      expect(first).toBeDefined();
      pending.delete(first![0]);
      first![1](now);
      expect(pending.size).toBeLessThanOrEqual(1);
    }
    expect(world.objects).toHaveLength(1);
    expect(maxPending).toBe(1);
    expect(interval).not.toHaveBeenCalled();
    engine.stop();
    expect(pending.size).toBe(1); // one final frozen-screen paint
    now += 120000;
    const finalPaint = pending.entries().next().value as [number, FrameRequestCallback];
    pending.delete(finalPaint[0]);
    finalPaint[1](now);
    expect(pending.size).toBe(0);
  } finally {
    interval.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("pauses one animation RAF while hidden, resumes on visibility and cleans up on STOP/RESET", () => {
  let now = 0;
  let visibility: "hidden" | "visible" = "hidden";
  let nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const listeners = new Set<() => void>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    pending.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => pending.delete(id));
  const context = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    fillRect() {},
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData() {},
  };
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
    }),
    addEventListener: (_name: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) => listeners.delete(listener),
  } as unknown as Document);
  try {
    const world = new World(
      { getContext: () => context } as unknown as HTMLCanvasElement,
      () => now,
    );
    world.setProjectAssets(
      manifest({ type: "sprite", alias: "@walk", name: "Walk", sprite: animation }),
    );
    world.spawn("@walk", 10, 20, new Engine(world));
    const notifyVisibility = () => {
      for (const listener of listeners) listener();
    };

    expect(request).not.toHaveBeenCalled();
    expect(listeners.size).toBe(1);
    visibility = "visible";
    notifyVisibility();
    expect(pending.size).toBe(1);
    visibility = "hidden";
    notifyVisibility();
    expect(pending.size).toBe(0);
    expect(cancel).toHaveBeenCalledTimes(1);

    visibility = "visible";
    notifyVisibility();
    expect(pending.size).toBe(1);
    world.canvas = undefined;
    now = 750;
    world.stop();
    expect(pending.size).toBe(0);
    expect(listeners.size).toBe(0);
    world.reset();
    expect(world.objects).toHaveLength(0);
    expect(pending.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("exports a self-contained .randusr package without private library identifiers", () => {
  const p = {
    ...freshProject(),
    sourceCode: 'HERO = SPAWN("@hero",10,20)',
    assetManifest: manifest({
      type: "sprite",
      alias: "@hero",
      name: "Hero",
      assetId: "3d94aa0b-b735-4f8a-88d0-4a61b82d2b2c",
      versionId: "29774b29-6d95-44b5-b344-53d247f31a83",
      version: 1,
      sprite,
    }),
  };
  const raw = serializeProject(p);
  const json = JSON.parse(raw);
  const portable = json.assetManifest.sprites[0];
  expect(portable.sprite).toEqual(sprite);
  expect(portable.alias).toBe("@hero");
  expect(portable).not.toHaveProperty("assetId");
  expect(portable).not.toHaveProperty("versionId");
  expect(portable).not.toHaveProperty("version");
  expect(parseProject(raw).assetManifest?.sprites[0].sprite).toEqual(sprite);
  const animated = serializeProject({
    ...p,
    assetManifest: manifest({
      type: "sprite",
      alias: "@hero",
      name: "Hero",
      assetId: "3d94aa0b-b735-4f8a-88d0-4a61b82d2b2c",
      versionId: "29774b29-6d95-44b5-b344-53d247f31a83",
      version: 1,
      sprite: animation,
    }),
  });
  expect(animated.length).toBeLessThan(1_000_000);
  expect(parseProject(animated).assetManifest?.sprites[0].sprite).toEqual(animation);
  expect(JSON.parse(animated).assetManifest.sprites[0]).not.toHaveProperty("assetId");
  const legacy = freshProject();
  expect(parseProject(JSON.stringify(legacy)).assetManifest).toBeUndefined();
});

it("round-trips complete custom sound recipes in portable .randusr packages", () => {
  const sfx: ProjectSoundBindingV1 = {
    type: "sfx",
    alias: "@spark",
    name: "Spark",
    assetId: "3d94aa0b-b735-4f8a-88d0-4a61b82d2b2c",
    versionId: "29774b29-6d95-44b5-b344-53d247f31a83",
    version: 3,
    recipe: soundRecipe,
  };
  const project = {
    ...freshProject(),
    sourceCode: 'SOUND "@spark"',
    assetManifest: { version: 1 as const, sprites: [], sounds: [sfx] },
  };
  const raw = serializeProject(project);
  const portable = JSON.parse(raw).assetManifest.sounds[0];
  expect(portable).toEqual({
    type: "sfx",
    alias: "@spark",
    name: "Spark",
    recipe: soundRecipe,
  });
  const loaded = parseProject(raw);
  expect(loaded.assetManifest?.sounds?.[0].recipe).toEqual(soundRecipe);
  expect(loaded.assetManifest?.sounds?.[0].recipe.format).toBe("randusr.sfx");
});
