import { and, eq } from "drizzle-orm";
import type { Database } from "./db/client.js";
import { userAssets, userAssetVersions } from "./db/schema.js";
import { ApiError } from "./errors.js";
import {
  canonicalSpriteAsset,
  canonicalSoundRecipe,
  type SpriteAssetV1,
  type SoundRecipeV1,
  type ProjectAssetManifestV1,
} from "../shared/assets.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function canonicalSprite(value: unknown): SpriteAssetV1 {
  try {
    return canonicalSpriteAsset(value);
  } catch {
    throw new ApiError(400, "INVALID_INPUT");
  }
}

function canonicalSound(value: unknown): SoundRecipeV1 {
  try { return canonicalSoundRecipe(value); }
  catch { throw new ApiError(400, "INVALID_INPUT"); }
}

/** Project bindings may pin only versions that this account actually owns. */
export async function assertOwnedSpriteBindings(
  tx: Database | Tx,
  ownerId: string,
  manifest: ProjectAssetManifestV1 | undefined,
) {
  if (!manifest) return;
  for (const binding of manifest.sprites) {
    if (!binding.assetId) continue;
    const [row] = await tx
      .select({ asset: userAssets, version: userAssetVersions })
      .from(userAssets)
      .innerJoin(
        userAssetVersions,
        and(
          eq(userAssetVersions.assetId, userAssets.id),
          eq(userAssetVersions.id, binding.versionId!),
        ),
      )
      .where(and(eq(userAssets.id, binding.assetId), eq(userAssets.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new ApiError(404, "NOT_FOUND");
    if (
      row.asset.alias !== binding.alias ||
      row.version.number !== binding.version ||
      JSON.stringify(canonicalSprite(row.version.sprite)) !==
        JSON.stringify(canonicalSprite(binding.sprite))
    )
      throw new ApiError(400, "INVALID_INPUT");
  }
}

/** Audio bindings are owner pinned in private snapshots and bundled for public views. */
export async function assertOwnedSoundBindings(
  tx: Database | Tx,
  ownerId: string,
  manifest: ProjectAssetManifestV1 | undefined,
) {
  if (!manifest) return;
  for (const binding of manifest.sounds ?? []) {
    if (!binding.assetId) continue;
    const [row] = await tx
      .select({ asset: userAssets, version: userAssetVersions })
      .from(userAssets)
      .innerJoin(
        userAssetVersions,
        and(
          eq(userAssetVersions.assetId, userAssets.id),
          eq(userAssetVersions.id, binding.versionId!),
        ),
      )
      .where(and(eq(userAssets.id, binding.assetId), eq(userAssets.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new ApiError(404, "NOT_FOUND");
    if (
      row.asset.type !== binding.type ||
      row.asset.alias !== binding.alias ||
      row.version.number !== binding.version ||
      JSON.stringify(canonicalSound(row.version.sprite)) !==
        JSON.stringify(canonicalSound(binding.recipe))
    ) throw new ApiError(400, "INVALID_INPUT");
  }
}
