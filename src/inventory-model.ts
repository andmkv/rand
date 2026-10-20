import {
  spriteSpawnSnippet,
  type IndexedSpriteV1,
  type UserSpriteAssetSummary,
} from "../shared/assets";
import { assetSnippet, type Asset, type SoundAsset } from "./runtime/assets";
import { spriteFromRows } from "./sprite-editor";
import { soundSnippet, type UserSoundSummary } from "./sound-draft";

/**
 * Typed seam for assets. Built-ins and personal sprites share one item shape; personal sprites
 * are backed by IDEA 01's canonical `IndexedSpriteV1` and stable `@alias`, so inserting one never
 * depends on a UI-only asset list.
 */
export type InventorySource = "standard" | "mine";
export type InventoryCategory = Asset["category"] | "all";
export type InventoryArtwork =
  | { type: "sprite"; sprite: IndexedSpriteV1 }
  | { type: "sound"; asset: SoundAsset }
  /** A personal sound or instrument from the creator's library (Sound Lab). */
  | { type: "usersound"; kind: UserSoundSummary["kind"] };
export interface InventoryItem {
  /** Stable code id: a built-in id (`cat`) or a personal alias (`@hero`). */
  id: string;
  source: InventorySource;
  category: Asset["category"];
  /** English fallback name; the view localizes built-ins with `asset.<id>.name`. */
  name: string;
  tags: string;
  snippet: string;
  artwork: InventoryArtwork;
  /** Library id, present only for editable personal assets. */
  assetId?: string;
}
export function standardItems(registry: Asset[]): InventoryItem[] {
  return registry.map((asset) => ({
    id: asset.id,
    source: "standard",
    category: asset.category,
    name: asset.name,
    tags: asset.tags,
    snippet: assetSnippet(asset),
    artwork:
      asset.category === "sprites"
        ? { type: "sprite", sprite: spriteFromRows(asset.pixels) }
        : { type: "sound", asset },
    ...(asset.category === "sprites" ? { assetId: undefined } : {}),
  }));
}
export function userAssetItems(
  assets: UserSpriteAssetSummary[],
): InventoryItem[] {
  return assets.map((asset) => ({
    id: asset.alias,
    source: "mine",
    category: "sprites",
    name: asset.name,
    tags: "",
    snippet: spriteSpawnSnippet(asset.alias),
    artwork: {
      type: "sprite",
      sprite: {
        format: "randusr.indexed-sprite",
        version: 1,
        width: asset.thumbnail.width,
        height: asset.thumbnail.height,
        pixels: [...asset.thumbnail.pixels],
        palette: [...asset.thumbnail.palette],
        transparentIndex: asset.thumbnail.transparentIndex,
      },
    },
    assetId: asset.id,
  }));
}
export function userSoundItems(sounds: UserSoundSummary[]): InventoryItem[] {
  return sounds.map((sound) => ({
    id: `@${sound.alias}`,
    source: "mine",
    category: "sounds",
    name: sound.name,
    tags: "",
    snippet: soundSnippet(sound.alias, sound.kind),
    artwork: { type: "usersound", kind: sound.kind },
    assetId: sound.id,
  }));
}
export interface InventoryFilter {
  query: string;
  category: InventoryCategory;
}
export function filterInventory(
  items: InventoryItem[],
  filter: InventoryFilter,
  describe: (item: InventoryItem) => string,
): InventoryItem[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (filter.category === "all" || item.category === filter.category) &&
      (!query || describe(item).toLocaleLowerCase().includes(query)),
  );
}
export type GridKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";
export function gridTarget(
  index: number,
  columns: number,
  key: GridKey,
  length: number,
): number {
  if (length === 0) return -1;
  const columnsSafe = Math.max(1, columns);
  const step =
    key === "ArrowRight"
      ? 1
      : key === "ArrowLeft"
        ? -1
        : key === "ArrowDown"
          ? columnsSafe
          : key === "ArrowUp"
            ? -columnsSafe
            : 0;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  const next = index + step;
  if (next < 0 || next >= length) return Math.max(0, Math.min(index, length - 1));
  return next;
}
export function columnCount(gridTemplateColumns: string): number {
  return Math.max(1, gridTemplateColumns.split(" ").filter(Boolean).length);
}
