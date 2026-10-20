import { en } from "../src/locales/en";
import { it, expect } from "vitest";
import { locales, isLocale, content, message, t } from "../src/i18n";
import { tables } from "../src/locales/tables";
import { examples } from "../src/content/examples";
import { spells } from "../src/content/spellbook";
import { scenes, sceneSatisfied } from "../src/content/story";
import { parse } from "../src/runtime/language";
import { Engine } from "../src/runtime/engine";
import { World } from "../src/runtime/world";
import { programStrings } from "../src/content/translation";
import { glyphFor, fallbackGlyph, textWidth } from "../src/runtime/pixel-font";

it("locale registry safely handles saved preferences", () => {
  expect(locales).toHaveLength(8);
  for (const { id } of locales) expect(isLocale(id)).toBe(true);
  for (const id of [null, "", "../ru", "sr", "xx"])
    expect(isLocale(id)).toBe(false);
});
for (const { id } of locales.filter((locale) => locale.id !== "en")) {
  it(`${id}: complete translated programs parse, preserve IDs and have supported glyphs`, () => {
    const gallery = content("examples", examples, id);
    expect(gallery.map((e) => e.id)).toEqual(examples.map((e) => e.id));
    const programs = [
      ...gallery.map((e) => e.code),
      ...content("spells", spells, id).map((s) => s.code),
      ...content("scenes", scenes, id).flatMap((s) => [s.example, s.starter]),
    ];
    const missing = new Set<string>();
    for (const source of programs) {
      expect(() => parse(source)).not.toThrow();
      for (const word of programStrings(source))
        for (const char of word.source.normalize("NFC"))
          if (glyphFor(char) === fallbackGlyph) missing.add(char);
    }
    expect([...missing]).toEqual([]);
    expect(t("saved", id)).not.toBe(t("saved", "en"));
    expect(message("args", { value: "CIRCLE", count: 3 }, id)).toContain(
      "CIRCLE",
    );
    expect(message("args", { value: "CIRCLE", count: 3 }, id)).toContain("3");
    expect(message("args", { value: "CIRCLE", count: 3 }, id)).not.toMatch(
      /\{\w+\}/,
    );
    // Human titles change; machine asset IDs and key names in all games do not.
    for (const game of gallery.filter((e) => e.game)) {
      expect(game.code).toContain('KEY("R")');
      expect(game.code).toContain("FRAME");
      expect(game.code).toContain(gamesTitle(game.id));
    }
    for (const key of Object.keys(en.hosted))
      expect(tables[id][`hosted.${key}`]).toBeTruthy();
  });
  it(`${id}: every published localized example and Spellbook snippet runs`, async () => {
    for (const entry of [
      ...content("examples", examples, id),
      ...content("spells", spells, id),
    ]) {
      const world = new World(),
        engine = new Engine(world);
      world.ask = async () => "3";
      engine.wait = async () => engine.check();
      let frames = 0;
      if (/^\s*DO\s*$/m.test(entry.code))
        engine.yieldFrame = async () => {
          if (++frames >= 8) engine.stop();
          engine.check();
        };
      if (/^\s*DO\s*$/m.test(entry.code))
        await expect(engine.run(entry.code)).rejects.toMatchObject({
          code: "stopped",
        });
      else await engine.run(entry.code);
    }
    for (const scene of content("scenes", scenes, id)) {
      const world = new World(),
        engine = new Engine(world);
      world.ask = async () => "3";
      engine.wait = async () => engine.check();
      await engine.run(scene.example);
      expect(sceneSatisfied(scene, world)).toBe(true);
    }
  });
}
function gamesTitle(id: string) {
  return id === "alien-attack"
    ? 'SPAWN("alien"'
    : id === "brick-breaker"
      ? 'SPAWN("paddle"'
      : 'SPAWN("traveler"';
}
it("Japanese uses real bitmap characters, while unknown symbols retain explicit fallback", () => {
  for (const character of "こんにちは塔星庭ネコ宇宙船")
    expect(glyphFor(character)).not.toBe(fallbackGlyph);
  expect(textWidth("日本語")).toBeLessThanOrEqual(51);
  expect(glyphFor("🦄")).toBe(fallbackGlyph);
});
