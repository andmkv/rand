import metadata from "./stories/en/tower.json";
import tower from "./stories/en/tower.md?raw";
import type { World } from "../runtime/world";
export interface Scene {
  id: string;
  title: string;
  paragraphs: string[];
  starter: string;
  example: string;
  hint: string;
  next?: string;
  condition: {
    event?: string;
    minimum?: number;
    events?: string[];
    sprites?: number;
    shapes?: number;
  };
}
export function loadScenes(
  markdown: string,
  localizedMetadata: typeof metadata = metadata,
): Scene[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((chunk, i) => {
      const [title, ...rest] = chunk.trim().split("\n");
      return {
        id: String(i),
        title,
        paragraphs: rest
          .join("\n")
          .trim()
          .split(/\n\s*\n/),
        ...localizedMetadata[i],
        next: i < localizedMetadata.length - 1 ? String(i + 1) : undefined,
      };
    });
}
export const storyTitle = tower.split("\n")[0].replace(/^# /, "");
export const scenes = loadScenes(tower);
export function sceneSatisfied(scene: Scene, world: World) {
  const c = scene.condition;
  return (
    (!c.event || (world.eventCounts.get(c.event) ?? 0) >= (c.minimum ?? 1)) &&
    (!c.events || c.events.every((e) => world.eventCounts.has(e)))
  );
}
