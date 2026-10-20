import { spriteAssets } from "./assets";
// Rendering lookup derived from the same canonical entries shown in INVENTORY.
export const sprites: Record<string, string[]> = Object.fromEntries(
  spriteAssets.map((asset) => [asset.id, asset.pixels]),
);
