import { it, expect } from "vitest";
import { Engine } from "../src/runtime/engine";
import { World } from "../src/runtime/world";
import { glyphFor, fallbackGlyph, drawText } from "../src/runtime/pixel-font";
import { freshProject, parseProject, serializeProject } from "../src/project";
const samples = [
  "HELLO",
  "ПРИВЕТ",
  "Hello, Даня!",
  "Živjo Ćao Čačak Šuma Đak",
  "Љубав Његош Ђак Ћирилица Џеп",
  "Привіт Єнот Ґанок Їжак",
];
it.each(samples)(
  "every glyph is supported and draws actual pixels: %s",
  (text) => {
    for (const c of text) expect(glyphFor(c)).not.toBe(fallbackGlyph);
    const pixels = new Set<string>();
    drawText((x, y) => pixels.add(`${x},${y}`), 10, 10, text);
    expect(pixels.size).toBeGreaterThan(10);
  },
);
it("unsupported glyphs use a visible crossed box; canonical combining forms match", () => {
  expect(glyphFor("🦄")).toBe(fallbackGlyph);
  const p = (s: string) => {
    const pixels: string[] = [];
    drawText((x, y) => pixels.push(`${x},${y}`), 0, 0, s);
    return pixels;
  };
  expect(p("Ž")).toEqual(p("Z\u030c"));
});
it("Unicode survives INPUT, identifiers, concatenation, PRINT, TEXT and SAY", async () => {
  const w = new World(),
    e = new Engine(w),
    output: string[] = [];
  w.ask = async () => "Даня 🦄";
  w.onPrint = (s) => output.push(s);
  await e.run(
    'INPUT "Как тебя зовут?", ИМЯ\nPRINT "Привет, " + ИМЯ\nTEXT 40,90,"Привет, " + ИМЯ\nКОТ=SPAWN("cat",40,60)\nКОТ.SAY "Привет!"',
  );
  expect(output).toEqual(["Привет, Даня 🦄"]);
  expect(w.objects[0].say).toBe("Привет!");
  expect(w.shapes[0].args[2]).toBe("Привет, Даня 🦄");
  expect(w.pixels.some((v) => v > 0)).toBe(true);
});
it("Unicode errors preserve the entered command or missing identifier", async () => {
  const e = new Engine(new World());
  await expect(e.run("КРУГ 10,20,30")).rejects.toMatchObject({
    params: { value: "КРУГ" },
  });
  const other = new Engine(new World());
  await expect(other.run("PRINT Даня")).rejects.toMatchObject({
    params: { value: "Даня" },
  });
});
it("project source round trips without Unicode normalization or byte loss", () => {
  const source = 'TEXT 10,10,"Hello, Даня! Z\u030c 🦄"';
  const p = { ...freshProject(), sourceCode: source };
  expect(parseProject(serializeProject(p)).sourceCode).toBe(source);
});
