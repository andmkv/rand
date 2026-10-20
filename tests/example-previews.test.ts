import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { examples } from "../src/content/examples";
// Two examples may share a picture only if their programs really draw the same frame.
const sharedFrames: string[][] = [];
describe("example thumbnails", () => {
  const hashes = new Map<string, string[]>();
  for (const ex of examples) {
    const file = new URL(`../public/previews/examples/${ex.id}.png`, import.meta.url);
    it(`${ex.id} has its own pre-rendered frame`, () => {
      expect(existsSync(file), `run scripts/render-example-previews.mjs for ${ex.id}`).toBe(true);
      const png = readFileSync(file);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      const hash = createHash("sha256").update(png).digest("hex");
      hashes.set(hash, [...(hashes.get(hash) ?? []), ex.id]);
    });
  }
  it("no two examples resolve to the same thumbnail unless whitelisted", () => {
    for (const ids of hashes.values())
      if (ids.length > 1)
        expect(
          sharedFrames.some((allowed) => ids.every((id) => allowed.includes(id))),
          `identical thumbnails: ${ids.join(", ")}`,
        ).toBe(true);
  });
});
