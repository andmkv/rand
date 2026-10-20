import type { AnimatedSpriteV1 } from "../../shared/assets";

/** Deterministic, run-relative frame selection; no timer or mutable playback state. */
export function animationFrameIndex(
  sprite: AnimatedSpriteV1,
  elapsedMs: number,
): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const steps = Math.floor((elapsed * sprite.fps) / 1000 + 1e-9);
  return sprite.loop
    ? steps % sprite.frames.length
    : Math.min(steps, sprite.frames.length - 1);
}

/** Whether a non-looping sprite still needs another animation paint. */
export function animationIsPlaying(
  sprite: AnimatedSpriteV1,
  elapsedMs: number,
): boolean {
  if (sprite.frames.length <= 1) return false;
  if (sprite.loop) return true;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return Math.floor((elapsed * sprite.fps) / 1000 + 1e-9) < sprite.frames.length - 1;
}
