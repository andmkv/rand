import { examples } from "./content/examples";
import { isValidProjectInstructions } from "../shared/limits";
import {
  assertProjectAssetManifest,
  type ProjectAssetManifestV1,
} from "../shared/assets";
import { portableProjectSnapshot } from "../shared/project";
import { SpellError } from "./runtime/language";
export type Mode = "story" | "sandbox";
export interface Project {
  format: "randusr";
  version: 2;
  title: string;
  /** Plain text, with Unicode and line breaks preserved. */
  instructions?: string;
  assetManifest?: ProjectAssetManifestV1;
  sourceCode: string;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
  storyId: "tower";
  sceneId: number;
  unlocked: number;
  exampleId: string | null;
}
// Retain the storage key so installed MVP workspaces migrate without losing code.
export const projectKey = "randomize-usr.project.v1";
export function freshProject(): Project {
  const now = new Date().toISOString();
  return {
    format: "randusr",
    version: 2,
    title: "",
    instructions: "",
    sourceCode: examples[0].code,
    mode: "story",
    createdAt: now,
    updatedAt: now,
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: "tunnel",
  };
}
export function parseProject(raw: string): Project {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    throw new SpellError("importInvalid");
  }
  if (p?.version > 2)
    throw new SpellError("importVersion", { version: p.version });
  if (
    !p ||
    ![1, 2].includes(p.version) ||
    typeof p.sourceCode !== "string" ||
    p.sourceCode.length > 100000 ||
    typeof p.title !== "string" ||
    p.title.length > 120 ||
    (p.instructions !== undefined &&
      !isValidProjectInstructions(p.instructions)) ||
    typeof p.createdAt !== "string" ||
    !Number.isFinite(Date.parse(p.createdAt)) ||
    typeof p.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(p.updatedAt)) ||
    p.storyId !== "tower" ||
    !Number.isInteger(p.sceneId) ||
    p.sceneId < 0 ||
    p.sceneId > 8 ||
    !Number.isInteger(p.unlocked) ||
    p.unlocked < 0 ||
    p.unlocked > 9 ||
    p.sceneId > p.unlocked ||
    (p.exampleId !== null && !examples.some((e) => e.id === p.exampleId))
  )
    throw new SpellError("importInvalid");
  if (p.assetManifest !== undefined) {
    try {
      assertProjectAssetManifest(p.assetManifest);
    } catch {
      throw new SpellError("importInvalid");
    }
  }
  const mode =
    p.version === 1 ? (p.tab === "story" ? "story" : "sandbox") : p.mode;
  if (
    !["story", "sandbox"].includes(mode) ||
    (p.version === 2 && p.format !== "randusr") ||
    (p.version === 1 && !["story", "spellbook", "examples"].includes(p.tab))
  )
    throw new SpellError("importInvalid");
  return {
    format: "randusr",
    version: 2,
    title: p.title,
    instructions: p.instructions ?? "",
    ...(p.assetManifest !== undefined ? { assetManifest: p.assetManifest } : {}),
    sourceCode: p.sourceCode,
    mode,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    storyId: "tower",
    sceneId: p.sceneId,
    unlocked: p.unlocked,
    exampleId: p.exampleId,
  };
}
export function decodeProject(raw: string | null): Project {
  try {
    return parseProject(raw ?? "null");
  } catch {
    return freshProject();
  }
}
export function loadProject() {
  try {
    return decodeProject(localStorage.getItem(projectKey));
  } catch {
    return freshProject();
  }
}
export function serializeProject(p: Project): string {
  const normalized = parseProject(JSON.stringify(p));
  return JSON.stringify(portableProjectSnapshot(normalized), null, 2) + "\n";
}
export async function readProjectFile(file: File): Promise<Project> {
  if (file.size > 1000000) throw new SpellError("importLarge");
  return parseProject(await file.text());
}
export function projectFilename(p: Project): string {
  return (
    (p.title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "project") +
    ".randusr"
  );
}
// Remembers the child's own code per Story chapter so switching chapters never loses it.
export const chaptersKey = "randomize-usr.chapters.v1";
export function readChapterCode(id: number): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(chaptersKey) ?? "{}");
    const code = all?.[id];
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}
export function writeChapterCode(id: number, code: string | null) {
  try {
    const all = JSON.parse(localStorage.getItem(chaptersKey) ?? "{}") ?? {};
    if (code === null) delete all[id];
    else all[id] = code;
    localStorage.setItem(chaptersKey, JSON.stringify(all));
  } catch {
    /* local memory is a convenience only */
  }
}
export function clearChapterCode() {
  try {
    localStorage.removeItem(chaptersKey);
  } catch {
    /* ignore */
  }
}
export const sandboxStarter = "INK 6\nCIRCLE 128,96,40";
