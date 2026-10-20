import { open } from "node:fs/promises";
import { ApiError } from "./errors.js";

// Root-generated host summary only; never mount logs, Docker socket or secrets here.
export async function operationsStatus(path = process.env.OPS_STATUS_FILE) {
  if (!path) throw new ApiError(503, "UNAVAILABLE");
  try {
    const file = await open(path, "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 65536) throw new Error();
      const summary = JSON.parse(await file.readFile("utf8"));
      if (summary.version !== 1 || !Number.isFinite(summary.checkedAt))
        throw new Error();
      return { ...summary, stale: Date.now() - summary.checkedAt > 10 * 60000 };
    } finally {
      await file.close();
    }
  } catch {
    throw new ApiError(503, "UNAVAILABLE");
  }
}
