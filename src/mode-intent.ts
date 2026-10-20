import type { Mode, Project } from "./project";

/**
 * The user's explicit mode choice, versioned so a slow project load can tell
 * whether the child picked STORY or Sandbox after that load was requested.
 */
export interface ModeIntent {
  version: number;
  mode: Mode | null;
}

export const noModeIntent: ModeIntent = { version: 0, mode: null };

export function recordModeIntent(intent: ModeIntent, mode: Mode): ModeIntent {
  return { version: intent.version + 1, mode };
}

/** The chosen mode when it is newer than the load that asked about it. */
export function modeIntentSince(
  intent: ModeIntent,
  sinceVersion: number,
): Mode | null {
  return intent.version > sinceVersion ? intent.mode : null;
}

/**
 * A project that arrives after the child already chose a mode must not switch
 * the editor back. Its code, instructions, chapter and progress are kept as
 * loaded; only the explicit mode choice wins.
 */
export function adoptOpenedProject(
  project: Project,
  intent: ModeIntent,
  sinceVersion: number,
): Project {
  const mode = modeIntentSince(intent, sinceVersion);
  if (!mode || mode === project.mode) return project;
  return { ...project, mode };
}
