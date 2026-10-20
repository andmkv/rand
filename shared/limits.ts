export interface PlatformLimits {
  sourceCharacters: number;
  projectsPerUser: number;
  payloadBytes: number;
  publicationsPer15Minutes: number;
  autosavesPerMinute: number;
  historyCount: number;
  historyDays: number;
}

/** Maximum Unicode code points in plain-text project instructions. */
export const instructionsMax = 2000;

export function isValidProjectInstructions(value: unknown): value is string {
  return (
    typeof value === "string" && Array.from(value).length <= instructionsMax
  );
}
