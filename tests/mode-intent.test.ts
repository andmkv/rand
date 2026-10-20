import { describe, expect, it } from "vitest";
import {
  adoptOpenedProject,
  modeIntentSince,
  noModeIntent,
  recordModeIntent,
} from "../src/mode-intent";
import { freshProject, type Project } from "../src/project";

const sandboxProject = (): Project => ({
  ...freshProject(),
  mode: "sandbox",
  sourceCode: "INK 2\nPRINT \"SANDBOX\"",
  title: "Sandbox program",
  instructions: "Press RUN to see the tower.",
  sceneId: 3,
  unlocked: 5,
});

describe("explicit mode intent survives a slow project load", () => {
  it("keeps the mode stored in the opened project when the child made no choice", () => {
    const project = sandboxProject();
    expect(adoptOpenedProject(project, noModeIntent, 0)).toBe(project);
  });

  it("applies a STORY choice made after the load was requested", () => {
    const intent = recordModeIntent(noModeIntent, "story");
    const opened = adoptOpenedProject(sandboxProject(), intent, 0);
    expect(opened.mode).toBe("story");
  });

  it("applies a Sandbox choice made after a Story load was requested", () => {
    const intent = recordModeIntent(noModeIntent, "sandbox");
    const opened = adoptOpenedProject(
      { ...sandboxProject(), mode: "story" },
      intent,
      0,
    );
    expect(opened.mode).toBe("sandbox");
  });

  it("ignores a choice made before the load started", () => {
    const intent = recordModeIntent(noModeIntent, "story");
    expect(modeIntentSince(intent, intent.version)).toBeNull();
    expect(adoptOpenedProject(sandboxProject(), intent, intent.version).mode).toBe(
      "sandbox",
    );
  });

  it("uses the latest choice when the child changed mode more than once", () => {
    const story = recordModeIntent(noModeIntent, "story");
    const sandbox = recordModeIntent(story, "sandbox");
    expect(modeIntentSince(sandbox, 0)).toBe("sandbox");
  });

  it("keeps code, instructions, chapter and progress of the loaded project", () => {
    const project = sandboxProject();
    const opened = adoptOpenedProject(
      project,
      recordModeIntent(noModeIntent, "story"),
      0,
    );
    expect(opened).toEqual({ ...project, mode: "story" });
    expect(opened.instructions).toBe("Press RUN to see the tower.");
    expect(opened.sceneId).toBe(3);
    expect(opened.unlocked).toBe(5);
  });

  it("never mutates the loaded project", () => {
    const project = sandboxProject();
    const before = { ...project };
    adoptOpenedProject(project, recordModeIntent(noModeIntent, "story"), 0);
    expect(project).toEqual(before);
  });
});
