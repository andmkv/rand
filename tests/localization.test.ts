import { it, expect, vi } from "vitest";
vi.mock("../src/locales/ru.imported.json", () => ({
  default: {
    "ui.saveFile": "Сохранить файл",
    "errors.quote": "Добавь закрывающую кавычку.",
    "errorValues.size": "размер",
    "story.tower.title": "Башня без лестниц",
    "story.tower.scene.0.paragraph.0": "В башне исчезли ступени.",
    "story.tower.scene.0.hint": "Найди TEXT в книге.",
    "story.tower.scene.0.example.string.0": "ПРИВЕТ, БАШНЯ",
    "example.name.title": "ВОЛШЕБНОЕ ИМЯ",
    "example.name.code.string.0": "Как тебя зовут?",
    "spell.input.description": "Спроси имя.",
    "spell.input.code.string.0": "Твоё имя?",
  },
}));
import { t, message, content } from "../src/i18n";
import { examples } from "../src/content/examples";
import { spells } from "../src/content/spellbook";
import { scenes, storyTitle } from "../src/content/story";
it("imported UI/errors override demo resources while English is untouched", () => {
  expect(t("saveFile", "ru")).toBe("Сохранить файл");
  expect(t("saveFile", "en")).toBe("Save file");
  expect(message("quote", {}, "ru")).toBe("Добавь закрывающую кавычку.");
  expect(message("range", { value: "size" }, "ru")).toContain("размер");
});
it("imported examples translate human literals and titles, keeping BASIC syntax and IDs", () => {
  const ex = content("examples", examples, "ru").find(
    (ex) => ex.id === "name",
  )!;
  expect(ex.title).toBe("ВОЛШЕБНОЕ ИМЯ");
  expect(ex.code).toContain('INPUT "Как тебя зовут?", NAME');
  expect(ex.code).toContain('SOUND "coin"');
  expect(examples.find((ex) => ex.id === "name")!.title).toBe("MAGIC NAME");
});
it("imported Spellbook prose and runnable prompts share stable entry IDs", () => {
  const entry = content("spells", spells, "ru").find((s) => s.id === "input")!;
  expect(entry.name).toBe("INPUT");
  expect(entry.description).toBe("Спроси имя.");
  expect(entry.code).toContain('INPUT "Твоё имя?",NAME');
});
it("imported story prose, hints and solution literals retain chapter identity", () => {
  const first = content("scenes", scenes, "ru")[0];
  expect(content("storyTitle", storyTitle, "ru")).toBe("Башня без лестниц");
  expect(first.id).toBe("0");
  expect(first.paragraphs[0]).toBe("В башне исчезли ступени.");
  expect(first.hint).toBe("Найди TEXT в книге.");
  expect(first.example).toContain('TEXT 40,90,"ПРИВЕТ, БАШНЯ"');
});
