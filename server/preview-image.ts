import { deflateSync } from "node:zlib";
import { palette } from "../src/runtime/palette.js";
import { ApiError } from "./errors.js";
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type: string, bytes: Buffer) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const size = Buffer.alloc(4),
    end = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, data, end]);
}
// Input is only a fixed palette-index frame, never a PNG/SVG/file supplied by the visitor.
export function previewPng(encoded: string) {
  if (!/^[A-Za-z0-9+/]{65536}$/.test(encoded))
    throw new ApiError(400, "INVALID_INPUT");
  const pixels = Buffer.from(encoded, "base64");
  if (pixels.length !== 256 * 192 || pixels.some((p) => p > 15))
    throw new ApiError(400, "INVALID_INPUT");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(192, 4);
  header[8] = 8;
  header[9] = 3;
  const colors = Buffer.from(
    palette.flatMap((hex) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
    ),
  );
  const rows = Buffer.alloc(192 * 257);
  for (let y = 0; y < 192; y++)
    pixels.copy(rows, y * 257 + 1, y * 256, (y + 1) * 256);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("PLTE", colors),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
