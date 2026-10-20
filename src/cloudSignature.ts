import type { Project } from "./project";

/** Recursively sort object keys while preserving array order for stable snapshots. */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

/**
 * A cloud checkpoint must survive JSON/JSONB round-trips, which may reorder keys.
 * Empty instructions remain equivalent to the pre-instructions project shape.
 */
export function cloudProjectSignature(project: Project): string {
  const { instructions, ...legacyShape } = project;
  return (
    JSON.stringify(
      canonicalValue(
        instructions ? { ...legacyShape, instructions } : legacyShape,
      ),
    ) ?? ""
  );
}
