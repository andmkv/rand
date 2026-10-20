import {
  assetLimits,
  type IndexedSpriteV1,
  type SpectrumColorIndex,
} from "../shared/assets";
import { palette as spectrum } from "./runtime/palette";

/** Presets offered by the editor; the contract caps a sprite at 64×64. */
export const spritePresets = [8, 16, 32, 64] as const;
/** Slot 0 is the transparent slot; 1–15 are the full Spectrum range (8 is black). */
export const transparentSlot = 0;
export const editorPalette: SpectrumColorIndex[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];
export type SpriteTool = "pencil" | "eraser" | "picker" | "fill" | "rect" | "pan";
export type SpritePoint = { x: number; y: number };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function blankSprite(
  width = 16,
  height = width,
): IndexedSpriteV1 {
  const w = clamp(Math.round(width), 1, assetLimits.spriteWidth),
    h = clamp(Math.round(height), 1, assetLimits.spriteHeight);
  return {
    format: "randusr.indexed-sprite",
    version: 1,
    width: w,
    height: h,
    pixels: new Array(w * h).fill(transparentSlot),
    palette: [...editorPalette],
    transparentIndex: transparentSlot,
  };
}
export function cloneSprite(sprite: IndexedSpriteV1): IndexedSpriteV1 {
  return {
    ...sprite,
    pixels: [...sprite.pixels],
    palette: [...sprite.palette],
  };
}
export function samePixels(a: IndexedSpriteV1, b: IndexedSpriteV1) {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.pixels.length === b.pixels.length &&
    a.pixels.every((value, index) => value === b.pixels[index])
  );
}
export function pixelSlot(
  sprite: IndexedSpriteV1,
  x: number,
  y: number,
): number | null {
  if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) return null;
  return sprite.pixels[y * sprite.width + x] ?? null;
}
export function paintPixel(
  sprite: IndexedSpriteV1,
  x: number,
  y: number,
  slot: number,
): IndexedSpriteV1 {
  if (pixelSlot(sprite, x, y) === null) return sprite;
  const pixels = [...sprite.pixels];
  pixels[y * sprite.width + x] = slot;
  return { ...sprite, pixels };
}
/** Bresenham line so fast pointer moves still paint a continuous stroke. */
export function linePoints(
  from: SpritePoint,
  to: SpritePoint,
): SpritePoint[] {
  const points: SpritePoint[] = [];
  let x = from.x,
    y = from.y;
  const dx = Math.abs(to.x - x),
    dy = -Math.abs(to.y - y),
    sx = x < to.x ? 1 : -1,
    sy = y < to.y ? 1 : -1;
  let error = dx + dy;
  for (let guard = 0; guard < 4096; guard++) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}
export function paintLine(
  sprite: IndexedSpriteV1,
  from: SpritePoint,
  to: SpritePoint,
  slot: number,
): IndexedSpriteV1 {
  return linePoints(from, to).reduce(
    (next, point) => paintPixel(next, point.x, point.y, slot),
    sprite,
  );
}
export function fillArea(
  sprite: IndexedSpriteV1,
  start: SpritePoint,
  slot: number,
): IndexedSpriteV1 {
  const target = pixelSlot(sprite, start.x, start.y);
  if (target === null || target === slot) return sprite;
  const next = { ...sprite, pixels: [...sprite.pixels] };
  const queue: SpritePoint[] = [start];
  const seen = new Set<number>();
  while (queue.length) {
    const point = queue.pop()!;
    const key = point.y * next.width + point.x;
    if (seen.has(key)) continue;
    seen.add(key);
    if (pixelSlot(next, point.x, point.y) !== target) continue;
    next.pixels[key] = slot;
    queue.push(
      { x: point.x + 1, y: point.y },
      { x: point.x - 1, y: point.y },
      { x: point.x, y: point.y + 1 },
      { x: point.x, y: point.y - 1 },
    );
    if (seen.size > next.width * next.height) break;
  }
  return next;
}
export function paintRectangle(
  sprite: IndexedSpriteV1,
  from: SpritePoint,
  to: SpritePoint,
  slot: number,
): IndexedSpriteV1 {
  let next = sprite;
  const left = Math.min(from.x, to.x),
    right = Math.max(from.x, to.x),
    top = Math.min(from.y, to.y),
    bottom = Math.max(from.y, to.y);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) next = paintPixel(next, x, y, slot);
  return next;
}
export function flipHorizontal(sprite: IndexedSpriteV1): IndexedSpriteV1 {
  const pixels = new Array(sprite.width * sprite.height).fill(transparentSlot);
  for (let y = 0; y < sprite.height; y++)
    for (let x = 0; x < sprite.width; x++)
      pixels[y * sprite.width + (sprite.width - 1 - x)] =
        sprite.pixels[y * sprite.width + x];
  return { ...sprite, pixels };
}
export function flipVertical(sprite: IndexedSpriteV1): IndexedSpriteV1 {
  const pixels = new Array(sprite.width * sprite.height).fill(transparentSlot);
  for (let y = 0; y < sprite.height; y++)
    for (let x = 0; x < sprite.width; x++)
      pixels[(sprite.height - 1 - y) * sprite.width + x] =
        sprite.pixels[y * sprite.width + x];
  return { ...sprite, pixels };
}
/** Resize keeps the drawing centred, so enlarging never pushes it into a corner. */
export function resizeSprite(
  sprite: IndexedSpriteV1,
  width: number,
  height: number,
): IndexedSpriteV1 {
  const w = clamp(Math.round(width), 1, assetLimits.spriteWidth),
    h = clamp(Math.round(height), 1, assetLimits.spriteHeight);
  const pixels = new Array(w * h).fill(transparentSlot);
  const offsetX = Math.floor((w - sprite.width) / 2),
    offsetY = Math.floor((h - sprite.height) / 2);
  for (let y = 0; y < sprite.height; y++)
    for (let x = 0; x < sprite.width; x++) {
      const tx = x + offsetX,
        ty = y + offsetY;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      pixels[ty * w + tx] = sprite.pixels[y * sprite.width + x];
    }
  return { ...sprite, width: w, height: h, pixels };
}
export function hasDrawing(sprite: IndexedSpriteV1) {
  const transparent = sprite.transparentIndex;
  return sprite.pixels.some((slot) => slot !== transparent);
}
/** Load a built-in sprite (digits 0–7 = bright Spectrum inks) as an editable copy. */
export function spriteFromRows(rows: string[]): IndexedSpriteV1 {
  const width = rows[0]?.length ?? 8,
    height = rows.length;
  const pixels: number[] = [];
  for (const row of rows)
    for (const cell of row)
      pixels.push(cell === "." ? transparentSlot : Number(cell) + 8);
  return {
    format: "randusr.indexed-sprite",
    version: 1,
    width,
    height,
    pixels,
    palette: [...editorPalette],
    transparentIndex: transparentSlot,
  };
}
/** Spectrum colour for a slot, or null when the slot is transparent. */
export function slotColor(sprite: IndexedSpriteV1, slot: number) {
  if (slot === sprite.transparentIndex) return null;
  const index = sprite.palette[slot];
  return index === undefined ? null : spectrum[index];
}
/** Straight RGBA bytes for a pixel-perfect PNG export; unit-testable without a canvas. */
export function spriteRgba(sprite: IndexedSpriteV1): Uint8ClampedArray {
  const bytes = new Uint8ClampedArray(sprite.width * sprite.height * 4);
  for (let i = 0; i < sprite.pixels.length; i++) {
    const color = slotColor(sprite, sprite.pixels[i]);
    if (!color) continue;
    bytes[i * 4] = parseInt(color.slice(1, 3), 16);
    bytes[i * 4 + 1] = parseInt(color.slice(3, 5), 16);
    bytes[i * 4 + 2] = parseInt(color.slice(5, 7), 16);
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}
