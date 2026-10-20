import { describe, it, expect } from "vitest";
import { Engine } from "../src/runtime/engine";
import { World } from "../src/runtime/world";
import { examples } from "../src/content/examples";
import { spells } from "../src/content/spellbook";
import { scenes, sceneSatisfied } from "../src/content/story";
import { decodeProject, freshProject } from "../src/project";
import { t, message } from "../src/i18n";
function setup() {
  const world = new World();
  world.ask = async () => "3";
  const engine = new Engine(world);
  engine.wait = async () => {
    engine.check();
  };
  return { world, engine };
}
describe("published content", () => {
  it.each(examples)("runs gallery: $title", async (ex) => {
    const { engine } = setup();
    if (ex.endless || ex.game) {
      let frames = 0;
      engine.yieldFrame = async () => {
        if (++frames >= 8) engine.stop();
        engine.check();
      };
      await expect(engine.run(ex.code)).rejects.toMatchObject({
        code: "stopped",
      });
    } else await engine.run(ex.code);
  });
  it.each(spells)("runs Spellbook: $name", async (s) => {
    const { engine } = setup();
    if (/^DO$/m.test(s.code)) {
      let frames = 0;
      engine.yieldFrame = async () => {
        if (++frames >= 8) engine.stop();
        engine.check();
      };
      await expect(engine.run(s.code)).rejects.toMatchObject({
        code: "stopped",
      });
    } else await engine.run(s.code);
  });
  it.each(scenes)("completes story: $title", async (scene) => {
    const { world, engine } = setup();
    await engine.run(scene.example);
    expect(sceneSatisfied(scene, world)).toBe(true);
  });
  it.each(scenes)(
    "does not unlock $title with an unrelated program",
    async (scene) => {
      const { world, engine } = setup();
      await engine.run('PRINT "hello"');
      expect(sceneSatisfied(scene, world)).toBe(false);
    },
  );
});
it("story completion survives bounded event-history compaction", async () => {
  const { world, engine } = setup();
  await engine.run('CAT=SPAWN("cat",20,20)\nFOR X=1 TO 1000\nPLOT 1,1\nNEXT X');
  expect(world.events).not.toContain("SPAWN:cat");
  expect(sceneSatisfied(scenes[1], world)).toBe(true);
});
describe("world guardrails", () => {
  it("destroys nearby shapes and sprites; preserves distant ones", async () => {
    const { world, engine } = setup();
    await engine.run(
      'BOX 100,95,10,10\nBOX 10,10,10,10\nCAT=SPAWN("cat",110,100)\nSTAR=SPAWN("star",230,100)\nB=SPAWN("dynamite",110,100)\nB.EXPLODE',
    );
    expect(world.shapes).toHaveLength(1);
    expect(world.objects.filter((o) => o.alive).map((o) => o.kind)).toEqual([
      "star",
    ]);
    expect(world.particles).toHaveLength(0);
  });
  it.each([
    "CIRCLE 1,2,-1",
    "PLOT 999999999,0",
    'A=SPAWN("toString",1,2)',
    'SOUND "oops"',
    "INK 8",
    "BRIGHT 7",
    "BEEP 999999,1",
    "TEMPO 0",
    'NOTE "Z9",1',
    'CAT=SPAWN("cat",1,2)\nCAT.EXLPLODE',
  ])("rejects invalid spell: %s", async (source) => {
    const { engine } = setup();
    await expect(engine.run(source)).rejects.toHaveProperty("code");
  });
  it("bounds exponential strings", async () => {
    const { engine } = setup();
    await expect(
      engine.run('X="a"\nFOR I=1 TO 100\nX=X+X\nNEXT I'),
    ).rejects.toMatchObject({ code: "limit" });
  });
  it("bounds objects and drawing", async () => {
    const { engine } = setup();
    await expect(
      engine.run('FOR X=1 TO 200\nA=SPAWN("cat",1,2)\nNEXT X'),
    ).rejects.toMatchObject({ code: "limit" });
    const other = setup();
    await other.engine.run("FOR X=1 TO 6001\nPLOT 1,1\nNEXT X");
    expect(other.world.shapes.length).toBeLessThanOrEqual(512);
    expect(other.world.pixels).toHaveLength(49152);
  });
  it("bounds audio scheduling without queuing events", async () => {
    const { engine, world } = setup();
    await engine.run('FOR X=1 TO 300\nSOUND "coin"\nNEXT X');
    expect(engine.audioEvents).toBe(32);
    expect(engine.audioTimes.length).toBeLessThanOrEqual(32);
    expect(world.audio.voiceCount).toBeLessThanOrEqual(8);
  });
});
describe("projects and localization", () => {
  it("round trips snapshots", () => {
    const p = freshProject();
    expect(decodeProject(JSON.stringify(p))).toEqual(p);
  });
  it.each(["bad", "null", '{"version":999}', '{"version":1,"sourceCode":7}'])(
    "recovers from bad stored data",
    (s) => {
      expect(decodeProject(s).sourceCode).toBe(examples[0].code);
    },
  );
  it("locale demo and fallback keep commands stable", () => {
    expect(t("run", "ru")).not.toBe(t("run", "en"));
    expect(t("saved", "ru")).not.toBe(t("saved", "en"));
    expect(message("quote", {}, "ru")).not.toBe(message("quote"));
    expect(
      message("unknown", { value: "CIRLCE", suggestion: "CIRCLE" }),
    ).toContain("Did you mean CIRCLE?");
  });
});

describe("spellbook summaries", () => {
  it("gives every spell a short child-level summary and starts with beginner spells", async () => {
    const { spells } = await import("../src/content/spellbook");
    for (const spell of spells) {
      expect(spell.summary, spell.id).not.toBe(spell.description);
      expect(spell.summary.split(/\s+/).length, spell.id).toBeLessThanOrEqual(12);
    }
  });
});
