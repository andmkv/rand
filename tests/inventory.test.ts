import { describe, expect, it } from "vitest";
import { assets, assetSnippet } from "../src/runtime/assets";
import {
  columnCount,
  filterInventory,
  gridTarget,
  standardItems,
  userSoundItems,
  type InventoryItem,
} from "../src/inventory-model";

const items = standardItems(assets);
const english = (item: InventoryItem) =>
  `${item.name} ${item.tags} ${item.id}`;

describe("inventory model", () => {
  it("maps the canonical built-in registry, never a UI-only list", () => {
    expect(items.map((item) => item.id)).toEqual(assets.map((asset) => asset.id));
    for (const item of items) {
      expect(item.source).toBe("standard");
      const asset = assets.find((entry) => entry.id === item.id)!;
      expect(item.category).toBe(asset.category);
      expect(item.snippet).toBe(assetSnippet(asset));
      expect(item.artwork.type).toBe(
        asset.category === "sprites" ? "sprite" : "sound",
      );
    }
  });
  it("inserts personal SFX and instruments with their runnable BASIC commands", () => {
    const soundItems = userSoundItems([
      { id: "sfx-1", alias: "my_laser", name: "My laser", kind: "sfx" },
      { id: "instrument-1", alias: "keys", name: "Keys", kind: "instrument" },
    ]);
    expect(soundItems.map((item) => item.snippet)).toEqual([
      'SOUND "@my_laser"',
      'NOTE "C4",0.5,"@keys"',
    ]);
  });
  it("filters by type, stable id, English and localized words", () => {
    const ids = (list: InventoryItem[]) => list.map((item) => item.id);
    expect(ids(filterInventory(items, { query: "", category: "sounds" }, english)))
      .toEqual(["explosion", "coin", "laser", "jump", "power-up", "blip", "drum", "wind"]);
    expect(ids(filterInventory(items, { query: "LASER", category: "all" }, english)))
      .toEqual(["laser"]);
    expect(ids(filterInventory(items, { query: "  treasure ", category: "all" }, english)))
      .toContain("star");
    // A localized name is searchable even when the English words do not match.
    const russian = (item: InventoryItem) =>
      item.id === "cat" ? "Кот pet animal friend cat" : english(item);
    expect(ids(filterInventory(items, { query: "кот", category: "all" }, russian)))
      .toEqual(["cat"]);
    expect(filterInventory(items, { query: "no-such-asset", category: "all" }, english))
      .toEqual([]);
  });
  it("navigates the wrapped grid without leaving the list", () => {
    expect(gridTarget(0, 6, "ArrowRight", 23)).toBe(1);
    expect(gridTarget(5, 6, "ArrowRight", 23)).toBe(6);
    expect(gridTarget(0, 6, "ArrowUp", 23)).toBe(0);
    expect(gridTarget(0, 6, "ArrowLeft", 23)).toBe(0);
    expect(gridTarget(2, 6, "ArrowDown", 23)).toBe(8);
    // The last row has no row below it: the selection stays instead of jumping sideways.
    expect(gridTarget(20, 6, "ArrowDown", 23)).toBe(20);
    expect(gridTarget(2, 6, "End", 23)).toBe(22);
    expect(gridTarget(22, 6, "Home", 23)).toBe(0);
    expect(gridTarget(0, 6, "ArrowRight", 1)).toBe(0);
    expect(gridTarget(0, 6, "ArrowRight", 0)).toBe(-1);
  });
  it("reads the resolved column count for wrapped keys", () => {
    expect(columnCount("76px 76px 76px")).toBe(3);
    expect(columnCount("")).toBe(1);
    expect(columnCount("   ")).toBe(1);
  });
});
