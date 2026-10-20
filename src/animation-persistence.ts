/**
 * Narrow persistence seam from the animation editor into the canonical sprite API.
 *
 * Ownership boundary: CODEX owns the canonical `AnimatedSpriteV1` contract, the
 * asset API, immutable versions and project/`.usr` serialization (card 119,
 * `shared/assets.ts`, `server/assets.ts`, `docs/ASSETS.md`). This module is the
 * only place where the editor's in-memory `AnimationDraftV1` may cross into
 * persistence, so the eventual integration replaces exactly one object.
 *
 * The canonical contract v1 is published (card 119 comment + branch
 * `codex/animated-sprites-119`): `AnimatedSpriteV1` reuses the existing versioned
 * sprite routes, and `SpriteAssetV1 = IndexedSpriteV1 | AnimatedSpriteV1`. The
 * payload converter lives in `animation-draft.ts`
 * (`spriteAssetFromDraft`, `toAnimatedSpriteV1`, `animationDraftFromAnimatedSprite`)
 * and is unit-tested against that exact shape.
 *
 * The adapter sends the canonical union through the existing private sprite
 * create/version routes. There is intentionally no local draft database, no
 * second server format and no "save the first frame and hope" fallback.
 */
import type { SpriteEditorAdapter, UserSpriteAsset } from "../shared/assets";
import { spriteAssetAdapter } from "./assets";
import {
  spriteAssetFromDraft,
  type AnimationDraftV1,
} from "./animation-draft";

export interface AnimationSaveRequest {
  name: string;
  animation: AnimationDraftV1;
  /** Present when the editor reopened an existing library asset. */
  existing?: { id: string; baseVersion: number };
}

export interface AnimationAssetAdapter {
  /** True only when the canonical animated-asset contract can persist frames. */
  readonly available: boolean;
  save(request: AnimationSaveRequest): Promise<UserSpriteAsset>;
}

/** A one-frame draft stays static; 2+ frames become AnimatedSpriteV1. */
export function createAnimationAssetAdapter(
  writer: Pick<SpriteEditorAdapter, "create" | "saveVersion">,
): AnimationAssetAdapter {
  return {
    available: true,
    async save({ name, animation, existing }) {
      const sprite = spriteAssetFromDraft(animation);
      const saved = existing
        ? await writer.saveVersion(existing.id, {
            baseVersion: existing.baseVersion,
            sprite,
          })
        : await writer.create({ name, sprite });
      return saved;
    },
  };
}

export const animationAssetAdapter = createAnimationAssetAdapter(spriteAssetAdapter);
