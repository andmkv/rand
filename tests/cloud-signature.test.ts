import { describe, expect, it } from "vitest";
import type { AnimatedSpriteV1 } from "../shared/assets";
import type { Project } from "../src/project";
import { cloudProjectSignature } from "../src/cloudSignature";

const animation: AnimatedSpriteV1 = {
  format: "randusr.animated-sprite",
  version: 1,
  width: 1,
  height: 1,
  frames: [[1]],
  palette: [0, 14],
  transparentIndex: 0,
  fps: 7,
  loop: true,
};

function project(assetManifest?: Project["assetManifest"]): Project {
  return {
    format: "randusr",
    version: 2,
    title: "Walk",
    instructions: "",
    sourceCode: 'HERO = SPAWN("@walk",40,80)',
    mode: "sandbox",
    createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:01.000Z",
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: null,
    ...(assetManifest ? { assetManifest } : {}),
  };
}

describe("cloud project signature", () => {
  it("ignores object key order at every JSON/JSONB depth but preserves arrays", () => {
    const before = project({
      version: 1,
      sprites: [
        {
          type: "sprite",
          alias: "@walk",
          name: "Walk",
          assetId: "asset",
          versionId: "version",
          version: 1,
          sprite: animation,
        },
      ],
    });
    const after = JSON.parse(JSON.stringify(before)) as Project;
    expect(cloudProjectSignature(after)).toBe(cloudProjectSignature(before));

    const changed = structuredClone(before);
    changed.assetManifest!.sprites[0].sprite = {
      ...animation,
      frames: [[0]],
    };
    expect(cloudProjectSignature(changed)).not.toBe(
      cloudProjectSignature(before),
    );
  });

  it("keeps empty instructions compatible with legacy cloud signatures", () => {
    const current = project();
    const legacy = { ...current } as Partial<Project>;
    delete legacy.instructions;
    expect(cloudProjectSignature(current)).toBe(
      cloudProjectSignature(legacy as Project),
    );
  });
});
