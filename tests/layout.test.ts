import { describe, it, expect } from "vitest";
import { placeWorkspace } from "../src/layout";
describe("SCREEN scale is a whole number of device pixels", () => {
  const sizes = [
    [1440, 794],
    [1348, 795],
    [932, 663],
    [744, 1081],
    [1828, 975],
    [600, 500],
  ];
  for (const dpr of [1, 1.25, 1.5, 2, 3])
    for (const [width, height] of sizes)
      for (const story of [false, true])
        it(`${width}×${height} @${dpr}x story=${story}`, () => {
          const { scale } = placeWorkspace({ width, height, dpr, story, strip: story });
          expect(scale).toBeGreaterThanOrEqual(1);
          // 256·scale and 192·scale are whole device pixels, so every SCREEN pixel is drawn the same width.
          expect(Math.abs(256 * scale * dpr - Math.round(256 * scale * dpr))).toBeLessThan(1e-6);
          expect(Math.abs(192 * scale * dpr - Math.round(192 * scale * dpr))).toBeLessThan(1e-6);
        });
  it("Story keeps the SCREEN large at 1440×900 and CODE usable at 1024×768", () => {
    expect(placeWorkspace({ width: 1348, height: 795, dpr: 1, story: true, strip: true }).scale).toBe(2);
    expect(placeWorkspace({ width: 1348, height: 795, dpr: 1, story: false, strip: false }).scale).toBe(3);
    expect(placeWorkspace({ width: 932, height: 663, dpr: 1, story: true, strip: true }).scale).toBe(2);
    expect(placeWorkspace({ width: 1348, height: 795, dpr: 2, story: true, strip: true }).scale).toBe(2.5);
  });
  it("portrait tablets stack SCREEN above CODE", () => {
    expect(placeWorkspace({ width: 744, height: 1081, dpr: 1, story: true, strip: true }).layout).toBe("stack");
  });
  it("a narrow public viewer stacks when its split info column cannot fit", () => {
    expect(
      placeWorkspace({
        width: 314,
        height: 776,
        dpr: 1,
        story: false,
        strip: false,
        viewer: true,
      }).layout,
    ).toBe("stack");
  });
});
