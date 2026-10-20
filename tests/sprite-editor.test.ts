import { describe, expect, it } from "vitest";
import { assetLimits } from "../shared/assets";
import { sprites } from "../src/runtime/sprites";
import {
  blankSprite,
  cloneSprite,
  fillArea,
  flipHorizontal,
  flipVertical,
  hasDrawing,
  linePoints,
  paintLine,
  paintPixel,
  paintRectangle,
  pixelSlot,
  resizeSprite,
  samePixels,
  slotColor,
  spriteFromRows,
  spriteRgba,
  transparentSlot,
} from "../src/sprite-editor";

describe("sprite editor model", () => {
  it("makes bounded blank sprites with an explicit transparent slot", () => {
    const sprite = blankSprite(16);
    expect(sprite.width).toBe(16);
    expect(sprite.pixels).toHaveLength(256);
    expect(sprite.pixels.every((slot) => slot === transparentSlot)).toBe(true);
    expect(sprite.transparentIndex).toBe(transparentSlot);
    expect(blankSprite(999).width).toBe(assetLimits.spriteWidth);
    expect(blankSprite(0).width).toBe(1);
  });
  it("paints, interpolates fast strokes and never writes outside the canvas", () => {
    let sprite = blankSprite(8);
    sprite = paintPixel(sprite, 1, 1, 9);
    expect(pixelSlot(sprite, 1, 1)).toBe(9);
    expect(pixelSlot(sprite, -1, 1)).toBeNull();
    expect(pixelSlot(sprite, 8, 0)).toBeNull();
    expect(pixelSlot(paintPixel(sprite, 20, 20, 4), 20, 20)).toBeNull();
    const line = linePoints({ x: 0, y: 0 }, { x: 4, y: 2 });
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line.at(-1)).toEqual({ x: 4, y: 2 });
    sprite = paintLine(blankSprite(8), { x: 0, y: 0 }, { x: 6, y: 6 }, 9);
    for (let i = 0; i <= 6; i++) expect(pixelSlot(sprite, i, i)).toBe(9);
  });
  it("flood fills only the connected area and replaces exactly that colour", () => {
    let sprite = blankSprite(6);
    sprite = paintRectangle(sprite, { x: 0, y: 0 }, { x: 2, y: 2 }, 9);
    const filled = fillArea(sprite, { x: 1, y: 1 }, 4);
    expect(pixelSlot(filled, 0, 0)).toBe(4);
    expect(pixelSlot(filled, 2, 2)).toBe(4);
    expect(pixelSlot(filled, 5, 5)).toBe(transparentSlot);
    expect(fillArea(filled, { x: 5, y: 5 }, 4)).not.toBe(filled);
    expect(fillArea(filled, { x: 1, y: 1 }, 4)).toBe(filled);
  });
  it("draws rectangles and flips in both directions", () => {
    let sprite = paintRectangle(blankSprite(4), { x: 0, y: 0 }, { x: 1, y: 0 }, 9);
    sprite = paintPixel(sprite, 3, 3, 4);
    const horizontal = flipHorizontal(sprite);
    expect(pixelSlot(horizontal, 3, 0)).toBe(9);
    expect(pixelSlot(horizontal, 2, 0)).toBe(9);
    expect(pixelSlot(horizontal, 0, 3)).toBe(4);
    const vertical = flipVertical(sprite);
    expect(pixelSlot(vertical, 3, 0)).toBe(4);
    expect(pixelSlot(vertical, 0, 3)).toBe(9);
    expect(flipHorizontal(flipHorizontal(sprite))).toEqual(sprite);
  });
  it("resizes around the centre and keeps drawing inside the new bounds", () => {
    const sprite = paintPixel(
      paintPixel(blankSprite(4), 1, 1, 9),
      2,
      2,
      4,
    );
    const larger = resizeSprite(sprite, 8, 8);
    expect(larger.width).toBe(8);
    expect(pixelSlot(larger, 3, 3)).toBe(9);
    expect(pixelSlot(larger, 4, 4)).toBe(4);
    const smaller = resizeSprite(sprite, 2, 2);
    expect(pixelSlot(smaller, 0, 0)).toBe(9);
    expect(pixelSlot(smaller, 1, 1)).toBe(4);
    expect(resizeSprite(blankSprite(8), 999, 999).width).toBe(64);
  });
  it("loads a built-in sprite exactly as the runtime renders it", () => {
    const cat = spriteFromRows(sprites.cat);
    expect(cat.width).toBe(8);
    expect(cat.height).toBe(8);
    // Runtime digits are bright inks 0–7, stored as palette slots 8–15.
    expect(pixelSlot(cat, 0, 0)).toBe(Number(sprites.cat[0][0]) + 8);
    expect(pixelSlot(cat, 1, 0)).toBe(transparentSlot);
    expect(slotColor(cat, 8)).toBe("#000000");
    expect(slotColor(cat, transparentSlot)).toBeNull();
    const drawn = cloneSprite(cat);
    expect(hasDrawing(drawn)).toBe(true);
    expect(hasDrawing(blankSprite(8))).toBe(false);
    expect(samePixels(drawn, cat)).toBe(true);
  });
  it("produces exact RGBA bytes for a transparent PNG export", () => {
    const sprite = {
      ...blankSprite(2),
      pixels: [0, 1, 2, 1],
      palette: [0, 15, 4] as const,
      transparentIndex: 0,
    };
    const bytes = spriteRgba(sprite as never);
    expect([...bytes.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...bytes.slice(4, 8)]).toEqual([255, 255, 255, 255]);
    expect([...bytes.slice(8, 12)]).toEqual([0, 191, 0, 255]);
    expect([...bytes.slice(12, 16)]).toEqual([255, 255, 255, 255]);
  });
});
