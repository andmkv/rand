import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IndexedSpriteV1, SpriteAssetV1 } from "../shared/assets";
import {
  AnimationTimeline,
  type AnimationOnionState,
} from "./AnimationTimeline";
import {
  animationDraftFromSprite,
  animationDraftFromSpriteAsset,
  animationDraftHasDrawing,
  animationFrameIndex,
  animationOnionFrames,
  animationSnapshot,
  applyAnimationSnapshot,
  blankAnimationFrame,
  canRedoAnimation,
  canUndoAnimation,
  duplicateAnimationFrame,
  emptyAnimationHistory,
  insertAnimationFrame,
  moveAnimationFrame,
  pushAnimationHistory,
  redoAnimationHistory,
  removeAnimationFrame,
  resizeAnimationDraft,
  setAnimationFps,
  setAnimationLoop,
  undoAnimationHistory,
  withAnimationFrame,
  type AnimationDraftV1,
  type AnimationHistory,
} from "./animation-draft";
import { ApiFailure } from "./api";
import { content, t, type Locale } from "./i18n";
import { sprites } from "./runtime/sprites";
import {
  blankSprite,
  fillArea,
  flipHorizontal,
  flipVertical,
  paintLine,
  paintPixel,
  paintRectangle,
  pixelSlot,
  resizeSprite,
  samePixels,
  slotColor,
  spriteFromRows,
  spritePresets,
  spriteRgba,
  transparentSlot,
  type SpritePoint,
  type SpriteTool,
} from "./sprite-editor";

const zoomLevels = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
/** Onion skin ghost tints: warm for the previous frame, cool for the next one. */
const previousGhost = "#ff7a86";
const nextGhost = "#78c8ff";

function ToolIcon({ tool }: { tool: SpriteTool }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };
  if (tool === "pencil")
    return (
      <svg {...common}>
        <path d="M4 20l4-1L20 7l-3-3L5 16z" />
        <path d="M15 6l3 3" />
      </svg>
    );
  if (tool === "eraser")
    return (
      <svg {...common}>
        <path d="M9 20H5l-2-2 9-9 4 4-7 7z" />
        <path d="M13 7l4-4 4 4-4 4" />
        <path d="M9 20h11" />
      </svg>
    );
  if (tool === "picker")
    return (
      <svg {...common}>
        <path d="M14 4l6 6-3 3-6-6z" />
        <path d="M11 7l-6 6v6h6l6-6" />
      </svg>
    );
  if (tool === "fill")
    return (
      <svg {...common}>
        <path d="M4 13l7-7 6 6-7 7z" />
        <path d="M19 14c1 1.5 1.5 2.5 1.5 3.2A1.6 1.6 0 0 1 17 17c0-.7.5-1.7 2-3z" />
      </svg>
    );
  if (tool === "rect")
    return (
      <svg {...common}>
        <rect x="4" y="6" width="16" height="12" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </svg>
  );
}

/** Draw one onion-skin silhouette without touching the frame's real pixels. */
function paintGhost(
  context: CanvasRenderingContext2D,
  sprite: IndexedSpriteV1 | null,
  zoom: number,
  color: string,
) {
  if (!sprite) return;
  context.save();
  context.globalAlpha = 0.42;
  context.fillStyle = color;
  for (let y = 0; y < sprite.height; y++)
    for (let x = 0; x < sprite.width; x++) {
      if (slotColor(sprite, sprite.pixels[y * sprite.width + x]) === null) continue;
      context.fillRect(x * zoom, y * zoom, zoom, zoom);
    }
  context.restore();
}

export function PixelEditor({
  locale,
  asset,
  canSaveAnimation,
  onSave,
  onClose,
}: {
  locale: Locale;
  asset?: { name: string; sprite: SpriteAssetV1 } | null;
  /** True when the canonical sprite API accepts AnimatedSpriteV1. */
  canSaveAnimation: boolean;
  onSave: (input: {
    name: string;
    sprite: IndexedSpriteV1;
    animation: AnimationDraftV1;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const copy = (key: Parameters<typeof t>[0]) => t(key, locale);
  const [draft, setDraft] = useState<AnimationDraftV1>(() =>
    asset
      ? animationDraftFromSpriteAsset(asset.sprite)
      : animationDraftFromSprite(blankSprite(16)),
  );
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState<AnimationHistory>(emptyAnimationHistory);
  const [name, setName] = useState(asset?.name ?? "");
  const [tool, setTool] = useState<SpriteTool>("pencil");
  const [slot, setSlot] = useState(9);
  const [zoom, setZoom] = useState(8);
  const [grid, setGrid] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<SpritePoint | null>(null);
  const [rectAt, setRectAt] = useState<{ from: SpritePoint; to: SpritePoint } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const [onion, setOnion] = useState<AnimationOnionState>({
    enabled: false,
    previous: true,
    next: true,
  });
  const [confirm, setConfirm] = useState<
    { kind: "close" } | { kind: "resize"; width: number; height: number } | null
  >(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const stroke = useRef<{
    before: ReturnType<typeof animationSnapshot>;
    last: SpritePoint | null;
  } | null>(null);
  const rectStart = useRef<SpritePoint | null>(null);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const space = useRef(false);

  const frameIndex = animationFrameIndex(draft, selected);
  const sprite = draft.frames[frameIndex];
  const frameCount = draft.frames.length;
  const activeIndex = playing ? Math.min(playIndex, frameCount - 1) : frameIndex;
  const saveBlocked = frameCount > 1 && !canSaveAnimation;

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const frameIndexRef = useRef(frameIndex);
  frameIndexRef.current = frameIndex;
  const historyRef = useRef(history);
  historyRef.current = history;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const playIndexRef = useRef(playIndex);
  playIndexRef.current = playIndex;
  const spriteRef = useRef(sprite);
  spriteRef.current = sprite;
  /** True while the canvas is fitted; a manual zoom or pan turns it off. */
  const fitRef = useRef(true);
  /** The control that opened the editor; focus returns there on close. */
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Read the opener before showModal() moves focus into the dialog.
    openerRef.current = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    const rect = view.current?.getBoundingClientRect();
    if (rect && rect.width > 0)
      setZoom(fitZoom(draft.width, draft.height, rect.width, rect.height));
    return () => openerRef.current?.focus?.();
    // Only the first render decides the initial zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Browser-level loss protection: a dirty editor warns before reload/close.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chromium and WebKit both need a truthy returnValue here.
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  // A user who has not chosen a zoom keeps the whole sprite visible when the
  // dialog resizes (rotation, window resize, small review viewports).
  useEffect(() => {
    const element = view.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!fitRef.current) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = fitZoom(draft.width, draft.height, rect.width, rect.height);
      setZoom((current) => (current === next ? current : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [draft.width, draft.height]);

  // Mouse wheel: Ctrl/⌘ zooms, a horizontal wheel pans. Both leave fitted mode.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        fitRef.current = false;
        setZoom((value) => stepZoom(value, event.deltaY < 0 ? 1 : -1));
      } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY) / 2) {
        event.preventDefault();
        fitRef.current = false;
        setPan((value) => ({ x: value.x - event.deltaX, y: value.y }));
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  /* ---------------------------------------------------------- preview timer */
  // Exactly one frame per 1000/FPS ms; the timer is cancelled on pause, close,
  // locale change, hidden tab and unmount so no preview can outlive the editor.
  useEffect(() => {
    if (!playing) return;
    if (draft.frames.length < 2) {
      setPlaying(false);
      return;
    }
    const delay = Math.round(1000 / draft.fps);
    let index = playIndexRef.current;
    let timer = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      index += 1;
      if (index >= draft.frames.length) {
        if (!draft.loop) {
          // Stop on the last frame instead of snapping back to the selection.
          setSelected(draft.frames.length - 1);
          setPlayIndex(draft.frames.length - 1);
          setPlaying(false);
          return;
        }
        index = 0;
      }
      setPlayIndex(index);
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [playing, draft.fps, draft.loop, draft.frames.length]);

  useEffect(() => {
    function hidden() {
      if (document.visibilityState === "hidden") setPlaying(false);
    }
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  useEffect(() => {
    setPlaying(false);
  }, [locale]);
  useEffect(() => {
    if (frameCount < 2) setPlaying(false);
  }, [frameCount]);

  /* --------------------------------------------------------------- rendering */
  // A layout effect keeps the canvas and the `data-frame-index` attribute in the
  // same commit, so a frame is never described in the DOM before it is painted.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const frame = draft.frames[activeIndex] ?? draft.frames[0];
    element.width = frame.width * zoom;
    element.height = frame.height * zoom;
    element.style.width = `${element.width}px`;
    element.style.height = `${element.height}px`;
    const context = element.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, element.width, element.height);
    if (!playing) {
      // Onion skin is a preview overlay only: it is painted under the current
      // frame and never merged into `frames`, the draft or a saved payload.
      const ghosts = animationOnionFrames(draft, frameIndex, {
        enabled: onion.enabled,
        previous: onion.previous,
        next: onion.next,
        wrap: draft.loop,
      });
      paintGhost(context, ghosts.previous, zoom, previousGhost);
      paintGhost(context, ghosts.next, zoom, nextGhost);
    }
    for (let y = 0; y < frame.height; y++)
      for (let x = 0; x < frame.width; x++) {
        const color = slotColor(frame, frame.pixels[y * frame.width + x]);
        if (!color) continue;
        context.fillStyle = color;
        context.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    if (grid && zoom >= 4 && !playing) {
      context.fillStyle = "rgba(255,255,255,0.12)";
      for (let x = 1; x < frame.width; x++) context.fillRect(x * zoom, 0, 1, element.height);
      for (let y = 1; y < frame.height; y++) context.fillRect(0, y * zoom, element.width, 1);
    }
    if (rectAt && !playing) {
      const left = Math.min(rectAt.from.x, rectAt.to.x),
        right = Math.max(rectAt.from.x, rectAt.to.x),
        top = Math.min(rectAt.from.y, rectAt.to.y),
        bottom = Math.max(rectAt.from.y, rectAt.to.y);
      context.strokeStyle = "#ffe38a";
      context.lineWidth = 2;
      context.strokeRect(
        left * zoom + 1,
        top * zoom + 1,
        (right - left + 1) * zoom - 2,
        (bottom - top + 1) * zoom - 2,
      );
    }
    if (cursor && !playing) {
      context.strokeStyle = "rgba(255,255,255,0.85)";
      context.lineWidth = 2;
      context.strokeRect(cursor.x * zoom + 1, cursor.y * zoom + 1, zoom - 2, zoom - 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, frameIndex, activeIndex, zoom, grid, cursor, rectAt, playing, onion]);

  /* ---------------------------------------------------------------- history */
  /** One undo entry per user action; a whole stroke or frame move is one entry. */
  function recordHistory(snapshot?: ReturnType<typeof animationSnapshot>) {
    const before =
      snapshot ?? animationSnapshot(draftRef.current, frameIndexRef.current);
    setHistory((current) => pushAnimationHistory(current, before));
    setDirty(true);
    setStatus("idle");
  }
  /** Replace the selected frame (painting, fill, flip, template, resize-free ops). */
  function applyFrame(next: IndexedSpriteV1) {
    setDraft((current) =>
      withAnimationFrame(current, frameIndexRef.current, next),
    );
  }
  function commitFrame(next: IndexedSpriteV1) {
    if (samePixels(next, spriteRef.current)) return;
    recordHistory();
    applyFrame(next);
  }
  /** Replace the whole document (frame operations, resize) as one undo entry. */
  function applyDocument(next: AnimationDraftV1, index?: number) {
    if (next === draftRef.current) return;
    recordHistory();
    setDraft(next);
    if (index !== undefined) setSelected(index);
    setCursor(null);
    setRectAt(null);
    setPlaying(false);
    setPlayIndex(index ?? animationFrameIndex(next, selected));
  }
  function undo() {
    const result = undoAnimationHistory(
      historyRef.current,
      animationSnapshot(draftRef.current, frameIndexRef.current),
    );
    if (!result) return;
    setHistory(result.history);
    setDraft((current) => applyAnimationSnapshot(current, result.snapshot));
    setSelected(result.snapshot.selected);
    setDirty(true);
    setStatus("idle");
    setCursor(null);
    setRectAt(null);
    setPlaying(false);
  }
  function redo() {
    const result = redoAnimationHistory(
      historyRef.current,
      animationSnapshot(draftRef.current, frameIndexRef.current),
    );
    if (!result) return;
    setHistory(result.history);
    setDraft((current) => applyAnimationSnapshot(current, result.snapshot));
    setSelected(result.snapshot.selected);
    setDirty(true);
    setStatus("idle");
    setCursor(null);
    setRectAt(null);
    setPlaying(false);
  }

  /* ------------------------------------------------------------ frame actions */
  function selectFrame(index: number) {
    setSelected(animationFrameIndex(draftRef.current, index));
    setCursor(null);
    setRectAt(null);
    setPlaying(false);
  }
  function addFrame() {
    const result = insertAnimationFrame(draftRef.current, frameIndexRef.current);
    applyDocument(result.draft, result.index);
  }
  function duplicateFrame() {
    const result = duplicateAnimationFrame(draftRef.current, frameIndexRef.current);
    applyDocument(result.draft, result.index);
  }
  /** Start an animation from a static drawing: a copy of it becomes frame 2. */
  function startAnimation() {
    const result = duplicateAnimationFrame(draftRef.current, frameIndexRef.current);
    applyDocument(result.draft, result.index);
  }
  function deleteFrame() {
    const result = removeAnimationFrame(draftRef.current, frameIndexRef.current);
    applyDocument(result.draft, result.index);
  }
  function moveFrame(from: number, to: number) {
    const result = moveAnimationFrame(draftRef.current, from, to);
    applyDocument(result.draft, result.index);
  }
  function togglePlay() {
    if (playingRef.current) {
      setPlaying(false);
      return;
    }
    if (draftRef.current.frames.length < 2) return;
    setPlayIndex(frameIndexRef.current);
    setCursor(null);
    setRectAt(null);
    setPlaying(true);
  }
  function stopPreview() {
    setPlaying(false);
    setPlayIndex(frameIndexRef.current);
  }
  function setFps(value: number) {
    const next = setAnimationFps(draftRef.current, value);
    if (next === draftRef.current) return;
    // Settings are part of the document snapshot, so they undo with everything else.
    recordHistory();
    setDraft(next);
  }
  function toggleLoop() {
    recordHistory();
    setDraft((current) => setAnimationLoop(current, !current.loop));
  }

  /* ----------------------------------------------------------------- input */
  function cellOf(event: { clientX: number; clientY: number }): SpritePoint | null {
    const element = canvas.current;
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const x = Math.floor((event.clientX - box.left) / zoom);
    const y = Math.floor((event.clientY - box.top) / zoom);
    if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) return null;
    return { x, y };
  }
  function applyStroke(point: SpritePoint, last: SpritePoint | null) {
    const value = tool === "eraser" ? transparentSlot : slot;
    setDraft((current) => {
      const index = animationFrameIndex(current, frameIndexRef.current);
      return withAnimationFrame(
        current,
        index,
        paintLine(current.frames[index], last ?? point, point, value),
      );
    });
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    // Painting a moving preview frame would be ambiguous: the first tap stops it.
    if (playingRef.current) {
      event.preventDefault();
      setPlaying(false);
      return;
    }
    const point = cellOf(event);
    if (tool === "pan" || event.button === 1 || space.current) {
      panStart.current = {
        x: event.clientX,
        y: event.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setCursor(point);
    if (tool === "picker") {
      const picked = pixelSlot(sprite, point.x, point.y);
      if (picked !== null) setSlot(picked);
      return;
    }
    if (tool === "fill") {
      commitFrame(fillArea(sprite, point, slot));
      return;
    }
    if (tool === "rect") {
      rectStart.current = point;
      setRectAt({ from: point, to: point });
      return;
    }
    stroke.current = {
      before: animationSnapshot(draftRef.current, frameIndexRef.current),
      last: point,
    };
    applyStroke(point, null);
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = cellOf(event);
    if (point) setCursor(point);
    if (panStart.current) {
      fitRef.current = false;
      setPan({
        x: panStart.current.panX + (event.clientX - panStart.current.x),
        y: panStart.current.panY + (event.clientY - panStart.current.y),
      });
      return;
    }
    if (rectStart.current && point) {
      setRectAt({ from: rectStart.current, to: point });
      return;
    }
    if (!stroke.current || !point) return;
    applyStroke(point, stroke.current.last);
    stroke.current.last = point;
  }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    panStart.current = null;
    const point = cellOf(event);
    if (rectStart.current) {
      const from = rectStart.current;
      rectStart.current = null;
      setRectAt(null);
      if (point) commitFrame(paintRectangle(spriteRef.current, from, point, slot));
      return;
    }
    const active = stroke.current;
    stroke.current = null;
    if (active && !samePixels(active.before.frames[active.before.selected], spriteRef.current))
      recordHistory(active.before);
  }
  function moveCursor(dx: number, dy: number) {
    const start = cursor ?? { x: 0, y: 0 };
    setCursor({
      x: Math.max(0, Math.min(sprite.width - 1, start.x + dx)),
      y: Math.max(0, Math.min(sprite.height - 1, start.y + dy)),
    });
  }
  function paintCursor() {
    if (!cursor) return;
    if (tool === "picker") {
      const picked = pixelSlot(sprite, cursor.x, cursor.y);
      if (picked !== null) setSlot(picked);
      return;
    }
    if (tool === "fill") return commitFrame(fillArea(sprite, cursor, slot));
    commitFrame(paintPixel(sprite, cursor.x, cursor.y, tool === "eraser" ? transparentSlot : slot));
  }
  function fit() {
    const rect = view.current?.getBoundingClientRect();
    if (!rect) return;
    fitRef.current = true;
    setZoom(fitZoom(draft.width, draft.height, rect.width, rect.height));
    setPan({ x: 0, y: 0 });
  }
  /** Any explicit zoom leaves fitted mode until Fit is pressed again. */
  function zoomBy(direction: number) {
    fitRef.current = false;
    setZoom((value) => stepZoom(value, direction));
  }

  /* -------------------------------------------------------------- shortcuts */
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      if (confirm) {
        if (event.key === "Escape") {
          event.preventDefault();
          setConfirm(null);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        void requestClose();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        moveFrame(frameIndexRef.current, frameIndexRef.current - 1);
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        moveFrame(frameIndexRef.current, frameIndexRef.current + 1);
        return;
      }
      if (event.key === " ") {
        space.current = true;
        if (target === document.body) event.preventDefault();
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        deleteFrame();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        if (event.shiftKey) duplicateFrame();
        else addFrame();
      } else if (key === "p") {
        event.preventDefault();
        if (event.shiftKey) stopPreview();
        else togglePlay();
      } else if (key === "o") setOnion((value) => ({ ...value, enabled: !value.enabled }));
      else if (key === "l") toggleLoop();
      else if (event.key === ",") selectFrame(frameIndexRef.current - 1);
      else if (event.key === ".") selectFrame(frameIndexRef.current + 1);
      else if (key === "b") setTool("pencil");
      else if (key === "e") setTool("eraser");
      else if (key === "i") setTool("picker");
      else if (key === "f") setTool("fill");
      else if (key === "r") setTool("rect");
      else if (key === "g") setGrid((value) => !value);
      else if (key === "0") fit();
      else if (event.key === "[") zoomBy(-1);
      else if (event.key === "]") zoomBy(1);
      else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveCursor(-1, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveCursor(1, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCursor(0, -1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCursor(0, 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        paintCursor();
      }
    }
    function keyup(event: KeyboardEvent) {
      if (event.key === " ") space.current = false;
    }
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup);
    };
    // Handlers read live values through refs, so only UI state that they close
    // over directly needs to re-register the listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, tool, slot, confirm, dirty, playing]);

  /* ------------------------------------------------------------------ save */
  function requestClose() {
    if (dirty) setConfirm({ kind: "close" });
    else onClose();
  }
  async function save() {
    if (status === "saving") return;
    if (saveBlocked) {
      setStatus("error");
      setMessage(copy("animationSaveUnavailable"));
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("error");
      setMessage(copy("spriteNameNeeded"));
      nameInput.current?.focus();
      return;
    }
    setStatus("saving");
    setMessage("");
    try {
      await onSave({ name: trimmed, sprite: draft.frames[0], animation: draft });
      setStatus("saved");
      setDirty(false);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof ApiFailure && error.code === "VERSION_CONFLICT"
          ? copy("spriteVersionConflict")
          : copy("spriteSaveFailed"),
      );
    }
  }
  function exportPng() {
    const element = document.createElement("canvas");
    element.width = sprite.width;
    element.height = sprite.height;
    const context = element.getContext("2d");
    if (!context) return;
    const image = context.createImageData(sprite.width, sprite.height);
    image.data.set(spriteRgba(sprite));
    context.putImageData(image, 0, 0);
    element.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name.trim() || "sprite"}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }
  function resize(width: number, height = width) {
    if (width === draft.width && height === draft.height) return;
    if (animationDraftHasDrawing(draft)) {
      setConfirm({ kind: "resize", width, height });
      return;
    }
    applyDocument(resizeAnimationDraft(draft, width, height));
    setCursor(null);
  }
  function loadTemplate(id: "cat" | "star" | "blank") {
    const next =
      id === "blank"
        ? blankAnimationFrame(draft)
        : resizeSprite(spriteFromRows(sprites[id]), draft.width, draft.height);
    commitFrame(next);
    setCursor(null);
  }

  const tools: SpriteTool[] = ["pencil", "eraser", "picker", "fill", "rect", "pan"];
  const toolName = (value: SpriteTool) => copy(`tool${value[0].toUpperCase()}${value.slice(1)}` as Parameters<typeof t>[0]);
  return (
    <dialog
      ref={dialog}
      className="px"
      aria-label={copy("spriteEditor")}
      onCancel={(event) => {
        event.preventDefault();
        void requestClose();
      }}
    >
      <div className={"px-shell" + (frameCount > 1 ? " animated" : "")}>
        <header className="px-header">
          <h2>{copy("spriteEditor")}</h2>
          <label className="px-name">
            <span>{copy("spriteName")}</span>
            <input
              ref={nameInput}
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <span className={"px-status " + (status === "error" ? "error" : "")} role="status">
            {status === "saving"
              ? copy("spriteSaving")
              : status === "error"
                ? message
                : dirty
                  ? copy("spriteUnsaved")
                  : status === "saved"
                    ? copy("spriteSaved")
                    : ""}
          </span>
          <div className="px-header-actions">
            <button
              type="button"
              className="primary px-save"
              onClick={() => void save()}
              disabled={status === "saving"}
              aria-describedby={saveBlocked ? "px-anim-note" : undefined}
              title={saveBlocked ? copy("animationSaveUnavailable") : undefined}
            >
              {copy("spriteSave")}
            </button>
            <button type="button" className="px-export" onClick={exportPng}>
              {copy("spriteExport")}
            </button>
            <button type="button" className="px-close" onClick={() => void requestClose()} aria-label={copy("close")}>
              ✕
            </button>
          </div>
        </header>
        <div className="px-body">
          <div className="px-tools" role="toolbar" aria-label={copy("spriteTools")}>
            {tools.map((value) => (
              <button
                key={value}
                type="button"
                className="px-tool"
                data-tool={value}
                aria-pressed={tool === value}
                onClick={() => setTool(value)}
                title={toolName(value)}
              >
                <ToolIcon tool={value} />
                <span>{toolName(value)}</span>
              </button>
            ))}
            <div className="px-flips">
              <button
                type="button"
                className="px-flip"
                onClick={() => commitFrame(flipHorizontal(sprite))}
                aria-label={copy("spriteFlipH")}
                title={copy("spriteFlipH")}
              >
                ↔
              </button>
              <button
                type="button"
                className="px-flip"
                onClick={() => commitFrame(flipVertical(sprite))}
                aria-label={copy("spriteFlipV")}
                title={copy("spriteFlipV")}
              >
                ↕
              </button>
            </div>
            <div className="px-history">
              <button type="button" className="px-undo" onClick={undo} disabled={!canUndoAnimation(history)} title={copy("spriteUndo")} aria-label={copy("spriteUndo")}>
                ↶
              </button>
              <button type="button" className="px-redo" onClick={redo} disabled={!canRedoAnimation(history)} title={copy("spriteRedo")} aria-label={copy("spriteRedo")}>
                ↷
              </button>
            </div>
          </div>
          <div className="px-view" ref={view}>
            <canvas
              ref={canvas}
              className="px-canvas"
              tabIndex={0}
              aria-label={copy("spriteEditor")}
              data-sprite-width={draft.width}
              data-sprite-height={draft.height}
              data-frame-index={activeIndex}
              data-frame-count={frameCount}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                cursor: tool === "pan" ? "grab" : "crosshair",
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onPointerLeave={() => {
                if (!stroke.current && !rectStart.current) setCursor(null);
              }}
            />
          </div>
          <aside className="px-side">
            <section aria-label={copy("spriteColors")}>
              <h3>{copy("spriteColors")}</h3>
              <button
                type="button"
                className="px-transparent"
                data-slot={transparentSlot}
                aria-pressed={slot === transparentSlot}
                onClick={() => setSlot(transparentSlot)}
              >
                {copy("spriteTransparent")}
              </button>
              <div
                className="px-palette"
                role="group"
                aria-label={copy("spriteColors")}
              >
                {draft.palette.map((_, index) =>
                  index === transparentSlot ? null : (
                    <button
                      key={index}
                      type="button"
                      className="px-swatch"
                      data-slot={index}
                      aria-pressed={slot === index}
                      aria-label={`${copy("spriteColors")} ${index}`}
                      style={{ background: slotColor(sprite, index) ?? "#000" }}
                      onClick={() => setSlot(index)}
                    />
                  ),
                )}
              </div>
            </section>
            <section aria-label={copy("spriteSize")}>
              <h3>{copy("spriteSize")}</h3>
              <div className="px-sizes">
                {spritePresets.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className="px-size"
                    data-size={size}
                    aria-pressed={draft.width === size && draft.height === size}
                    onClick={() => resize(size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </section>
            <section aria-label={copy("spriteTemplates")}>
              <h3>{copy("spriteTemplates")}</h3>
              <div className="px-templates">
                <button type="button" className="px-template" data-template="cat" onClick={() => loadTemplate("cat")}>
                  {content("asset.cat.name", "Cat", locale)}
                </button>
                <button type="button" className="px-template" data-template="star" onClick={() => loadTemplate("star")}>
                  {content("asset.star.name", "Star", locale)}
                </button>
                <button type="button" className="px-template" data-template="blank" onClick={() => loadTemplate("blank")}>
                  {copy("spriteBlank")}
                </button>
              </div>
            </section>
            <details className="px-help">
              <summary>{copy("spriteHelp")}</summary>
              <p>
                {copy("spriteHelpText")}{" "}
                <span className="px-help-animation">
                  {copy("animationHelpText")}
                </span>
              </p>
            </details>
          </aside>
        </div>
        {frameCount > 1 && (
          <AnimationTimeline
            locale={locale}
            draft={draft}
            selected={frameIndex}
            playing={playing}
            playIndex={playIndex}
            onion={onion}
            animationSaveAvailable={canSaveAnimation}
            onSelect={selectFrame}
            onAddFrame={addFrame}
            onDuplicateFrame={duplicateFrame}
            onDeleteFrame={deleteFrame}
            onMoveFrame={moveFrame}
            onPlayPause={togglePlay}
            onStop={stopPreview}
            onFps={setFps}
            onLoop={toggleLoop}
            onOnion={setOnion}
          />
        )}
        <footer className="px-footer">
          <div className="px-zoom" role="group" aria-label={copy("spriteZoom")}>
            <button type="button" className="px-zoom-out" onClick={() => zoomBy(-1)} aria-label="-">
              −
            </button>
            <span className="px-zoom-value" data-zoom={zoom}>
              {zoom}×
            </span>
            <button type="button" className="px-zoom-in" onClick={() => zoomBy(1)} aria-label="+">
              +
            </button>
          </div>
          <button type="button" className="px-grid" aria-pressed={grid} onClick={() => setGrid((value) => !value)}>
            {copy("spriteGrid")}
          </button>
          <button type="button" className="px-fit" onClick={fit}>
            {copy("spriteFit")}
          </button>
          {frameCount === 1 && (
            <button
              type="button"
              className="px-animate"
              onClick={startAnimation}
              aria-keyshortcuts="Shift+N"
              title={copy("animationStartTitle")}
            >
              + {copy("animationStart")}
            </button>
          )}
          <span className="px-coordinates">
            {cursor
              ? `${cursor.x + 1}, ${cursor.y + 1} / ${draft.width}×${draft.height}`
              : `${draft.width}×${draft.height}`}
          </span>
        </footer>
        {confirm && (
          <div className="px-confirm" role="alertdialog" aria-modal="true" aria-label={confirm.kind === "close" ? copy("spriteDiscardTitle") : copy("spriteResizeTitle").replace("{size}", String(confirm.width))}>
            <h3>
              {confirm.kind === "close"
                ? copy("spriteDiscardTitle")
                : copy("spriteResizeTitle").replace("{size}", `${confirm.width}×${confirm.height}`)}
            </h3>
            <p>{confirm.kind === "close" ? copy("spriteDiscardBody") : copy("spriteResizeBody")}</p>
            <div className="px-confirm-actions">
              <button type="button" className="px-cancel" onClick={() => setConfirm(null)}>
                {confirm.kind === "close" ? copy("spriteKeepEditing") : copy("cancel")}
              </button>
              <button
                type="button"
                className="primary px-confirm-ok"
                onClick={() => {
                  const pending = confirm;
                  setConfirm(null);
                  if (pending.kind === "close") onClose();
                  else {
                    applyDocument(resizeAnimationDraft(draft, pending.width, pending.height));
                    setCursor(null);
                  }
                }}
              >
                {confirm.kind === "close" ? copy("spriteDiscard") : copy("spriteSize")}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

function fitZoom(width: number, height: number, viewWidth: number, viewHeight: number) {
  const fit = Math.min((viewWidth - 48) / width, (viewHeight - 48) / height);
  return Math.max(1, Math.min(32, Math.floor(fit) || 1));
}
function stepZoom(current: number, direction: number) {
  const index = zoomLevels.indexOf(current);
  const next =
    index < 0
      ? zoomLevels.findIndex((level) => level > current)
      : index + direction;
  return zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, next))];
}
