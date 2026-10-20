import atlas from "./unicode-font.json";
type Glyph = { rows: number[]; advance: number };
const glyphs: Record<string, Glyph> = atlas.glyphs;
// A visible crossed box distinguishes unavailable Unicode glyphs from a question mark.
export const fallbackGlyph: Glyph = {
  advance: 9,
  rows: [0, 0, 0, 255, 129, 165, 153, 153, 165, 129, 255, 0, 0, 0, 0, 0, 0, 0],
};
export function glyphFor(character: string): Glyph {
  return glyphs[character] ?? fallbackGlyph;
}
export function textWidth(value: string): number {
  return [...value.normalize("NFC")].reduce(
    (n, c) => n + glyphFor(c).advance,
    0,
  );
}
export function drawText(
  pixel: (x: number, y: number) => void,
  x: number,
  y: number,
  value: string,
) {
  let advance = 0;
  for (const c of value.normalize("NFC")) {
    const glyph = glyphFor(c);
    glyph.rows.forEach((row, j) => {
      for (let k = 0; k < 24; k++)
        if (row & (1 << k))
          pixel(Math.round(x + advance + k), Math.round(y + j));
    });
    advance += glyph.advance;
  }
}
