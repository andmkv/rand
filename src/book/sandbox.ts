/**
 * "Open in Sandbox" for Handbook examples.
 *
 * The editor autosaves one local project in this browser. Opening an example replaces that project's
 * code, so the reader asks first unless there is nothing worth keeping (the starter project, an
 * unchanged Story starter or Example, or the very same code).
 */
import { examples } from "../content/examples";
import type { ProjectAssetManifestV1 } from "../../shared/assets";
import { scenes } from "../content/story";
import { cloudLinkKey } from "../cloudStorage";
import {
  freshProject,
  loadProject,
  projectFilename,
  projectKey,
  serializeProject,
  type Project,
} from "../project";

const norm = (code: string) => code.replace(/\s+$/gm, "").trim();

export interface LocalWork {
  project: Project;
  /** True when replacing the project would discard something the person may have written. */
  worthKeeping: boolean;
  lines: number;
}

export function inspectLocalWork(incoming: string): LocalWork {
  const project = loadProject();
  const code = norm(project.sourceCode);
  const known =
    !code ||
    code === norm(incoming) ||
    examples.some((e) => norm(e.code) === code) ||
    scenes.some((s) => norm(s.starter) === code);
  return {
    project,
    worthKeeping: !known,
    lines: project.sourceCode.split("\n").length,
  };
}

/** Replace the local project with the example and go to the editor. Throws if storage is blocked. */
export function openExample(
  code: string,
  title: string,
  assetManifest?: ProjectAssetManifestV1,
): void {
  const now = new Date().toISOString();
  const project: Project = {
    ...freshProject(),
    title: title.slice(0, 120),
    mode: "sandbox",
    sourceCode: code,
    instructions: "",
    exampleId: null,
    ...(assetManifest ? { assetManifest } : {}),
    createdAt: now,
    updatedAt: now,
  };
  localStorage.setItem(projectKey, JSON.stringify(project));
  // A cloud link would let autosave overwrite the person's cloud project with this example.
  localStorage.removeItem(cloudLinkKey);
  location.assign("/create?mode=sandbox");
}

/** Offer the current local project as a .randusr download. */
export function downloadProject(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = projectFilename(project);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
