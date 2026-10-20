import { describe, expect, it } from "vitest";
import {
  assetLimits,
  spriteThumbnail,
  type SpriteAssetV1,
  type UserSpriteAsset,
} from "../shared/assets";
import {
  animationDraftFromSprite,
  animationDraftHasDrawing,
  animationFrame,
  animationFrameIndex,
  animationHistoryLimits,
  animationLimits,
  animationOnionFrames,
  animationSnapshot,
  applyAnimationSnapshot,
  blankAnimationFrame,
  canAddAnimationFrame,
  canRedoAnimation,
  canUndoAnimation,
  duplicateAnimationFrame,
  emptyAnimationHistory,
  insertAnimationFrame,
  moveAnimationFrame,
  normalizeAnimationDraft,
  pushAnimationHistory,
  redoAnimationHistory,
  removeAnimationFrame,
  resizeAnimationDraft,
  setAnimationFps,
  setAnimationLoop,
  undoAnimationHistory,
  withAnimationFrame,
  animationDraftFromAnimatedSprite,
  animationDraftFromSpriteAsset,
  isAnimatedSpriteV1,
  spriteAssetFromDraft,
  toAnimatedSpriteV1,
} from "../src/animation-draft";
import { blankSprite, paintPixel, pixelSlot, samePixels, transparentSlot } from "../src/sprite-editor";
import {
  animationAssetAdapter,
  createAnimationAssetAdapter,
} from "../src/animation-persistence";

/** A tiny four-frame "walk" so frame identity is easy to assert. */
function walkingCat() {
  let draft = animationDraftFromSprite(blankSprite(8));
  for (let frame = 1; frame < 4; frame++)
    draft = duplicateAnimationFrame(draft, frame - 1).draft;
  draft = withAnimationFrame(
    draft,
    0,
    paintPixel(draft.frames[0], 1, 1, 9),
  );
  draft = withAnimationFrame(draft, 1, paintPixel(draft.frames[1], 2, 2, 10));
  draft = withAnimationFrame(draft, 2, paintPixel(draft.frames[2], 3, 3, 11));
  draft = withAnimationFrame(draft, 3, paintPixel(draft.frames[3], 4, 4, 12));
  return draft;
}

describe("animation draft", () => {
  it("wraps a static sprite without changing a single pixel", () => {
    const sprite = paintPixel(paintPixel(blankSprite(16), 0, 0, 14), 3, 5, 7);
    const draft = animationDraftFromSprite(sprite);
    expect(draft.frames).toHaveLength(1);
    expect(samePixels(draft.frames[0], sprite)).toBe(true);
    expect(draft.width).toBe(16);
    expect(draft.height).toBe(16);
    expect(draft.transparentIndex).toBe(transparentSlot);
    expect(draft.fps).toBe(animationLimits.defaultFps);
    expect(draft.loop).toBe(true);
    // Cloning means editing the draft can never mutate the caller's sprite.
    const edited = withAnimationFrame(
      draft,
      0,
      paintPixel(draft.frames[0], 1, 1, 4),
    );
    expect(pixelSlot(edited.frames[0], 1, 1)).toBe(4);
    expect(pixelSlot(sprite, 1, 1)).toBe(transparentSlot);
  });

  it("creates a four-frame animation and paints only the selected frame", () => {
    const draft = walkingCat();
    expect(draft.frames).toHaveLength(4);
    expect(pixelSlot(animationFrame(draft, 0), 1, 1)).toBe(9);
    expect(pixelSlot(animationFrame(draft, 1), 2, 2)).toBe(10);
    expect(pixelSlot(animationFrame(draft, 2), 3, 3)).toBe(11);
    expect(pixelSlot(animationFrame(draft, 3), 4, 4)).toBe(12);
    // Every other frame keeps its exact pixel bytes and object identity.
    const next = withAnimationFrame(draft, 1, paintPixel(draft.frames[1], 6, 6, 2));
    expect(next.frames[0]).toBe(draft.frames[0]);
    expect(next.frames[2]).toBe(draft.frames[2]);
    expect(pixelSlot(next.frames[0], 6, 6)).toBe(transparentSlot);
    expect(pixelSlot(next.frames[1], 6, 6)).toBe(2);
    // A no-op edit returns the same document so the editor records no history.
    expect(withAnimationFrame(next, 1, next.frames[1])).toBe(next);
  });

  it("adds a blank frame, duplicates a drawing and clamps the selection", () => {
    const base = animationDraftFromSprite(paintPixel(blankSprite(8), 0, 0, 9));
    const blank = insertAnimationFrame(base, 0);
    expect(blank.index).toBe(1);
    expect(blank.draft.frames).toHaveLength(2);
    expect(blank.draft.frames[1].pixels.every((slot) => slot === transparentSlot)).toBe(true);
    expect(blankAnimationFrame(blank.draft).palette).toEqual(blank.draft.palette);

    const copy = duplicateAnimationFrame(base, 0);
    expect(copy.index).toBe(1);
    expect(samePixels(copy.draft.frames[0], copy.draft.frames[1])).toBe(true);
    // The copy is independent.
    expect(copy.draft.frames[0]).not.toBe(copy.draft.frames[1]);

    expect(animationFrameIndex(base, 99)).toBe(0);
    expect(animationFrameIndex(base, -4)).toBe(0);
    expect(animationFrameIndex(copy.draft, 1)).toBe(1);
  });

  it("bounds the timeline at 32 frames and one frame minimum", () => {
    let draft = animationDraftFromSprite(blankSprite(4));
    for (let index = 0; index < animationLimits.frames + 5; index++)
      draft = insertAnimationFrame(draft, draft.frames.length - 1).draft;
    expect(draft.frames).toHaveLength(animationLimits.frames);
    expect(canAddAnimationFrame(draft)).toBe(false);
    const full = insertAnimationFrame(draft, 0);
    expect(full.draft).toBe(draft);

    let single = animationDraftFromSprite(blankSprite(4));
    for (let index = 0; index < 4; index++)
      single = removeAnimationFrame(single, 0).draft;
    expect(single.frames).toHaveLength(1);
  });

  it("deletes and reorders frames without losing the moved drawing", () => {
    const draft = walkingCat();
    const removed = removeAnimationFrame(draft, 1);
    expect(removed.draft.frames).toHaveLength(3);
    expect(removed.index).toBe(1);
    expect(pixelSlot(removed.draft.frames[1], 3, 3)).toBe(11);

    const last = removeAnimationFrame(draft, 3);
    expect(last.index).toBe(2);

    const moved = moveAnimationFrame(draft, 0, 3);
    expect(moved.index).toBe(3);
    expect(moved.draft.frames).toHaveLength(4);
    expect(pixelSlot(moved.draft.frames[3], 1, 1)).toBe(9);
    expect(pixelSlot(moved.draft.frames[0], 2, 2)).toBe(10);
    expect(moveAnimationFrame(draft, 2, 2).draft).toBe(draft);
    // Moving past the ends is clamped, never a crash.
    expect(moveAnimationFrame(draft, 0, 99).index).toBe(3);
  });

  it("clamps FPS to 1–12 and keeps loop as a boolean", () => {
    const base = animationDraftFromSprite(blankSprite(4));
    expect(setAnimationFps(base, 1).fps).toBe(1);
    expect(setAnimationFps(base, 12).fps).toBe(12);
    expect(setAnimationFps(base, 0).fps).toBe(1);
    expect(setAnimationFps(base, 99).fps).toBe(12);
    expect(setAnimationFps(base, 6.6).fps).toBe(7);
    expect(setAnimationFps(base, Number.NaN).fps).toBe(animationLimits.defaultFps);
    expect(setAnimationFps(base, animationLimits.defaultFps)).toBe(base);
    expect(setAnimationLoop(base, false).loop).toBe(false);
    expect(setAnimationLoop(base, true)).toBe(base);
  });

  it("resizes every frame around the centre and detects drawing in any frame", () => {
    const draft = walkingCat();
    expect(animationDraftHasDrawing(draft)).toBe(true);
    expect(animationDraftHasDrawing(animationDraftFromSprite(blankSprite(8)))).toBe(false);
    const larger = resizeAnimationDraft(draft, 16, 16);
    expect(larger.width).toBe(16);
    expect(larger.frames.every((frame) => frame.width === 16 && frame.height === 16)).toBe(true);
    expect(pixelSlot(larger.frames[0], 5, 5)).toBe(9);
    expect(pixelSlot(larger.frames[3], 8, 8)).toBe(12);
    const clamped = resizeAnimationDraft(draft, 999, 999);
    expect(clamped.width).toBe(assetLimits.spriteWidth);
    expect(resizeAnimationDraft(draft, 8, 8)).toBe(draft);
  });

  it("resolves onion-skin neighbours, wrapping only when the loop is on", () => {
    const draft = walkingCat();
    const on = { enabled: true, previous: true, next: true };
    const first = animationOnionFrames(draft, 0, { ...on, wrap: false });
    expect(first.previous).toBeNull();
    expect(first.next).toBe(draft.frames[1]);
    const wrapped = animationOnionFrames(draft, 0, { ...on, wrap: true });
    expect(wrapped.previous).toBe(draft.frames[3]);
    expect(wrapped.next).toBe(draft.frames[1]);
    const middle = animationOnionFrames(draft, 2, { ...on, wrap: false });
    expect(middle.previous).toBe(draft.frames[1]);
    expect(middle.next).toBe(draft.frames[3]);
    const last = animationOnionFrames(draft, 3, { ...on, wrap: false });
    expect(last.previous).toBe(draft.frames[2]);
    expect(last.next).toBeNull();
    // Sides are configurable and the whole overlay can be switched off.
    const onlyNext = animationOnionFrames(draft, 2, {
      enabled: true,
      previous: false,
      next: true,
      wrap: false,
    });
    expect(onlyNext.previous).toBeNull();
    expect(onlyNext.next).toBe(draft.frames[3]);
    expect(
      animationOnionFrames(draft, 2, {
        enabled: false,
        previous: true,
        next: true,
        wrap: true,
      }),
    ).toEqual({ previous: null, next: null });
    // A single frame has no neighbour to ghost.
    expect(
      animationOnionFrames(animationDraftFromSprite(blankSprite(4)), 0, {
        ...on,
        wrap: true,
      }),
    ).toEqual({ previous: null, next: null });
    // With two frames and wrap, the same neighbour is not drawn twice.
    const two = duplicateAnimationFrame(animationDraftFromSprite(blankSprite(4)), 0).draft;
    expect(animationOnionFrames(two, 0, { ...on, wrap: true })).toEqual({
      previous: two.frames[1],
      next: null,
    });
  });

  it("never bakes onion-skin ghosts into the frame pixels", () => {
    const draft = walkingCat();
    const before = draft.frames.map((frame) => [...frame.pixels]);
    animationOnionFrames(draft, 1, { enabled: true, previous: true, next: true, wrap: true });
    expect(draft.frames.map((frame) => [...frame.pixels])).toEqual(before);
    // The overlay reads frames, it never returns extra pixels to save.
    expect(draft.frames).toHaveLength(4);
    expect(draft.frames.every((frame) => frame.pixels.length === 64)).toBe(true);
  });

  it("normalizes unsafe input at the boundary", () => {
    const draft = walkingCat();
    const clipped = normalizeAnimationDraft({
      ...draft,
      width: 500,
      height: 0,
      fps: 40,
      frames: [...draft.frames, ...draft.frames, ...draft.frames, ...draft.frames, ...draft.frames, ...draft.frames, ...draft.frames, ...draft.frames, ...draft.frames],
    });
    expect(clipped.width).toBe(assetLimits.spriteWidth);
    expect(clipped.height).toBe(1);
    expect(clipped.fps).toBe(animationLimits.fpsMax);
    expect(clipped.frames).toHaveLength(animationLimits.frames);
    expect(clipped.frames.every((frame) => frame.width === assetLimits.spriteWidth)).toBe(true);

    const hostile = normalizeAnimationDraft({
      ...draft,
      transparentIndex: 99,
      palette: [14, 9],
      frames: [
        {
          ...draft.frames[0],
          pixels: [0, 1, 7, 99, -3, 1.5, 0, 0],
          palette: [4, 5, 6],
          transparentIndex: 2,
          width: 8,
          height: 8,
        },
      ],
    });
    expect(hostile.transparentIndex).toBeNull();
    expect(hostile.palette).toEqual([14, 9]);
    expect(hostile.frames[0].pixels).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
    expect(hostile.frames[0].transparentIndex).toBeNull();
  });
});

describe("animation undo history", () => {
  it("undoes and redoes painting with exact pixels", () => {
    let draft = animationDraftFromSprite(blankSprite(8));
    let history = emptyAnimationHistory;
    const before = animationSnapshot(draft, 0);
    draft = withAnimationFrame(draft, 0, paintPixel(draft.frames[0], 2, 2, 9));
    history = pushAnimationHistory(history, before);
    expect(canUndoAnimation(history)).toBe(true);
    expect(canRedoAnimation(history)).toBe(false);

    const undone = undoAnimationHistory(history, animationSnapshot(draft, 0))!;
    expect(pixelSlot(undone.snapshot.frames[0], 2, 2)).toBe(transparentSlot);
    history = undone.history;
    expect(canRedoAnimation(history)).toBe(true);

    const redone = redoAnimationHistory(history, undone.snapshot)!;
    expect(pixelSlot(redone.snapshot.frames[0], 2, 2)).toBe(9);
    // Redo is exhausted again, and the one action is back on the undo stack.
    expect(redoAnimationHistory(redone.history, redone.snapshot)).toBeNull();
    expect(redone.history.past).toHaveLength(1);
  });

  it("restores frames deleted by a frame operation in one action", () => {
    let draft = walkingCat();
    let history = emptyAnimationHistory;
    const before = animationSnapshot(draft, 1);
    draft = removeAnimationFrame(draft, 1).draft;
    history = pushAnimationHistory(history, before);
    expect(draft.frames).toHaveLength(3);
    const undone = undoAnimationHistory(history, animationSnapshot(draft, 1))!;
    const restored = applyAnimationSnapshot(draft, undone.snapshot);
    expect(restored.frames).toHaveLength(4);
    expect(pixelSlot(restored.frames[1], 2, 2)).toBe(10);
    expect(undone.snapshot.selected).toBe(1);
  });

  it("treats a reorder as exactly one undo action", () => {
    const draft = walkingCat();
    let history = emptyAnimationHistory;
    history = pushAnimationHistory(history, animationSnapshot(draft, 0));
    const moved = moveAnimationFrame(draft, 0, 3).draft;
    const undone = undoAnimationHistory(history, animationSnapshot(moved, 3))!;
    expect(undone.history.past).toHaveLength(0);
    expect(undone.snapshot.frames.map((frame) => frame.pixels[9])).toEqual(
      draft.frames.map((frame) => frame.pixels[9]),
    );
  });

  it("restores fps, loop and frame size through undo", () => {
    const base = animationDraftFromSprite(blankSprite(8), { fps: 3, loop: false });
    let history = emptyAnimationHistory;
    history = pushAnimationHistory(history, animationSnapshot(base, 0));
    const changed = resizeAnimationDraft(
      setAnimationFps(setAnimationLoop(base, true), 11),
      16,
      16,
    );
    const undone = undoAnimationHistory(history, animationSnapshot(changed, 0))!;
    const restored = applyAnimationSnapshot(changed, undone.snapshot);
    expect(restored.fps).toBe(3);
    expect(restored.loop).toBe(false);
    expect(restored.width).toBe(8);
    expect(restored.frames[0].width).toBe(8);
  });

  it("drops the redo branch when a new action starts", () => {
    let history = emptyAnimationHistory;
    const draft = animationDraftFromSprite(blankSprite(4));
    history = pushAnimationHistory(history, animationSnapshot(draft, 0));
    const once = undoAnimationHistory(history, animationSnapshot(draft, 0))!;
    expect(canRedoAnimation(once.history)).toBe(true);
    const branching = pushAnimationHistory(once.history, animationSnapshot(draft, 0));
    expect(canRedoAnimation(branching)).toBe(false);
  });

  it("keeps snapshots independent from the live document", () => {
    const draft = walkingCat();
    const snapshot = animationSnapshot(draft, 0);
    const next = withAnimationFrame(draft, 0, paintPixel(draft.frames[0], 7, 7, 3));
    expect(pixelSlot(next.frames[0], 7, 7)).toBe(3);
    expect(pixelSlot(snapshot.frames[0], 7, 7)).toBe(transparentSlot);
    expect(snapshot.frames[0]).not.toBe(draft.frames[0]);
  });

  it("bounds the history by entry count and pixel budget", () => {
    const draft = animationDraftFromSprite(blankSprite(64));
    let history = emptyAnimationHistory;
    for (let index = 0; index < animationHistoryLimits.entries + 25; index++)
      history = pushAnimationHistory(history, animationSnapshot(draft, 0));
    expect(history.past.length).toBeLessThanOrEqual(animationHistoryLimits.entries);
    expect(history.past.length).toBeGreaterThan(0);
    // A single 64×64 frame is 4096 pixels, far below the whole budget; many frames
    // are what triggers the pixel cap.
    const big = animationDraftFromSprite(blankSprite(64));
    let wide = big;
    for (let index = 0; index < 32; index++)
      wide = insertAnimationFrame(wide, wide.frames.length - 1).draft;
    let pixels = emptyAnimationHistory;
    for (let index = 0; index < animationHistoryLimits.entries; index++)
      pixels = pushAnimationHistory(pixels, animationSnapshot(wide, 0));
    const cost = pixels.past.length * wide.frames.length * 64 * 64;
    expect(cost).toBeLessThanOrEqual(animationHistoryLimits.pixels);
  });
});

describe("canonical AnimatedSpriteV1 payload (card 119 contract v1)", () => {
  it("serializes 2+ frames into the exact published shape", () => {
    const draft = walkingCat();
    const payload = toAnimatedSpriteV1(draft);
    expect(Object.keys(payload).sort()).toEqual([
      "format",
      "fps",
      "frames",
      "height",
      "loop",
      "palette",
      "transparentIndex",
      "version",
      "width",
    ]);
    expect(payload.format).toBe("randusr.animated-sprite");
    expect(payload.version).toBe(1);
    expect(payload.width).toBe(8);
    expect(payload.height).toBe(8);
    expect(payload.fps).toBe(animationLimits.defaultFps);
    expect(payload.loop).toBe(true);
    expect(payload.transparentIndex).toBe(transparentSlot);
    expect(payload.palette).toEqual([...draft.palette]);
    expect(payload.frames).toHaveLength(4);
    expect(payload.frames.every((frame) => frame.length === 64)).toBe(true);
    expect(payload.frames[0][8 + 1]).toBe(9);
    expect(payload.frames[1][16 + 2]).toBe(10);
    expect(isAnimatedSpriteV1(payload)).toBe(true);
  });

  it("keeps a single-frame sprite in the unchanged static format", () => {
    const sprite = paintPixel(blankSprite(16), 1, 1, 4);
    const draft = animationDraftFromSprite(sprite);
    const payload = spriteAssetFromDraft(draft);
    expect(payload.format).toBe("randusr.indexed-sprite");
    expect(payload).not.toHaveProperty("frames");
    expect(payload).not.toHaveProperty("fps");
    expect(samePixels(payload as never, sprite)).toBe(true);
    const many = spriteAssetFromDraft(walkingCat());
    expect(many.format).toBe("randusr.animated-sprite");
    expect(isAnimatedSpriteV1(many)).toBe(true);
    expect(isAnimatedSpriteV1(payload)).toBe(false);
  });

  it("round-trips a stored animation back into an editable draft", () => {
    const draft = walkingCat();
    const payload = toAnimatedSpriteV1(draft);
    const reopened = animationDraftFromAnimatedSprite(payload);
    expect(animationDraftFromSpriteAsset(payload)).toEqual(reopened);
    expect(reopened.frames).toHaveLength(4);
    expect(reopened.fps).toBe(draft.fps);
    expect(reopened.loop).toBe(true);
    expect(
      reopened.frames.map((frame) => [...frame.pixels]),
    ).toEqual(draft.frames.map((frame) => [...frame.pixels]));
    expect(toAnimatedSpriteV1(reopened)).toEqual(payload);
    // Frames share the payload palette and transparency.
    expect(reopened.frames[0].palette).toEqual(payload.palette);
    expect(reopened.frames[3].palette).toEqual(payload.palette);
    expect(reopened.frames[0].transparentIndex).toBe(transparentSlot);
  });

  it("rejects malformed animated payloads at the boundary", () => {
    const payload = toAnimatedSpriteV1(walkingCat());
    for (const broken of [
      { ...payload, format: "randusr.indexed-sprite" },
      { ...payload, version: 2 },
      { ...payload, width: 0 },
      { ...payload, width: 99 },
      { ...payload, fps: 0 },
      { ...payload, fps: 13 },
      { ...payload, fps: 6.5 },
      { ...payload, loop: "yes" },
      { ...payload, frames: [] },
      { ...payload, frames: Array.from({ length: 33 }, () => payload.frames[0]) },
      { ...payload, frames: [[1, 2, 3]] },
      { ...payload, frames: [payload.frames[0].map(() => 99)] },
      { ...payload, palette: [0, 0] },
      { ...payload, palette: [] },
      { ...payload, transparentIndex: 99 },
      { ...payload, extra: true },
    ])
      expect(isAnimatedSpriteV1(broken)).toBe(false);
    expect(isAnimatedSpriteV1(null)).toBe(false);
    expect(isAnimatedSpriteV1([])).toBe(false);
    expect(isAnimatedSpriteV1("sprite")).toBe(false);
  });
});

describe("animation persistence seam", () => {
  it("saves the full canonical payload through create/version and keeps one frame static", async () => {
    const calls: unknown[] = [];
    const saved = (
      id: string,
      number: number,
      name: string,
      sprite: SpriteAssetV1,
    ): UserSpriteAsset => ({
      id,
      type: "sprite",
      name,
      alias: "@walk",
      latestVersion: { id: `v${number}`, number, createdAt: "2026-10-19T00:00:00.000Z" },
      selectedVersion: { id: `v${number}`, number, createdAt: "2026-10-19T00:00:00.000Z" },
      thumbnail: spriteThumbnail(sprite),
      sprite,
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-19T00:00:00.000Z",
    });
    const writer = {
      async create(input: { name: string; sprite: SpriteAssetV1 }) {
        calls.push(["create", input.name, input.sprite.format]);
        return saved("asset-1", 1, input.name, input.sprite);
      },
      async saveVersion(
        assetId: string,
        input: { baseVersion: number; sprite: SpriteAssetV1 },
      ) {
        calls.push(["saveVersion", assetId, input.baseVersion, input.sprite.format]);
        return saved(assetId, 9, "Walk", input.sprite);
      },
    };
    const adapter = createAnimationAssetAdapter(writer);
    expect(adapter.available).toBe(true);
    const animation = walkingCat();
    await expect(
      adapter.save({ name: "Walk", animation }),
    ).resolves.toMatchObject({
      alias: "@walk",
      sprite: spriteAssetFromDraft(animation),
    });
    await expect(
      adapter.save({
        name: "Walk",
        animation,
        existing: { id: "asset-1", baseVersion: 8 },
      }),
    ).resolves.toMatchObject({
      alias: "@walk",
      selectedVersion: { number: 9 },
      sprite: spriteAssetFromDraft(animation),
    });
    // A one-frame draft still saves the unchanged static payload.
    await adapter.save({
      name: "Dot",
      animation: animationDraftFromSprite(blankSprite(8)),
    });
    expect(calls).toEqual([
      ["create", "Walk", "randusr.animated-sprite"],
      ["saveVersion", "asset-1", 8, "randusr.animated-sprite"],
      ["create", "Dot", "randusr.indexed-sprite"],
    ]);
    expect(animationAssetAdapter.available).toBe(true);
  });
});
