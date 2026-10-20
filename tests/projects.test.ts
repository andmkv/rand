import { it, expect } from "vitest";
import { instructionsMax } from "../shared/limits";
import {
  freshProject,
  parseProject,
  serializeProject,
  readProjectFile,
  projectFilename,
} from "../src/project";
it("canonical .randusr round trip preserves editable code and story progress", async () => {
  const p = {
    ...freshProject(),
    title: "Даня, Živjo",
    instructions: "← → — движение\n🎮 <img src=x onerror=alert(1)>",
    sourceCode: 'TEXT 10,10,"Привет, Даня!"',
    sceneId: 4,
    unlocked: 5,
  };
  const raw = serializeProject(p);
  const imported = await readProjectFile(
    new File([raw], "story.randusr", { type: "application/json" }),
  );
  expect(imported).toEqual(p);
  expect(projectFilename(p)).toBe("Даня, Živjo.randusr");
  expect(JSON.parse(raw)).not.toHaveProperty("pixels");
});
it("treats instructions as bounded plain text and migrates older v2 files", () => {
  const { instructions: _instructions, ...legacy } = freshProject();
  const migrated = parseProject(JSON.stringify(legacy));
  expect(migrated.instructions).toBe("");
  expect(migrated.sourceCode).toBe(legacy.sourceCode);

  for (const instructions of [42, "🎮".repeat(instructionsMax + 1)])
    expect(() =>
      parseProject(JSON.stringify({ ...legacy, instructions })),
    ).toThrow();

  expect(
    parseProject(
      JSON.stringify({
        ...legacy,
        instructions: "<script>\n日本語 🎮",
      }),
    ).instructions,
  ).toBe("<script>\n日本語 🎮");
});

it("migrates valid v1 projects and preserves code", () => {
  const { format, mode, ...old } = freshProject();
  const p = parseProject(
    JSON.stringify({ ...old, version: 1, tab: "examples" }),
  );
  expect(p.version).toBe(2);
  expect(p.mode).toBe("sandbox");
  expect(p.sourceCode).toBe(old.sourceCode);
});
it("rejects invalid and future imports without replacing the caller project", () => {
  const p = freshProject();
  for (const bad of [
    "garbage",
    "null",
    JSON.stringify({ ...p, version: 99 }),
    JSON.stringify({ ...p, mode: "oops" }),
    JSON.stringify({ ...p, sceneId: 8, unlocked: 0 }),
  ])
    expect(() => parseProject(bad)).toThrow();
  expect(p).toEqual(parseProject(serializeProject(p)));
});
it("rejects oversized files before reading them", async () => {
  await expect(
    readProjectFile(new File(["x".repeat(1000001)], "big.randusr")),
  ).rejects.toMatchObject({ code: "importLarge" });
});
