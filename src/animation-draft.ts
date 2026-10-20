/**
 * Temporary local animation draft (card 120, Stage B UI track).
 *
 * The editor keeps frames in memory in this shape while the persisted asset
 * contract stays canonical in `shared/assets.ts`. It deliberately
 * reuses `IndexedSpriteV1` for every frame, so a frame is exactly the payload the
 * static editor already saves: same palette, same transparent slot, same pixels.
 *
 * Rules encoded here (and unit-tested in `tests/animation-draft.test.ts`):
 * - 1–32 frames, every frame the same width/height/palette/transparentIndex.
 * - FPS is an integer 1–12; loop is a boolean (default on).
 * - Draft operations are pure: they return the same object when nothing changes,
 *   which lets the editor push exactly one undo entry per user action.
 * - Undo history is bounded by both an entry count and a pixel budget so a large
 *   multi-frame sprite cannot grow memory without limit.
 *
 * Persistence lives behind `src/animation-persistence.ts`; there is no second
 * serialized animation format.
 */
import {
  assetLimits,
  assertAnimatedSprite,
  type AnimatedSpriteV1,
  type IndexedSpriteV1,
  type SpriteAssetV1,
  type SpectrumColorIndex,
} from "../shared/assets";
import {
  blankSprite,
  cloneSprite,
  resizeSprite,
  samePixels,
  transparentSlot,
} from "./sprite-editor";

export const animationLimits = {
  /** Bounded frame count; also asserted by the future canonical contract. */
  frames: 32,
  fpsMin: 1,
  fpsMax: 12,
  defaultFps: 6,
} as const;

export const animationHistoryLimits = {
  entries: 60,
  /** Total pixels retained across one history list (past or future). */
  pixels: 1_500_000,
} as const;

export interface AnimationDraftV1 {
  format: "randusr.animation-draft";
  version: 1;
  width: number;
  height: number;
  palette: SpectrumColorIndex[];
  transparentIndex: number | null;
  frames: IndexedSpriteV1[];
  fps: number;
  loop: boolean;
}

export interface AnimationOnionOptions {
  enabled: boolean;
  previous: boolean;
  next: boolean;
  /** Wrap around while the preview loop is on, matching what Play shows. */
  wrap: boolean;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function normalizedFps(value: number): number {
  if (!Number.isFinite(value)) return animationLimits.defaultFps;
  return clamp(Math.round(value), animationLimits.fpsMin, animationLimits.fpsMax);
}

/** A blank frame that already shares the draft palette and transparent slot. */
export function blankAnimationFrame(
  draft: Pick<
    AnimationDraftV1,
    "width" | "height" | "palette" | "transparentIndex"
  >,
): IndexedSpriteV1 {
  const frame = blankSprite(draft.width, draft.height);
  return {
    ...frame,
    palette: [...draft.palette],
    transparentIndex: draft.transparentIndex,
    pixels: frame.pixels.map(() => draft.transparentIndex ?? transparentSlot),
  };
}

export function animationDraftFromSprite(
  sprite: IndexedSpriteV1,
  options: { fps?: number; loop?: boolean } = {},
): AnimationDraftV1 {
  const frame = cloneSprite(sprite);
  return {
    format: "randusr.animation-draft",
    version: 1,
    width: frame.width,
    height: frame.height,
    palette: [...frame.palette],
    transparentIndex: frame.transparentIndex,
    frames: [frame],
    fps: normalizedFps(options.fps ?? animationLimits.defaultFps),
    loop: options.loop ?? true,
  };
}

/** Open either canonical static or animated sprite data in the same editor draft. */
export function animationDraftFromSpriteAsset(
  sprite: SpriteAssetV1,
): AnimationDraftV1 {
  return sprite.format === "randusr.animated-sprite"
    ? animationDraftFromAnimatedSprite(sprite)
    : animationDraftFromSprite(sprite);
}

/** Clamp a frame index into the draft, so stale selections can never crash a render. */
export function animationFrameIndex(
  draft: AnimationDraftV1,
  index: number,
): number {
  if (!Number.isFinite(index)) return 0;
  return clamp(Math.trunc(index), 0, draft.frames.length - 1);
}

export function animationFrame(
  draft: AnimationDraftV1,
  index: number,
): IndexedSpriteV1 {
  return draft.frames[animationFrameIndex(draft, index)];
}

/** Replace one frame, keeping every other frame object identical. */
export function withAnimationFrame(
  draft: AnimationDraftV1,
  index: number,
  sprite: IndexedSpriteV1,
): AnimationDraftV1 {
  const target = animationFrameIndex(draft, index);
  const current = draft.frames[target];
  if (samePixels(current, sprite)) return draft;
  const aligned =
    sprite.width === draft.width &&
    sprite.height === draft.height &&
    sprite.transparentIndex === draft.transparentIndex &&
    sprite.palette.every((entry, slot) => entry === draft.palette[slot])
      ? sprite
      : {
          ...cloneSprite(sprite),
          width: draft.width,
          height: draft.height,
          palette: [...draft.palette],
          transparentIndex: draft.transparentIndex,
        };
  return {
    ...draft,
    frames: draft.frames.map((frame, slot) =>
      slot === target ? aligned : frame,
    ),
  };
}

export function canAddAnimationFrame(draft: AnimationDraftV1): boolean {
  return draft.frames.length < animationLimits.frames;
}

export function canRemoveAnimationFrame(draft: AnimationDraftV1): boolean {
  return draft.frames.length > 1;
}

/**
 * Insert a frame after `afterIndex`. Without an explicit sprite the new frame is
 * empty; `duplicateAnimationFrame` passes a copy of the current drawing instead.
 */
export function insertAnimationFrame(
  draft: AnimationDraftV1,
  afterIndex: number,
  sprite?: IndexedSpriteV1,
): { draft: AnimationDraftV1; index: number } {
  if (!canAddAnimationFrame(draft)) {
    return { draft, index: animationFrameIndex(draft, afterIndex) };
  }
  const index = animationFrameIndex(draft, afterIndex) + 1;
  const frame = sprite
    ? { ...cloneSprite(sprite) }
    : blankAnimationFrame(draft);
  return {
    draft: {
      ...draft,
      frames: [
        ...draft.frames.slice(0, index),
        frame,
        ...draft.frames.slice(index),
      ],
    },
    index,
  };
}

export function duplicateAnimationFrame(
  draft: AnimationDraftV1,
  index: number,
): { draft: AnimationDraftV1; index: number } {
  const target = animationFrameIndex(draft, index);
  return insertAnimationFrame(draft, target, draft.frames[target]);
}

export function removeAnimationFrame(
  draft: AnimationDraftV1,
  index: number,
): { draft: AnimationDraftV1; index: number } {
  if (!canRemoveAnimationFrame(draft)) {
    return { draft, index: animationFrameIndex(draft, index) };
  }
  const target = animationFrameIndex(draft, index);
  return {
    draft: {
      ...draft,
      frames: draft.frames.filter((_, slot) => slot !== target),
    },
    // Keep the same visual position when the last frame is deleted.
    index: clamp(target, 0, draft.frames.length - 2),
  };
}

/** One user action: the moved frame keeps its pixels and stays selected. */
export function moveAnimationFrame(
  draft: AnimationDraftV1,
  from: number,
  to: number,
): { draft: AnimationDraftV1; index: number } {
  const source = animationFrameIndex(draft, from);
  const target = animationFrameIndex(draft, to);
  if (source === target) return { draft, index: source };
  const frames = [...draft.frames];
  const [moved] = frames.splice(source, 1);
  frames.splice(target, 0, moved);
  return { draft: { ...draft, frames }, index: target };
}

export function resizeAnimationDraft(
  draft: AnimationDraftV1,
  width: number,
  height: number,
): AnimationDraftV1 {
  const w = clamp(Math.round(width), 1, assetLimits.spriteWidth);
  const h = clamp(Math.round(height), 1, assetLimits.spriteHeight);
  if (w === draft.width && h === draft.height) return draft;
  return {
    ...draft,
    width: w,
    height: h,
    frames: draft.frames.map((frame) => ({
      ...resizeSprite(frame, w, h),
      palette: [...draft.palette],
      transparentIndex: draft.transparentIndex,
    })),
  };
}

export function setAnimationFps(
  draft: AnimationDraftV1,
  fps: number,
): AnimationDraftV1 {
  const next = normalizedFps(fps);
  return next === draft.fps ? draft : { ...draft, fps: next };
}

export function setAnimationLoop(
  draft: AnimationDraftV1,
  loop: boolean,
): AnimationDraftV1 {
  return (draft.loop === loop ? draft : { ...draft, loop });
}

export function animationDraftHasDrawing(draft: AnimationDraftV1): boolean {
  return draft.frames.some((frame) =>
    frame.pixels.some((slot) => slot !== draft.transparentIndex),
  );
}

/**
 * Ghost frames for onion skin. Returns nulls when the overlay is off, when there
 * is nothing to compare against, or when both sides resolve to the same frame.
 * The returned sprites are the real frame payloads; they are only drawn on the
 * preview canvas and never merged into `frames`.
 */
export function animationOnionFrames(
  draft: AnimationDraftV1,
  index: number,
  options: AnimationOnionOptions,
): { previous: IndexedSpriteV1 | null; next: IndexedSpriteV1 | null } {
  if (!options.enabled || draft.frames.length < 2)
    return { previous: null, next: null };
  const current = animationFrameIndex(draft, index);
  const count = draft.frames.length;
  const previousIndex = current - 1;
  const nextIndex = current + 1;
  const previous =
    options.previous && (previousIndex >= 0 || options.wrap)
      ? draft.frames[(previousIndex + count) % count]
      : null;
  const next =
    options.next && (nextIndex < count || options.wrap)
      ? draft.frames[nextIndex % count]
      : null;
  if (previous && next && (previousIndex + count) % count === nextIndex % count)
    return { previous, next: null };
  return { previous, next };
}

/**
 * Enforce every invariant when data crosses a boundary (saved draft, imported
 * value, resized document). Unknown extra keys are dropped, so this is also the
 * validator for the future canonical adapter.
 */
export function normalizeAnimationDraft(
  input: AnimationDraftV1,
): AnimationDraftV1 {
  const width = clamp(Math.round(input.width), 1, assetLimits.spriteWidth);
  const height = clamp(Math.round(input.height), 1, assetLimits.spriteHeight);
  const palette: SpectrumColorIndex[] =
    input.palette.length >= 1
      ? [...input.palette].slice(0, assetLimits.paletteEntries)
      : [0, 1, 2, 3, 4, 5, 6, 7];
  const transparentIndex =
    input.transparentIndex !== null &&
    input.transparentIndex >= 0 &&
    input.transparentIndex < palette.length
      ? input.transparentIndex
      : null;
  const source =
    input.frames.length > 0
      ? input.frames.slice(0, animationLimits.frames)
      : [blankSprite(width, height)];
  const fallbackSlot = transparentIndex ?? 0;
  const frames = source.map((frame) => {
    const base =
      frame.width === width && frame.height === height
        ? cloneSprite(frame)
        : resizeSprite(frame, width, height);
    return {
      ...base,
      width,
      height,
      palette: [...palette],
      transparentIndex,
      pixels: base.pixels.map((slot) =>
        Number.isInteger(slot) && slot >= 0 && slot < palette.length
          ? slot
          : fallbackSlot,
      ),
    };
  });
  return {
    format: "randusr.animation-draft",
    version: 1,
    width,
    height,
    palette,
    transparentIndex,
    frames,
    fps: normalizedFps(input.fps),
    loop: input.loop !== false,
  };
}

/* ----------------------------------------------------------------- undo/redo */

export interface AnimationSnapshot {
  frames: IndexedSpriteV1[];
  fps: number;
  loop: boolean;
  selected: number;
}

export interface AnimationHistory {
  /** Oldest first; the last entry is the state before the current one. */
  past: AnimationSnapshot[];
  /** Nearest redo first. */
  future: AnimationSnapshot[];
}

export const emptyAnimationHistory: AnimationHistory = {
  past: [],
  future: [],
};

export function animationSnapshot(
  draft: AnimationDraftV1,
  selected: number,
): AnimationSnapshot {
  return {
    frames: draft.frames.map(cloneSprite),
    fps: draft.fps,
    loop: draft.loop,
    selected: animationFrameIndex(draft, selected),
  };
}

export function applyAnimationSnapshot(
  draft: AnimationDraftV1,
  snapshot: AnimationSnapshot,
): AnimationDraftV1 {
  const first = snapshot.frames[0];
  return normalizeAnimationDraft({
    ...draft,
    // Undo also restores the size the frames had before a resize.
    width: first?.width ?? draft.width,
    height: first?.height ?? draft.height,
    palette: first ? [...first.palette] : [...draft.palette],
    transparentIndex: first ? first.transparentIndex : draft.transparentIndex,
    frames: snapshot.frames.map(cloneSprite),
    fps: snapshot.fps,
    loop: snapshot.loop,
  });
}

function snapshotPixels(snapshot: AnimationSnapshot): number {
  return snapshot.frames.reduce((total, frame) => total + frame.pixels.length, 0);
}

function capPast(list: AnimationSnapshot[]): AnimationSnapshot[] {
  const kept: AnimationSnapshot[] = [];
  let total = 0;
  for (let index = list.length - 1; index >= 0; index--) {
    const cost = snapshotPixels(list[index]);
    if (kept.length > 0 && total + cost > animationHistoryLimits.pixels) break;
    kept.unshift(list[index]);
    total += cost;
  }
  return kept.slice(-animationHistoryLimits.entries);
}

function capFuture(list: AnimationSnapshot[]): AnimationSnapshot[] {
  const kept: AnimationSnapshot[] = [];
  let total = 0;
  for (const snapshot of list) {
    const cost = snapshotPixels(snapshot);
    if (kept.length > 0 && total + cost > animationHistoryLimits.pixels) break;
    kept.push(snapshot);
    total += cost;
  }
  return kept.slice(0, animationHistoryLimits.entries);
}

/** Record one action: entering a new branch always drops the redo list. */
export function pushAnimationHistory(
  history: AnimationHistory,
  snapshot: AnimationSnapshot,
): AnimationHistory {
  return { past: capPast([...history.past, snapshot]), future: [] };
}

export function undoAnimationHistory(
  history: AnimationHistory,
  current: AnimationSnapshot,
): { history: AnimationHistory; snapshot: AnimationSnapshot } | null {
  const snapshot = history.past.at(-1);
  if (!snapshot) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: capFuture([current, ...history.future]),
    },
    snapshot,
  };
}

export function redoAnimationHistory(
  history: AnimationHistory,
  current: AnimationSnapshot,
): { history: AnimationHistory; snapshot: AnimationSnapshot } | null {
  const snapshot = history.future[0];
  if (!snapshot) return null;
  return {
    history: {
      past: capPast([...history.past, current]),
      future: history.future.slice(1),
    },
    snapshot,
  };
}

export function canUndoAnimation(history: AnimationHistory): boolean {
  return history.past.length > 0;
}

export function canRedoAnimation(history: AnimationHistory): boolean {
  return history.future.length > 0;
}

/** Serialize the draft into the exact canonical payload (no editor-only fields). */
export function toAnimatedSpriteV1(draft: AnimationDraftV1): AnimatedSpriteV1 {
  const normalized = normalizeAnimationDraft(draft);
  return {
    format: "randusr.animated-sprite",
    version: 1,
    width: normalized.width,
    height: normalized.height,
    frames: normalized.frames.map((frame) => [...frame.pixels]),
    palette: [...normalized.palette],
    transparentIndex: normalized.transparentIndex,
    fps: normalized.fps,
    loop: normalized.loop,
  };
}

/**
 * The payload to save: a single-frame sprite keeps the unchanged static
 * `IndexedSpriteV1` format, so existing sprites and `.randusr` files are untouched.
 */
export function spriteAssetFromDraft(draft: AnimationDraftV1): SpriteAssetV1 {
  if (draft.frames.length < 2) return cloneSprite(draft.frames[0]);
  return toAnimatedSpriteV1(draft);
}

export function isAnimatedSpriteV1(value: unknown): value is AnimatedSpriteV1 {
  try {
    assertAnimatedSprite(value);
    return true;
  } catch {
    return false;
  }
}

/** Reopen a stored animation in the editor; also the safe import boundary. */
export function animationDraftFromAnimatedSprite(
  value: AnimatedSpriteV1,
): AnimationDraftV1 {
  return normalizeAnimationDraft({
    format: "randusr.animation-draft",
    version: 1,
    width: value.width,
    height: value.height,
    palette: [...value.palette],
    transparentIndex: value.transparentIndex,
    frames: value.frames.map((pixels) => ({
      format: "randusr.indexed-sprite",
      version: 1,
      width: value.width,
      height: value.height,
      pixels: [...pixels],
      palette: [...value.palette],
      transparentIndex: value.transparentIndex,
    })),
    fps: value.fps,
    loop: value.loop,
  });
}
