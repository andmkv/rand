import {
  history,
  historyKeymap,
  defaultKeymap,
  indentLess,
  insertTab,
} from "@codemirror/commands";
import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import {
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  indentUnit,
  indentOnInput,
} from "@codemirror/language";
import { autocompletion, closeCompletion } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { commands, methods, functions } from "./runtime/engine";
import type { Spell } from "./content/spellbook";
import {
  buildReferenceCard,
  lookupReference,
  type ReferenceCard,
} from "./content/reference";
import {
  resolveCaretToken,
  resolveSelectionToken,
  type TokenHit,
} from "./editor/tokens";
import { InlineReference, type InsertMode } from "./InlineReference";
import { t, type Locale } from "./i18n";
const language = StreamLanguage.define<{ indent: number }>({
  startState: () => ({ indent: 0 }),
  token(stream, state) {
    if (stream.sol()) {
      if (/^\s*(NEXT\b|LOOP\b|END\s+IF\b)/i.test(stream.string))
        state.indent = Math.max(0, state.indent - 2);
      else if (/^\s*(FOR|IF|DO)\b/i.test(stream.string)) state.indent += 2;
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/'.*|REM\b.*/i)) return "comment";
    if (stream.match(/"[^"\n]*"?/)) return "string";
    if (stream.match(/\d+(\.\d+)?/)) return "number";
    if (stream.match(/\.[A-Za-z_]+/)) return "propertyName";
    if (stream.match(/[\p{L}_][\p{L}\p{M}\p{N}_]*/u)) {
      const v = stream.current().toUpperCase();
      return [
        ...commands,
        ...functions,
        "ELSE",
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
        "INPUT",
        "SPAWN",
        "RND",
        "RANDOM",
        "SIN",
        "COS",
        "ABS",
        "ROUND",
      ].includes(v)
        ? "keyword"
        : "variableName";
    }
    stream.next();
    return null;
  },
  indent(state, text) {
    return Math.max(
      0,
      state.indent - (/^\s*(NEXT|LOOP|END IF|ELSE)/i.test(text) ? 2 : 0),
    );
  },
});
const theme = EditorView.theme(
  {
    "&": { color: "#ffe38a", backgroundColor: "#121726" },
    ".cm-content": { caretColor: "#a6f1cf", padding: "12px" },
    ".cm-gutters": {
      backgroundColor: "#1a2031",
      color: "#7885a7",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "#222c43" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      background: "#41496c",
    },
    ".cm-tooltip": {
      background: "#27334c",
      color: "#fff",
      border: "1px solid #66718f",
    },
  },
  { dark: true },
);

interface OpenReference {
  card: ReferenceCard;
  anchor: { top: number; bottom: number; left: number; right: number };
  bounds: { left: number; right: number };
  from: number;
  to: number;
  focus: boolean;
  hasSelection: boolean;
}

export function Editor({
  code,
  onChange,
  onRun,
  line,
  label,
  readOnly = false,
  insertRef,
  locale = "en",
  spells: localizedSpells,
  running = false,
  onOpenSpellbook,
}: {
  code: string;
  onChange: (s: string) => void;
  onRun: (source: string) => void;
  line?: number;
  label: string;
  readOnly?: boolean;
  /** Inventory hands the editor one statement to place at the caret, on its own line. */
  insertRef?: { current: ((text: string) => void) | null };
  locale?: Locale;
  spells: Spell[];
  running?: boolean;
  onOpenSpellbook?: (spellId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    change = useRef(onChange),
    run = useRef(onRun);
  change.current = onChange;
  run.current = onRun;

  const [reference, setReference] = useState<OpenReference | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const localizedSpellsRef = useRef(localizedSpells);
  localizedSpellsRef.current = localizedSpells;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const runningRef = useRef(running);
  runningRef.current = running;
  const openSpellbookRef = useRef(onOpenSpellbook);
  openSpellbookRef.current = onOpenSpellbook;

  const dialogOpen = useRef(false);
  const closeRef = useRef<(restoreFocus?: boolean) => void>(() => {});
  const openRef = useRef<(hit: TokenHit, focus: boolean) => boolean>(
    () => false,
  );
  const openAtRef = useRef<(view: EditorView, focus: boolean) => boolean>(
    () => false,
  );
  const hoverEnterRef = useRef<() => void>(() => {});
  const hoverLeaveRef = useRef<() => void>(() => {});
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  rangeRef.current = reference
    ? { from: reference.from, to: reference.to }
    : null;

  const selectionTimer = useRef<number | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverCloseTimer = useRef<number | undefined>(undefined);
  const focusFrame = useRef<number | undefined>(undefined);
  const suppressAutoUntil = useRef(0);
  const hoverOpened = useRef(false);

  function closeReference(restoreFocus = false) {
    dialogOpen.current = false;
    hoverOpened.current = false;
    setReference(null);
    if (restoreFocus) {
      if (focusFrame.current !== undefined)
        cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = undefined;
        view.current?.focus();
      });
    }
  }
  closeRef.current = closeReference;

  function openReference(hit: TokenHit, focus: boolean) {
    const entry = lookupReference(hit.token);
    if (!entry) return false;
    const card = buildReferenceCard(entry, localizedSpellsRef.current);
    if (!card) return false;
    const current = view.current;
    if (!current) return false;
    const start = current.coordsAtPos(hit.from);
    const end = current.coordsAtPos(hit.to);
    if (!start || !end) return false;
    if (focus && focusFrame.current !== undefined) {
      // A quick F1 after Escape must win over the deferred editor focus.
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = undefined;
    }
    const editorBounds = current.dom.getBoundingClientRect();
    setReference({
      card,
      from: hit.from,
      to: hit.to,
      focus,
      hasSelection: !current.state.selection.main.empty,
      bounds: { left: editorBounds.left, right: editorBounds.right },
      anchor: {
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
        left: Math.min(start.left, end.left),
        right: Math.max(start.right, end.right),
      },
    });
    dialogOpen.current = true;
    setAnnouncement(`${t("reference", localeRef.current)}: ${card.spell.name}`);
    return true;
  }
  openRef.current = openReference;

  function openAtSelection(current: EditorView, focus: boolean) {
    const selection = current.state.selection.main;
    const doc = current.state.doc.toString();
    const hit = selection.empty
      ? resolveCaretToken(doc, selection.head)
      : resolveSelectionToken(doc, selection.from, selection.to);
    if (!hit) {
      setAnnouncement(t("referenceNone", localeRef.current));
      return false;
    }
    if (focus) closeCompletion(current);
    return openReference(hit, focus);
  }
  openAtRef.current = openAtSelection;

  async function copyExample(source: string) {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(source);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      const area = document.createElement("textarea");
      area.value = source;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
    }
    requestAnimationFrame(() => view.current?.focus());
    return ok;
  }

  function insertExample(source: string, mode: InsertMode) {
    const current = view.current;
    if (!current || current.state.readOnly) return;
    const selection = current.state.selection.main;
    const doc = current.state.doc;
    let from = selection.from;
    let to = selection.to;
    let text = source;
    if (mode === "below") {
      const line = doc.lineAt(selection.to);
      const indent = line.text.match(/^\s*/)?.[0] ?? "";
      const block =
        "\n" +
        source
          .split("\n")
          .map((part) => indent + part)
          .join("\n");
      from = line.to;
      to = line.to;
      text = block;
    } else if (mode === "cursor") {
      const line = doc.lineAt(selection.head);
      const before = doc.sliceString(line.from, selection.head);
      const after = doc.sliceString(selection.head, line.to);
      const indent = before.match(/^\s*/)?.[0] ?? "";
      let block = source
        .split("\n")
        .map((part, index) => (index === 0 ? part : indent + part))
        .join("\n");
      if (before.trim()) block = "\n" + block;
      if (after.trim()) block += "\n";
      from = selection.head;
      to = selection.head;
      text = block;
    }
    current.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
      userEvent: "input",
    });
    closeReference(false);
    requestAnimationFrame(() => current.focus());
  }

  useEffect(() => {
    if (running) closeRef.current(false);
  }, [running]);
  useEffect(() => {
    closeRef.current(false);
  }, [locale]);

  useEffect(() => {
    const clearSelectionTimer = () => {
      if (selectionTimer.current !== undefined) {
        window.clearTimeout(selectionTimer.current);
        selectionTimer.current = undefined;
      }
    };
    const clearHoverTimer = () => {
      if (hoverTimer.current !== undefined) {
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = undefined;
      }
    };
    const clearHoverClose = () => {
      if (hoverCloseTimer.current !== undefined) {
        window.clearTimeout(hoverCloseTimer.current);
        hoverCloseTimer.current = undefined;
      }
    };
    const startHoverClose = () => {
      clearHoverClose();
      hoverCloseTimer.current = window.setTimeout(() => {
        hoverCloseTimer.current = undefined;
        if (hoverOpened.current) closeRef.current(false);
      }, 500);
    };
    const scheduleSelection = (current: EditorView) => {
      clearSelectionTimer();
      const selection = current.state.selection.main;
      if (selection.empty || runningRef.current) return;
      if (dialogOpen.current) closeRef.current(false);
      const from = selection.from;
      const to = selection.to;
      selectionTimer.current = window.setTimeout(() => {
        selectionTimer.current = undefined;
        if (Date.now() < suppressAutoUntil.current) return;
        if (runningRef.current || dialogOpen.current) return;
        const latest = view.current;
        if (!latest) return;
        const now = latest.state.selection.main;
        if (now.from !== from || now.to !== to) return;
        const hit = resolveSelectionToken(
          latest.state.doc.toString(),
          from,
          to,
        );
        if (hit) openRef.current(hit, false);
      }, 220);
    };

    hoverEnterRef.current = clearHoverClose;
    hoverLeaveRef.current = () => {
      if (hoverOpened.current && dialogOpen.current) startHoverClose();
    };

    view.current = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: code,
        extensions: [
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          history(),
          lineNumbers(),
          highlightActiveLine(),
          language,
          indentUnit.of("  "),
          indentOnInput(),
          language.data.of({
            indentOnInput: /^\s*(NEXT\b|LOOP\b|END\s+IF\b|ELSE\b)/i,
          }),
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.keyword, color: "#a6f1cf" },
              { tag: tags.string, color: "#f2b1dc" },
              { tag: tags.number, color: "#93baff" },
              { tag: tags.comment, color: "#8996b2" },
              { tag: tags.propertyName, color: "#ffb789" },
            ]),
          ),
          theme,
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-keyshortcuts": "F1",
          }),
          autocompletion({
            override: [
              (context) => {
                const word = context.matchBefore(/[.\p{L}\p{M}\p{N}_]+/u);
                if (!word || (!context.explicit && word.to - word.from < 2))
                  return null;
                return {
                  from: word.from,
                  options: [
                    ...commands,
                    ...functions,
                    "ELSE",
                    "AND",
                    "OR",
                    "NOT",
                    "TRUE",
                    "FALSE",
                    "DO",
                    "LOOP",
                    "FOR",
                    "IF",
                    "INPUT",
                    "SPAWN",
                    "RND",
                    ...methods.map((m) => "." + m),
                    ...["X", "Y", "WIDTH", "HEIGHT", "VISIBLE", "ALIVE"].map(
                      (p) => "." + p,
                    ),
                  ].map((label) => ({ label, type: "keyword" })),
                };
              },
            ],
          }),
          keymap.of([
            {
              key: "F1",
              run: (current) => {
                if (dialogOpen.current) {
                  closeRef.current(true);
                  return true;
                }
                openAtRef.current(current, true);
                return true;
              },
            },
            {
              key: "Mod-Enter",
              run: (v) => {
                run.current(v.state.doc.toString());
                return true;
              },
            },
            {
              // Tab indents a selection and inserts spaces at the caret; it never deletes code.
              key: "Tab",
              run: (v) => (v.state.readOnly ? false : insertTab(v)),
              shift: (v) => (v.state.readOnly ? false : indentLess(v)),
            },
            {
              key: "Enter",
              run: (v) => {
                if (v.state.readOnly) return false;
                const pos = v.state.selection.main.head;
                const before = v.state.doc.lineAt(pos).text;
                const indent = before.match(/^\s*/)?.[0] ?? "";
                v.dispatch(
                  v.state.replaceSelection(
                    "\n" +
                      indent +
                      (/^\s*(FOR|IF|DO|ELSE)\b/i.test(before) ? "  " : ""),
                  ),
                );
                return true;
              },
            },
          ]),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          EditorView.domEventHandlers({
            mousemove: (event, current) => {
              if (
                runningRef.current ||
                dialogOpen.current ||
                !current.state.selection.main.empty
              ) {
                clearHoverTimer();
                return;
              }
              const pos = current.posAtCoords({
                x: event.clientX,
                y: event.clientY,
              });
              clearHoverTimer();
              if (pos == null) return;
              hoverTimer.current = window.setTimeout(() => {
                hoverTimer.current = undefined;
                if (runningRef.current || dialogOpen.current) return;
                if (!current.state.selection.main.empty) return;
                const hit = resolveCaretToken(
                  current.state.doc.toString(),
                  pos,
                );
                if (!hit) return;
                if (openRef.current(hit, false)) hoverOpened.current = true;
              }, 450);
            },
            mouseleave: () => {
              clearHoverTimer();
              if (hoverOpened.current && dialogOpen.current) startHoverClose();
            },
            keydown: () => {
              clearHoverTimer();
              clearHoverClose();
            },
            mousedown: () => {
              clearHoverTimer();
              clearHoverClose();
              hoverOpened.current = false;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              change.current(u.state.doc.toString());
              suppressAutoUntil.current = Date.now() + 450;
              clearSelectionTimer();
              if (dialogOpen.current) closeRef.current(false);
            }
            if (u.selectionSet || u.docChanged) {
              // A deliberate selection after typing should still open help; only
              // selection changes caused by an edit (Tab indent, autocomplete)
              // stay suppressed.
              if (u.selectionSet && !u.docChanged)
                suppressAutoUntil.current = 0;
              const selection = u.state.selection.main;
              if (selection.empty || runningRef.current) {
                clearSelectionTimer();
                if (selection.empty && dialogOpen.current)
                  closeRef.current(false);
              } else {
                scheduleSelection(u.view);
              }
            }
          }),
        ],
      }),
    });
    const scroller = view.current.scrollDOM;
    const onScroll = () => {
      // A pending hover may be recalculated by the next mousemove; do not cancel
      // it here, because scroll events can arrive after a deliberate pointer move.
      if (hoverOpened.current && dialogOpen.current) closeRef.current(false);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearSelectionTimer();
      clearHoverTimer();
      clearHoverClose();
      if (focusFrame.current !== undefined)
        cancelAnimationFrame(focusFrame.current);
      scroller.removeEventListener("scroll", onScroll);
      view.current?.destroy();
    };
  }, []);

  useEffect(() => {
    const current = view.current;
    if (!current || !rangeRef.current) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const range = rangeRef.current;
      if (!range) return;
      const start = current.coordsAtPos(range.from);
      const end = current.coordsAtPos(range.to);
      if (
        !start ||
        !end ||
        start.top < -40 ||
        start.bottom > window.innerHeight + 40
      ) {
        closeRef.current(false);
        return;
      }
      setReference((previous) => {
        if (!previous) return previous;
        const editorBounds = current.dom.getBoundingClientRect();
        return {
          ...previous,
          bounds: { left: editorBounds.left, right: editorBounds.right },
          anchor: {
            top: Math.min(start.top, end.top),
            bottom: Math.max(start.bottom, end.bottom),
            left: Math.min(start.left, end.left),
            right: Math.max(start.right, end.right),
          },
        };
      });
    };
    const onScrollOrResize = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    current.scrollDOM.addEventListener("scroll", onScrollOrResize, {
      passive: true,
    });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      current.scrollDOM.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [reference !== null]);

  useEffect(() => {
    view.current?.contentDOM.setAttribute("aria-label", label);
  }, [label]);
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => {
      const v = view.current;
      if (!v) return;
      const { doc, selection } = v.state,
        at = selection.main;
      if (!at.empty) {
        // An explicit selection is replaced, like any editor insert.
        v.dispatch({
          changes: { from: at.from, to: at.to, insert: text },
          selection: { anchor: at.from + text.length },
          scrollIntoView: true,
        });
        v.focus();
        return;
      }
      const line = doc.lineAt(at.from),
        before = doc.sliceString(line.from, at.from).trim(),
        after = doc.sliceString(at.from, line.to).trim();
      // Keep BASIC readable: the statement lands on a line of its own, never mid-line.
      const from = after ? line.to : at.from,
        insert = after || before ? "\n" + text : text;
      v.dispatch({
        changes: { from, to: from, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
      });
      v.focus();
    };
    return () => {
      insertRef.current = null;
    };
  }, [insertRef]);
  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== code)
      current.dispatch({
        changes: { from: 0, to: current.state.doc.length, insert: code },
      });
  }, [code]);
  useEffect(() => {
    const current = view.current;
    if (current && line) {
      const pos = current.state.doc.line(
        Math.min(line, current.state.doc.lines),
      ).from;
      current.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
      current.focus();
    }
  }, [line]);

  return (
    <>
      <div className="editor-host" ref={container} />
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {reference && (
        <InlineReference
          card={reference.card}
          anchor={reference.anchor}
          bounds={reference.bounds}
          locale={locale}
          readOnly={readOnly}
          focusOnOpen={reference.focus}
          hasSelection={reference.hasSelection}
          onClose={(restoreFocus) => closeRef.current(restoreFocus)}
          onCopy={copyExample}
          onInsert={insertExample}
          onOpenSpellbook={
            openSpellbookRef.current
              ? (spellId) => openSpellbookRef.current?.(spellId)
              : undefined
          }
          onPointerEnter={() => hoverEnterRef.current()}
          onPointerLeave={() => hoverLeaveRef.current()}
        />
      )}
    </>
  );
}
