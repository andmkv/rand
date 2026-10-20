import atlas from "./unicode-font.json";
import randusr from "./randusr-font.json";
type Glyph = { rows: number[]; advance: number };
// The RandUSR 8x8 atlas is the primary SCREEN font. Its cells sit inside the existing
// 18-pixel line box (row 6 onward) so layouts and the Handjet/DotGothic16 fallback
// (Japanese and other scripts the atlas lacks) keep a shared line height.
const top = 6;
const primary: Record<string, Glyph> = Object.fromEntries(
  Object.entries(randusr.glyphs).map(([ch, g]) => [
    ch,
    {
      advance: randusr.cell,
      rows: Array.from({ length: 18 }, (_, y) =>
        y >= top && y < top + randusr.cell ? g.rows[y - top] : 0,
      ),
    },
  ]),
);
// Typographic quotes/dashes whose atlas cells are ambiguous reuse the plain ASCII cells.
const aliases: Record<string, string> = {
  "“": '"',
  "”": '"',
  "„": '"',
  "‘": "'",
  "’": "'",
  "‚": ",",
  "–": "-",
  " ": " ",
};
const glyphs: Record<string, Glyph> = atlas.glyphs;
// A visible crossed box distinguishes unavailable Unicode glyphs from a question mark.
export const fallbackGlyph: Glyph = {
  advance: 9,
  rows: [0, 0, 0, 255, 129, 165, 153, 153, 165, 129, 255, 0, 0, 0, 0, 0, 0, 0],
};
export function glyphFor(character: string): Glyph {
  return (
    primary[character] ??
    primary[aliases[character]] ??
    glyphs[character] ??
    fallbackGlyph
  );
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
