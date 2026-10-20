import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { UserSpriteAssetSummary } from "../shared/assets";
import type { UserSoundSummary } from "./sound-draft";
import { assets } from "./runtime/assets";
import { content, t, type Locale } from "./i18n";
import { slotColor } from "./sprite-editor";
import {
  columnCount,
  filterInventory,
  gridTarget,
  standardItems,
  userAssetItems,
  userSoundItems,
  type GridKey,
  type InventoryArtwork,
  type InventoryCategory,
  type InventoryItem,
  type InventorySource,
} from "./inventory-model";

/**
 * Compact, keyboard-friendly inventory over the canonical asset registry plus (when IDEA 01 is
 * available) the signed-in creator's own sprites. Search, source, type filter and selection live
 * in module memory so collapsing the drawer or switching Story/Sandbox keeps the working context.
 */
const memory: {
  query: string;
  category: InventoryCategory;
  source: InventorySource;
  selected: Record<InventorySource, string | null>;
} = {
  query: "",
  category: "all",
  source: "standard",
  selected: { standard: null, mine: null },
};

const gridKeys: GridKey[] = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
];

function PixelArt({ artwork }: { artwork: InventoryArtwork }) {
  if (artwork.type === "sound" || artwork.type === "usersound")
    return <SoundIcon />;
  const sprite = artwork.sprite;
  return (
    <svg
      className="inv-pixels"
      viewBox={`0 0 ${sprite.width} ${sprite.height}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {sprite.pixels.map((slot, index) => {
        const color = slotColor(sprite, slot);
        if (!color) return null;
        return (
          <rect
            key={index}
            x={index % sprite.width}
            y={Math.floor(index / sprite.width)}
            width="1"
            height="1"
            fill={color}
          />
        );
      })}
    </svg>
  );
}
/** Sound effects get a speaker/waveform mark, never a blank square or a colour-only cue. */
function SoundIcon() {
  return (
    <svg
      className="inv-sound"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
    >
      <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor" stroke="none" />
      <path d="M16 9a4.5 4.5 0 0 1 0 6" />
      <path d="M19 6a9 9 0 0 1 0 12" />
    </svg>
  );
}

export function Inventory({
  locale,
  insert,
  preview,
  previewUserSound,
  stopPreview,
  explain,
  onClose,
  items = standardItems(assets),
  userAssets = [],
  userAssetsState = "idle",
  canUseAssets = false,
  focusAssetId = null,
  userSounds = [],
  onNewSprite,
  onNewSound,
  onEditSound,
  onEditAsset,
  onInsertAsset,
  onInsertSound,
  onReloadAssets,
}: {
  locale: Locale;
  insert: (code: string) => void;
  preview: (id: string) => void;
  previewUserSound?: (assetId: string) => Promise<void>;
  stopPreview: () => void;
  explain: (command: string) => void;
  onClose: () => void;
  items?: InventoryItem[];
  userAssets?: UserSpriteAssetSummary[];
  userAssetsState?: "idle" | "loading" | "ready" | "error";
  canUseAssets?: boolean;
  focusAssetId?: string | null;
  /** Personal sounds and instruments from the Sound Lab; empty until the engine lists them. */
  userSounds?: UserSoundSummary[];
  onNewSprite?: () => void;
  /** `opener` is the clicked button: Safari does not focus buttons on click, so focus is returned to it explicitly. */
  onNewSound?: (opener: HTMLElement) => void;
  onEditSound?: (soundId: string, opener: HTMLElement) => void;
  onEditAsset?: (assetId: string) => void;
  onInsertAsset?: (assetId: string) => void;
  onInsertSound?: (assetId: string) => void;
  onReloadAssets?: () => void;
}) {
  const copy = (key: Parameters<typeof t>[0]) => t(key, locale);
  const [query, setQuery] = useState(memory.query);
  const [category, setCategory] = useState<InventoryCategory>(memory.category);
  const [source, setSource] = useState<InventorySource>(memory.source);
  const [selected, setSelected] = useState(memory.selected);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const previewGeneration = useRef(0);
  const name = (item: InventoryItem) =>
    item.source === "mine"
      ? item.name
      : content(`asset.${item.id}.name`, item.name, locale);
  const tags = (item: InventoryItem) =>
    item.source === "mine"
      ? ""
      : content(`asset.${item.id}.tags`, item.tags, locale);
  const describe = (item: InventoryItem) =>
    `${name(item)} ${tags(item)} ${item.name} ${item.tags} ${item.id}`;
  const sourceItems =
    source === "mine"
      ? [...userAssetItems(userAssets), ...userSoundItems(userSounds)]
      : items;
  const categories: InventoryCategory[] = ["all", "sprites", "sounds"];
  const filtered = useMemo(
    () =>
      filterInventory(
        sourceItems,
        { query, category: categories.includes(category) ? category : "all" },
        describe,
      ),
    [sourceItems, query, category, locale, source],
  );
  const selectedId = selected[source];
  const selectedItem = sourceItems.find((item) => item.id === selectedId) ?? null;
  const visible =
    !!selectedItem && filtered.some((item) => item.id === selectedItem.id);
  const counts = {
    all: sourceItems.length,
    sprites: sourceItems.filter((item) => item.category === "sprites").length,
    sounds: sourceItems.filter((item) => item.category === "sounds").length,
  };
  const roving =
    (focusId && filtered.some((item) => item.id === focusId) ? focusId : null) ??
    (visible ? selectedId : null) ??
    filtered[0]?.id ??
    null;
  const active = (id: string) => (id === roving ? 0 : -1);
  useEffect(() => {
    memory.query = query;
    memory.category = category;
    memory.source = source;
    memory.selected = selected;
  }, [query, category, source, selected]);
  useEffect(
    () => () => {
      previewGeneration.current++;
      if (timer.current) window.clearTimeout(timer.current);
      stopPreview();
    },
    [],
  );
  // A preview belongs to the selected sound only; selecting or filtering another one silences it.
  useEffect(() => {
    previewGeneration.current++;
    if (timer.current) window.clearTimeout(timer.current);
    setPreviewing(null);
    stopPreview();
  }, [selectedId]);
  // A freshly saved sprite appears selected even though the drawer was open before saving.
  useEffect(() => {
    if (!focusAssetId) return;
    setSource("mine");
    setSelected((current) => ({ ...current, mine: focusAssetId }));
  }, [focusAssetId]);
  function choose(item: InventoryItem) {
    setSelected((current) => ({ ...current, [source]: item.id }));
    setFocusId(item.id);
  }
  function togglePreview(item: InventoryItem) {
    const generation = ++previewGeneration.current;
    if (previewing === item.id) {
      stopPreview();
      setPreviewing(null);
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    if (item.artwork.type === "usersound" && item.assetId && previewUserSound) {
      setPreviewing(item.id);
      void previewUserSound(item.assetId).catch(() => {}).finally(() => {
        if (generation === previewGeneration.current) setPreviewing(null);
      });
      return;
    }
    preview(item.id);
    setPreviewing(item.id);
    const duration =
      item.artwork.type === "sound" ? item.artwork.asset.tone.duration : 0;
    timer.current = window.setTimeout(
      () => setPreviewing(null),
      duration * 1000 + 80,
    );
  }
  function filterKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) {
        setQuery("");
        search.current?.focus();
      } else onClose();
      return;
    }
    if (event.key === "ArrowDown" && event.target === search.current) {
      event.preventDefault();
      const first = filtered.find((item) => item.id === roving) ?? filtered[0];
      if (!first) return;
      setFocusId(first.id);
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-asset="${first.id}"]`)
        ?.focus();
      return;
    }
    if (!gridKeys.includes(event.key as GridKey)) return;
    const current = filtered.findIndex((item) => item.id === roving);
    if (current < 0) return;
    event.preventDefault();
    const columns = columnCount(
      grid.current
        ? getComputedStyle(grid.current).gridTemplateColumns
        : "",
    );
    const next = gridTarget(
      current,
      columns,
      event.key as GridKey,
      filtered.length,
    );
    const target = filtered[next];
    if (!target) return;
    choose(target);
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-asset="${target.id}"]`)
      ?.focus();
  }
  const spell = selectedItem
    ? selectedItem.category === "sprites"
      ? "SPAWN"
      : "SOUND"
    : "";
  return (
    <div className="inv" onKeyDown={filterKey}>
      <section
        className="inv-inspector"
        aria-label={copy("inventory")}
        data-inspector
        data-selected={selectedItem?.id ?? ""}
      >
        {selectedItem ? (
          <>
            <div className="inv-stage" data-category={selectedItem.category}>
              <PixelArt artwork={selectedItem.artwork} />
            </div>
            <div className="inv-detail">
              <div className="inv-title">
                <h3>{name(selectedItem)}</h3>
                <span className="inv-badge">{copy(selectedItem.category)}</span>
              </div>
              <p className="inv-id">
                <code>{selectedItem.id}</code>
              </p>
              <pre className="inv-snippet">
                <code>{selectedItem.snippet}</code>
              </pre>
              <div className="inv-actions">
                <button
                  type="button"
                  className="primary inv-insert"
                  onClick={() => {
                    if (
                      selectedItem.source === "mine" &&
                      selectedItem.assetId &&
                      selectedItem.category === "sprites"
                    )
                      onInsertAsset?.(selectedItem.assetId);
                    else if (
                      selectedItem.source === "mine" &&
                      selectedItem.assetId &&
                      selectedItem.category === "sounds"
                    )
                      onInsertSound?.(selectedItem.assetId);
                    else insert(selectedItem.snippet);
                  }}
                >
                  {copy("inventoryInsert")}
                </button>
                {(selectedItem.artwork.type === "sound" ||
                  selectedItem.artwork.type === "usersound") && (
                  <button
                    type="button"
                    onClick={() => togglePreview(selectedItem)}
                    aria-pressed={previewing === selectedItem.id}
                  >
                    {copy(
                      previewing === selectedItem.id ? "stop" : "previewSound",
                    )}
                  </button>
                )}
                {selectedItem.source === "mine" && selectedItem.assetId && (
                  <button
                    type="button"
                    onClick={(event) =>
                      selectedItem.category === "sounds"
                        ? onEditSound?.(selectedItem.assetId!, event.currentTarget)
                        : onEditAsset?.(selectedItem.assetId!)
                    }
                  >
                    {copy("spriteEdit")}
                  </button>
                )}
                <button type="button" onClick={() => explain(spell)}>
                  {copy("howToUse")}
                </button>
              </div>
              {!visible && (
                <p className="muted small inv-hidden">
                  {copy("inventoryHidden")}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="inv-hint">{copy("inventoryPick")}</p>
        )}
      </section>
      {canUseAssets && (
        <div
          className="inv-sources"
          role="group"
          aria-label={copy("spriteSource")}
        >
          <button
            type="button"
            className="inv-chip"
            aria-pressed={source === "standard"}
            onClick={() => setSource("standard")}
          >
            {copy("standardAssets")}
          </button>
          <button
            type="button"
            className="inv-chip"
            aria-pressed={source === "mine"}
            onClick={() => setSource("mine")}
          >
            {copy("myAssets")}
            {userAssetsState === "loading" ? "…" : ` ${userAssets.length + userSounds.length}`}
          </button>
          {onNewSprite && (
            <button
              type="button"
              className="inv-new primary"
              onClick={onNewSprite}
            >
              + {copy("newSprite")}
            </button>
          )}
          {onNewSound && (
            <button
              type="button"
              className={"inv-new-sound" + (onNewSprite ? "" : " inv-new")}
              onClick={(event) => onNewSound(event.currentTarget)}
            >
              + {copy("slNewSound")}
            </button>
          )}
        </div>
      )}
      <div className="inv-search">
        <input
          ref={search}
          type="search"
          aria-label={copy("inventorySearch")}
          placeholder={copy("inventorySearch")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div
        className="inv-filters"
        role="group"
        aria-label={copy("inventoryTypes")}
      >
        {categories.map((value) => (
          <button
            key={value}
            type="button"
            className="inv-chip"
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            <span>{copy(value === "all" ? "inventoryAll" : value)}</span>
            <span className="inv-count" aria-hidden="true">
              {counts[value]}
            </span>
          </button>
        ))}
      </div>
      <div className="inv-results">
        {userAssetsState === "loading" && source === "mine" ? (
          <p className="inv-note">{copy("spriteAssetsLoading")}</p>
        ) : userAssetsState === "error" && source === "mine" ? (
          <p className="inv-note">
            {copy("spriteAssetsFailed")}{" "}
            <button type="button" onClick={onReloadAssets}>
              {copy("spriteRetry")}
            </button>
          </p>
        ) : filtered.length ? (
          <div
            className="inv-grid"
            role="listbox"
            aria-label={copy("inventory")}
            ref={grid}
          >
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={selectedId === item.id}
                aria-label={`${name(item)} — ${copy(item.category)}`}
                title={`${name(item)} — ${copy(item.category)}`}
                data-asset={item.id}
                data-source={item.source}
                tabIndex={active(item.id)}
                className={
                  "inv-slot" + (selectedId === item.id ? " selected" : "")
                }
                onClick={() => choose(item)}
                onFocus={() => {
                  setFocusId(item.id);
                  setSelected((current) => ({ ...current, [source]: item.id }));
                }}
              >
                <span className="inv-frame">
                  <PixelArt artwork={item.artwork} />
                </span>
                <span className="inv-label">{item.id}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="inv-empty">
            <p>
              {source === "mine" && !query
                ? copy("spriteNoAssets")
                : copy("inventoryEmpty")}
            </p>
            {(query || category !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                  search.current?.focus();
                }}
              >
                {copy("inventoryClearSearch")}
              </button>
            )}
            {source === "mine" && !query && onNewSprite && (
              <button type="button" onClick={onNewSprite}>
                {copy("newSprite")}
              </button>
            )}
            {source === "mine" && !query && onNewSound && (
              <button
                type="button"
                onClick={(event) => onNewSound(event.currentTarget)}
              >
                {copy("slNewSound")}
              </button>
            )}
          </div>
        )}
      </div>
      <button type="button" className="inv-notes" onClick={() => explain("NOTE")}>
        <span aria-hidden="true">♪</span> {copy("notes")} · {copy("howToUse")}
      </button>
    </div>
  );
}
