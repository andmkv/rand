import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { ApiError } from "./errors.js";
export function decodeCursor(
  raw?: string,
): { at: string; id: string } | undefined {
  if (!raw) return;
  try {
    const [at, id] = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (
      typeof at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(at) ||
      !Number.isFinite(Date.parse(at)) ||
      new Date(at).toISOString().slice(0, 19) !== at.slice(0, 19) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw Error();
    return { at, id };
  } catch {
    throw new ApiError(400, "INVALID_INPUT");
  }
}
export const encodeCursor = (at: string, id: string) =>
  Buffer.from(JSON.stringify([at, id])).toString("base64url");
export const cursorTime = (column: AnyPgColumn) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
