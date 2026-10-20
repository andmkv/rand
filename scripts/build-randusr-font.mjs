// Build src/runtime/randusr-font.json from graphics/RandUSRfont.png (development only).
// The atlas is a 16x16 grid of 8x8 cells, baseline on cell row 6, descenders on row 7.
// The cell order is NOT ASCII/Unicode: every cell is mapped explicitly below after visual
// inspection. "·" marks a cell that is deliberately left unassigned (ambiguous glyph).
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const UNASSIGNED = "·";
// One string per atlas row (0x0..0xf), one character per cell (column 0x0..0xf).
const table = [
  "ABCDEFGHIJKLMNOP",
  "QRSTUVWXYZabcdef",
  "ghijklmnopqrstuv", // m/n are stylized; Cyrillic ж/к have their own cells (row 8)
  "wxyz0123456789 !", // 0x3e is the blank space cell
  "\"#$%&'()*+,-./:;",
  "<=>?@[\\]^_`{|}~А", // 0x5f is Cyrillic А
  "БВГДЕЁЖЗИЙКЛМНОП",
  "РСТУФХЦЧШЩЪЫЬЭЮЯ",
  "абвгдеёжзийклмно",
  "прстуфхцчшщъыьэю",
  "яҐґЄєІіЇїЂђЈјЉљЊ",
  "њЋћЏџÁÉÍÓÚÜÑáéíó",
  "úüñÀÂÆÇÈÊËÎÏÔŒÙÛ",
  "ŸàâæçèêëîïôœùûÿÄ",
  "ÖäößČĆĐŠŽčćđšž¡¿",
  // f2/f3 and f4/f5 are identical double/single quote pairs: open vs close is ambiguous.
  "«»····—…€№←↑→↓♥♪",
];

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const png = fs.readFileSync(path.join(root, "graphics/RandUSRfont.png"));
let p = 8,
  width = 0,
  height = 0;
const idat = [];
while (p < png.length) {
  const len = png.readUInt32BE(p),
    type = png.toString("ascii", p + 4, p + 8),
    data = png.subarray(p + 8, p + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
      throw new Error("expected 8-bit RGBA non-interlaced PNG");
  }
  if (type === "IDAT") idat.push(data);
  p += 12 + len;
}
if (width !== 128 || height !== 128) throw new Error("expected a 128x128 atlas");
const raw = zlib.inflateSync(Buffer.concat(idat)),
  stride = width * 4,
  px = Buffer.alloc(height * stride);
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)],
    line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  for (let x = 0; x < stride; x++) {
    const a = x >= 4 ? px[y * stride + x - 4] : 0,
      b = y ? px[(y - 1) * stride + x] : 0,
      c = y && x >= 4 ? px[(y - 1) * stride + x - 4] : 0;
    let v = line[x];
    if (filter === 1) v += a;
    else if (filter === 2) v += b;
    else if (filter === 3) v += (a + b) >> 1;
    else if (filter === 4) {
      const q = a + b - c,
        pa = Math.abs(q - a),
        pb = Math.abs(q - b),
        pc = Math.abs(q - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    px[y * stride + x] = v & 255;
  }
}
const glyphs = {};
table.forEach((row, r) => {
  const cells = [...row];
  if (cells.length !== 16) throw new Error(`row ${r} has ${cells.length} cells`);
  cells.forEach((ch, c) => {
    if (ch === UNASSIGNED) return;
    if (glyphs[ch]) throw new Error(`duplicate mapping for ${ch}`);
    const rows = [];
    for (let y = 0; y < 8; y++) {
      let bits = 0;
      for (let x = 0; x < 8; x++)
        if (px[((r * 8 + y) * width + c * 8 + x) * 4 + 3] >= 128) bits |= 1 << x;
      rows.push(bits);
    }
    glyphs[ch] = { cell: (r * 16 + c).toString(16).padStart(2, "0"), rows };
  });
});
const out = {
  source: "graphics/RandUSRfont.png, 16x16 cells of 8x8, explicit table in scripts/build-randusr-font.mjs",
  cell: 8,
  baseline: 6,
  glyphs,
};
fs.writeFileSync(
  path.join(root, "src/runtime/randusr-font.json"),
  JSON.stringify(out, null, 0) + "\n",
);
console.log(`${Object.keys(glyphs).length} RandUSR glyphs`);
