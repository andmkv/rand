// Startup-only operator configuration. Reject invalid limits instead of silently widening quotas.
export function readLimits(env: NodeJS.ProcessEnv = process.env) {
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d+$/.test(raw))
      throw new Error(`Invalid ${name}: expected an integer`);
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new Error(`Invalid ${name}: outside supported range`);
    return n;
  };
  return {
    sourceCharacters: integer("MAX_SOURCE_CHARACTERS", 100000, 1000, 100000),
    projectsPerUser: integer("MAX_PROJECTS_PER_USER", 1000, 1, 10000),
    payloadBytes: integer(
      "MAX_PROJECT_PAYLOAD_BYTES",
      512 * 1024,
      4096,
      2 * 1024 * 1024,
    ),
    publicationsPer15Minutes: integer(
      "MAX_PUBLICATIONS_PER_15_MINUTES",
      20,
      1,
      200,
    ),
    autosavesPerMinute: integer("MAX_AUTOSAVES_PER_MINUTE", 120, 1, 1200),
    historyCount: integer("REVISION_KEEP_COUNT", 50, 2, 500),
    historyDays: integer("REVISION_KEEP_DAYS", 30, 1, 3650),
  };
}
export const platformLimits = readLimits();
