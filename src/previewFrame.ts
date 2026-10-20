import { palette } from "./runtime/palette";
const colors = palette.map((hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
);
const exact = new Map(
  colors.map(([r, g, b], i) => [(r << 16) | (g << 8) | b, i]),
);
export function capturePreview(canvas: HTMLCanvasElement | null) {
  if (!canvas || canvas.width !== 256 || canvas.height !== 192)
    throw new Error("SCREEN unavailable");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("SCREEN unavailable");
  const rgba = ctx.getImageData(0, 0, 256, 192).data,
    indices = new Uint8Array(49152);
  for (let i = 0; i < indices.length; i++) {
    const r = rgba[i * 4],
      g = rgba[i * 4 + 1],
      b = rgba[i * 4 + 2];
    let value = exact.get((r << 16) | (g << 8) | b);
    if (value === undefined) {
      let best = Infinity;
      for (let c = 0; c < colors.length; c++) {
        const rgb = colors[c],
          distance = (rgb[0] - r) ** 2 + (rgb[1] - g) ** 2 + (rgb[2] - b) ** 2;
        if (distance < best) {
          best = distance;
          value = c;
        }
      }
    }
    indices[i] = value!;
  }
  let bytes = "";
  for (let start = 0; start < indices.length; start += 8192)
    bytes += String.fromCharCode(...indices.subarray(start, start + 8192));
  return btoa(bytes);
}
export function frameDataUrl(canvas: HTMLCanvasElement | null) {
  return canvas ? canvas.toDataURL("image/png") : "";
}
