import { useEffect, useRef, useState } from "react";
import type { IndexedSpriteV1 } from "../shared/assets";
import {
  animationLimits,
  canAddAnimationFrame,
  canRemoveAnimationFrame,
  type AnimationDraftV1,
} from "./animation-draft";
import { t, type Locale } from "./i18n";
import { slotColor } from "./sprite-editor";

export interface AnimationOnionState {
  enabled: boolean;
  previous: boolean;
  next: boolean;
}

export interface AnimationTimelineProps {
  locale: Locale;
  draft: AnimationDraftV1;
  selected: number;
  playing: boolean;
  playIndex: number;
  onion: AnimationOnionState;
  animationSaveAvailable: boolean;
  onSelect: (index: number) => void;
  onAddFrame: () => void;
  onDuplicateFrame: () => void;
  onDeleteFrame: () => void;
  onMoveFrame: (from: number, to: number) => void;
  onPlayPause: () => void;
  onStop: () => void;
  onFps: (fps: number) => void;
  onLoop: (loop: boolean) => void;
  onOnion: (next: AnimationOnionState) => void;
}

/** Nearest-neighbour thumbnail: the canvas is one canvas pixel per sprite pixel. */
function FrameThumbnail({ sprite, box }: { sprite: IndexedSpriteV1; box: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = sprite.width;
    element.height = sprite.height;
    const context = element.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, element.width, element.height);
    for (let y = 0; y < sprite.height; y++)
      for (let x = 0; x < sprite.width; x++) {
        const color = slotColor(sprite, sprite.pixels[y * sprite.width + x]);
        if (!color) continue;
        context.fillStyle = color;
        context.fillRect(x, y, 1, 1);
      }
  }, [sprite]);
  const scale = Math.max(
    1,
    Math.floor(box / Math.max(sprite.width, sprite.height)),
  );
  return (
    <canvas
      ref={canvas}
      className="px-thumb-canvas"
      width={sprite.width}
      height={sprite.height}
      aria-hidden="true"
      style={{ width: sprite.width * scale, height: sprite.height * scale }}
    />
  );
}

export function AnimationTimeline({
  locale,
  draft,
  selected,
  playing,
  playIndex,
  onion,
  animationSaveAvailable,
  onSelect,
  onAddFrame,
  onDuplicateFrame,
  onDeleteFrame,
  onMoveFrame,
  onPlayPause,
  onStop,
  onFps,
  onLoop,
  onOnion,
}: AnimationTimelineProps) {
  const copy = (key: Parameters<typeof t>[0]) => t(key, locale);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const dragState = useRef<{
    from: number;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const count = draft.frames.length;
  const shown = playing ? Math.min(playIndex, count - 1) : selected;
  const addable = canAddAnimationFrame(draft);
  const removable = canRemoveAnimationFrame(draft);

  /** Roving focus: the selected thumbnail is the single tab stop of the listbox. */
  function focusFrame(index: number) {
    const target = strip.current?.querySelector<HTMLElement>(
      `[data-frame-index="${index}"]`,
    );
    target?.focus();
  }
  function select(index: number) {
    if (index < 0 || index >= count || index === selected) return;
    onSelect(index);
  }
  function listKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (!target?.dataset.frameIndex) return;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = Math.max(0, selected - 1);
    else if (event.key === "ArrowRight") next = Math.min(count - 1, selected + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    // Keep the pixel-cursor shortcuts from also reacting to frame navigation.
    event.preventDefault();
    event.stopPropagation();
    select(next);
    focusFrame(next);
  }

  function thumbDown(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      from: index,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    if (index !== selected) onSelect(index);
  }
  function thumbMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    if (!state) return;
    if (!state.active) {
      const distance = Math.hypot(event.clientX - state.x, event.clientY - state.y);
      if (distance < 8) return;
      state.active = true;
    }
    event.preventDefault();
    const over = frameAt(event.clientX, event.clientY);
    setDrag({ from: state.from, over: over ?? state.from });
  }
  function thumbUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    dragState.current = null;
    setDrag(null);
    if (!state?.active) return;
    event.preventDefault();
    const over = frameAt(event.clientX, event.clientY);
    if (over !== null && over !== state.from) onMoveFrame(state.from, over);
  }
  function frameAt(x: number, y: number): number | null {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-frame-index]");
    const value = element?.dataset.frameIndex;
    return value === undefined ? null : Number(value);
  }

  const dragClass = (index: number) => {
    if (!drag) return "";
    if (index === drag.from) return " dragging";
    if (index === drag.over) return " drop-target";
    return "";
  };

  return (
    <section
      className={"px-anim" + (playing ? " playing" : "")}
      aria-label={copy("animationTimeline")}
      data-frames={count}
      data-playing={playing ? "true" : "false"}
    >
      <div className="px-anim-bar">
        <button
          type="button"
          className="px-play"
          aria-pressed={playing}
          onClick={onPlayPause}
          aria-keyshortcuts="P"
          title={`${copy("animationPlay")} / ${copy("animationPause")} (P)`}
        >
          <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>{" "}
          {copy(playing ? "animationPause" : "animationPlay")}
        </button>
        <button
          type="button"
          className="px-stop"
          onClick={onStop}
          disabled={!playing}
          aria-keyshortcuts="Shift+P"
          title={`${copy("animationStop")} (Shift + P)`}
        >
          <span aria-hidden="true">⏹</span> {copy("animationStop")}
        </button>
        <label className="px-fps">
          <span>{copy("animationFps")}</span>
          <select
            value={draft.fps}
            aria-label={copy("animationFps")}
            onChange={(event) => onFps(Number(event.target.value))}
          >
            {Array.from(
              { length: animationLimits.fpsMax - animationLimits.fpsMin + 1 },
              (_, index) => animationLimits.fpsMin + index,
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="px-loop"
          aria-pressed={draft.loop}
          onClick={() => onLoop(!draft.loop)}
          aria-keyshortcuts="L"
          title={`${copy("animationLoop")} (L)`}
        >
          {copy("animationLoop")}
        </button>
        <button
          type="button"
          className="px-onion"
          aria-pressed={onion.enabled}
          onClick={() => onOnion({ ...onion, enabled: !onion.enabled })}
          aria-keyshortcuts="O"
          title={`${copy("animationOnion")} (O)`}
        >
          {copy("animationOnion")}
        </button>
        {onion.enabled && (
          <span
            className="px-onion-sides"
            role="group"
            aria-label={copy("animationOnionSides")}
          >
            <button
              type="button"
              className="px-onion-prev"
              aria-pressed={onion.previous}
              aria-label={copy("animationOnionPrev")}
              title={copy("animationOnionPrev")}
              onClick={() => onOnion({ ...onion, previous: !onion.previous })}
            >
              ◀
            </button>
            <button
              type="button"
              className="px-onion-next"
              aria-pressed={onion.next}
              aria-label={copy("animationOnionNext")}
              title={copy("animationOnionNext")}
              onClick={() => onOnion({ ...onion, next: !onion.next })}
            >
              ▶
            </button>
          </span>
        )}
        <span className="px-frame-count" data-frame-count={shown + 1}>
          {shown + 1} / {count}
        </span>
        <div className="px-frame-actions" role="group" aria-label={copy("animationFrames")}>
          <button
            type="button"
            className="px-add-frame"
            onClick={onAddFrame}
            disabled={!addable}
            aria-keyshortcuts="N"
            title={
              addable ? `${copy("animationAdd")} (N)` : copy("animationFramesFull")
            }
          >
            + {copy("animationAdd")}
          </button>
          <button
            type="button"
            className="px-duplicate-frame"
            onClick={onDuplicateFrame}
            disabled={!addable}
            aria-keyshortcuts="Shift+N"
            title={
              addable
                ? `${copy("animationDuplicate")} (Shift + N)`
                : copy("animationFramesFull")
            }
          >
            {copy("animationDuplicate")}
          </button>
          <button
            type="button"
            className="px-delete-frame"
            onClick={onDeleteFrame}
            disabled={!removable}
            aria-keyshortcuts="Delete"
            title={`${copy("animationDelete")} (Delete)`}
          >
            {copy("animationDelete")}
          </button>
          <span className="px-move" role="group" aria-label={copy("animationMove")}>
            <button
              type="button"
              className="px-move-left"
              onClick={() => onMoveFrame(selected, selected - 1)}
              disabled={selected <= 0}
              aria-label={copy("animationMoveLeft")}
              title={`${copy("animationMoveLeft")} (Alt + ←)`}
            >
              ←
            </button>
            <button
              type="button"
              className="px-move-right"
              onClick={() => onMoveFrame(selected, selected + 1)}
              disabled={selected >= count - 1}
              aria-label={copy("animationMoveRight")}
              title={`${copy("animationMoveRight")} (Alt + →)`}
            >
              →
            </button>
          </span>
        </div>
      </div>
      <div
        ref={strip}
        className="px-anim-strip"
        role="listbox"
        aria-orientation="horizontal"
        aria-label={copy("animationFrames")}
        onKeyDown={listKeys}
      >
        {draft.frames.map((frame, index) => (
          <div
            key={index}
            role="option"
            aria-selected={index === selected}
            aria-label={`${copy("animationFrameLabel")} ${index + 1}`}
            tabIndex={index === selected ? 0 : -1}
            data-frame-index={index}
            data-selected={index === selected ? "true" : "false"}
            data-playing={playing && index === shown ? "true" : "false"}
            className={"px-anim-thumb" + dragClass(index)}
            onPointerDown={(event) => thumbDown(event, index)}
            onPointerMove={thumbMove}
            onPointerUp={thumbUp}
            onPointerCancel={thumbUp}
          >
            <FrameThumbnail sprite={frame} box={40} />
            <span className="px-anim-number" aria-hidden="true">
              {index + 1}
            </span>
            {playing && index === shown && (
              <span className="px-anim-cursor" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      {!animationSaveAvailable && count > 1 && (
        <p className="px-anim-note" id="px-anim-note" data-animation-note="true">
          {copy("animationSaveNote")}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {count > 1
          ? copy("animationFrameAnnounce")
              .replace("{index}", String(selected + 1))
              .replace("{total}", String(count))
          : ""}
      </span>
    </section>
  );
}
