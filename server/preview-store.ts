import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { projectPreviews } from "./db/schema.js";
import type { Database } from "./db/client.js";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function storePreview(tx: Tx, projectId: string, png: Buffer) {
  const [asset] = await tx
    .insert(projectPreviews)
    .values({
      projectId,
      png,
      byteLength: png.length,
      sha256: createHash("sha256").update(png).digest("hex"),
    })
    .returning({ key: projectPreviews.id });
  return asset.key;
}
export async function prunePreviews(tx: Tx, projectId: string) {
  await tx.delete(projectPreviews).where(
    and(
      eq(projectPreviews.projectId, projectId),
      sql`NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.id=${projectPreviews.projectId} AND p.deleted_at IS NULL
    AND (p.preview_key=${projectPreviews.id}::text OR p.published_metadata->>'previewKey'=${projectPreviews.id}::text))`,
    ),
  );
}
