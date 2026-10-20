import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { commands, functions } from "./runtime/engine";
import { t, type Locale } from "./i18n";
import { scanBasicLine, type BasicToken } from "./editor/tokens";
import type { ReferenceCard, ReferenceKind } from "./content/reference";

export type InsertMode = "cursor" | "below" | "replace";

const KIND_KEYS: Record<ReferenceKind, Parameters<typeof t>[0]> = {
  command: "referenceKindCommand",
  function: "referenceKindFunction",
  method: "referenceKindMethod",
  property: "referenceKindProperty",
  keyword: "referenceKindKeyword",
  operator: "referenceKindOperator",
};

const CODE_WORDS = new Set([
  ...commands,
  ...functions,
  "AND",
  "OR",
  "NOT",
  "TRUE",
  "FALSE",
  "DO",
  "LOOP",
  "FOR",
  "NEXT",
  "IF",
  "THEN",
  "END",
  "STEP",
  "TO",
  "LET",
  "ELSE",
  "REM",
]);

function tokenClass(token: BasicToken): string | undefined {
  switch (token.kind) {
    case "string":
      return "tok-string";
    case "comment":
      return "tok-comment";
    case "number":
      return "tok-number";
    case "property":
      return "tok-property";
    case "operator":
      return "tok-operator";
    case "word":
      return CODE_WORDS.has(token.text.toUpperCase())
        ? "tok-keyword"
        : undefined;
    default:
      return undefined;
  }
}

/** Tiny syntax highlighter for the short, runnable Spellbook example. */
function HighlightedCode({ code }: { code: string }) {
  return (
    <pre className="reference-code">
      <code>
        {code.split("\n").map((line, lineIndex) => {
          const tokens = scanBasicLine(line);
          const parts: ReactNode[] = [];
          let cursor = 0;
          tokens.forEach((token, tokenIndex) => {
            if (token.from > cursor)
              parts.push(
                <span key={`gap-${tokenIndex}`}>
                  {line.slice(cursor, token.from)}
                </span>,
              );
            parts.push(
              <span className={tokenClass(token)} key={`tok-${tokenIndex}`}>
                {token.text}
              </span>,
            );
            cursor = token.to;
          });
          if (cursor < line.length)
            parts.push(<span key="tail">{line.slice(cursor)}</span>);
          return (
            <span className="reference-line" key={lineIndex}>
              {lineIndex > 0 ? "\n" : null}
              {parts}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export function InlineReference({
  card,
  anchor,
  bounds,
  locale,
  readOnly,
  focusOnOpen,
  hasSelection,
  onClose,
  onCopy,
  onInsert,
  onOpenSpellbook,
  onPointerEnter,
  onPointerLeave,
}: {
  card: ReferenceCard;
  anchor: { top: number; bottom: number; left: number; right: number };
  bounds: { left: number; right: number };
  locale: Locale;
  readOnly: boolean;
  focusOnOpen: boolean;
  hasSelection: boolean;
  onClose: (restoreEditorFocus: boolean) => void;
  onCopy: (code: string) => Promise<boolean>;
  onInsert: (code: string, mode: InsertMode) => void;
  onOpenSpellbook?: (spellId: string) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const titleId = useId();
  const summaryId = useId();
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState(false);
  const copy = (key: Parameters<typeof t>[0]) => t(key, locale);

  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setStatus("");
    setConfirming(false);
  }, [card.key, card.spell.id]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setSize((previous) =>
      Math.abs(previous.width - rect.width) < 0.5 &&
      Math.abs(previous.height - rect.height) < 0.5
        ? previous
        : { width: rect.width, height: rect.height },
    );
  }, [card.key, card.spell.id, locale, status, confirming, viewport]);

  useEffect(() => {
    if (!focusOnOpen) return;
    // Wait for the layout effect that measures the card; a hidden element cannot
    // take focus in some browsers. Focus a button, not the -1 container: WebKit
    // otherwise tabs out of the card instead of into its controls.
    const frame = requestAnimationFrame(() =>
      closeButton.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusOnOpen, card.key, card.spell.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "F1") {
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        return;
      }
      // Keep Tab predictable inside the card. CodeMirror keeps Tab while the
      // editor has focus; only this non-modal card cycles its own controls.
      if (
        event.key === "Tab" &&
        root.current?.contains(document.activeElement)
      ) {
        const buttons = [
          ...root.current.querySelectorAll<HTMLButtonElement>(
            "button:not([disabled])",
          ),
        ];
        if (!buttons.length) return;
        event.preventDefault();
        event.stopPropagation();
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next = event.shiftKey
          ? buttons[(index <= 0 ? buttons.length : index) - 1]
          : buttons[(index + 1) % buttons.length];
        next.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const panelWidth = Math.min(
    420,
    Math.max(240, viewport.width - 16),
    Math.max(240, bounds.right - bounds.left),
  );
  const maxHeight = Math.min(440, Math.max(200, viewport.height - 16));
  const centered =
    anchor.left + (anchor.right - anchor.left) / 2 - panelWidth / 2;
  const minLeft = Math.max(8, bounds.left);
  const maxLeft = Math.max(
    minLeft,
    Math.min(viewport.width - panelWidth - 8, bounds.right - panelWidth),
  );
  const left = Math.min(Math.max(minLeft, centered), maxLeft);

  let top = anchor.bottom + 8;
  if (size.height > 0) {
    const below = anchor.bottom + 8;
    const above = anchor.top - size.height - 8;
    if (below + size.height <= viewport.height - 8) top = below;
    else if (above >= 8) top = above;
    else top = 8;
  }
  top = Math.min(
    Math.max(8, top),
    Math.max(8, viewport.height - size.height - 8),
  );

  async function handleCopy() {
    const ok = await onCopy(card.spell.code);
    setStatus(copy(ok ? "referenceCopied" : "referenceCopyFailed"));
  }

  function handleInsert(mode: InsertMode) {
    setConfirming(false);
    onInsert(card.spell.code, mode);
  }

  return createPortal(
    <div
      ref={root}
      className="inline-reference"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      tabIndex={-1}
      style={{
        top,
        left,
        width: panelWidth,
        maxHeight,
        visibility: size.height > 0 ? "visible" : "hidden",
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="reference-head">
        <span className="reference-kind">{copy(KIND_KEYS[card.kind])}</span>
        <code className="reference-token">{card.key}</code>
        <button
          ref={closeButton}
          type="button"
          className="reference-close"
          aria-label={copy("close")}
          onClick={() => onClose(true)}
        >
          ×
        </button>
      </div>
      <h2 id={titleId}>{card.spell.name}</h2>
      <p id={summaryId} className="reference-summary">
        {card.spell.summary}
      </p>
      <code className="reference-syntax">{card.syntax}</code>
      <HighlightedCode code={card.spell.code} />
      <p className="reference-try">{copy("referenceTry")}</p>
      <div className="reference-actions">
        <button type="button" onClick={() => void handleCopy()}>
          {copy("referenceCopyExample")}
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() =>
              hasSelection ? setConfirming(true) : handleInsert("cursor")
            }
          >
            {copy("referenceInsertExample")}
          </button>
        )}
        {onOpenSpellbook && (
          <button
            type="button"
            onClick={() => {
              onOpenSpellbook(card.spell.id);
              onClose(false);
            }}
          >
            {copy("referenceOpenSpellbook")}
          </button>
        )}
      </div>
      {confirming && (
        <div className="reference-confirm" role="group">
          <p>{copy("referenceReplaceConfirm")}</p>
          <div className="reference-actions">
            <button type="button" onClick={() => handleInsert("below")}>
              {copy("referenceInsertBelow")}
            </button>
            <button type="button" onClick={() => handleInsert("replace")}>
              {copy("referenceReplaceSelection")}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              {copy("referenceCancel")}
            </button>
          </div>
        </div>
      )}
      <p className="reference-status" aria-live="polite">
        {status}
      </p>
    </div>,
    document.body,
  );
}
