/**
 * Inline BASIC reference adapter.
 *
 * The Spellbook remains the single source of descriptions, summaries, syntax,
 * examples and translations. This module only maps editor tokens to stable
 * Spellbook entry IDs and adds a few exact per-token signatures/aliases.
 *
 * Maintenance rule: when a BASIC command/function/method/property/operator is
 * added to the runtime, add its token here (and to the Spellbook) in the same
 * change. `tests/reference.test.ts` checks coverage against `runtime/engine`.
 */
import type { Spell } from "./spellbook";
import { normalizeToken } from "../editor/tokens";

export type ReferenceKind =
  "command" | "function" | "method" | "property" | "keyword" | "operator";

export interface ReferenceEntry {
  /** Canonical token as it appears in source: CIRCLE, .MOVE_BY, >=, AND. */
  key: string;
  /** Stable Spellbook id (see `src/content/spellbook.ts`). */
  spellId: string;
  kind: ReferenceKind;
  /** Exact signature for this token; falls back to the Spellbook syntax. */
  syntax?: string;
}

export interface ReferenceCard {
  key: string;
  kind: ReferenceKind;
  spell: Spell;
  syntax: string;
}

/**
 * Exact signatures for tokens whose Spellbook entry covers more than one form.
 * The BASIC text itself is never translated.
 */
const SYNTAX: Record<string, string> = {
  PUSH: "PUSH list,value",
  LIST: "LIST()",
  ITEM: "ITEM(list,index)",
  COUNT: "COUNT(list)",
  RND: "RND(min,max)",
  RANDOM: "RANDOM(min,max)",
  KEY: 'KEY("LEFT")',
  FOR: "FOR name = start TO end [STEP amount] … NEXT name",
  NEXT: "FOR name = start TO end [STEP amount] … NEXT name",
  STEP: "FOR name = start TO end [STEP amount] … NEXT name",
  TO: "FOR name = start TO end [STEP amount] … NEXT name",
  IF: "IF condition THEN … END IF",
  THEN: "IF condition THEN … END IF",
  "END IF": "IF condition THEN … END IF",
  END: "IF condition THEN … END IF",
  ELSE: "IF condition THEN … ELSE … END IF",
  DO: "DO … LOOP",
  LOOP: "DO … LOOP",
  LET: "LET NAME = value",
  AND: "condition AND condition",
  OR: "condition OR condition",
  NOT: "NOT condition",
  "+": "a + b",
  "-": "a - b",
  "*": "a * b",
  "/": "a / b",
  "=": "a = b",
  "<>": "a <> b",
  "<": "a < b",
  ">": "a > b",
  "<=": "a <= b",
  ">=": "a >= b",
  ".X": "OBJECT.X",
  ".Y": "OBJECT.Y",
  ".WIDTH": "OBJECT.WIDTH",
  ".HEIGHT": "OBJECT.HEIGHT",
  ".VISIBLE": "OBJECT.VISIBLE",
  ".ALIVE": "OBJECT.ALIVE",
};

const COMMANDS: Record<string, string> = {
  FRAME: "frame",
  PUSH: "list-push-item-count",
  SFX: "sfx",
  CLS: "cls",
  INK: "ink",
  PAPER: "paper",
  BORDER: "border",
  BRIGHT: "bright",
  PLOT: "plot",
  LINE: "line",
  BOX: "box",
  FILLBOX: "fillbox",
  CIRCLE: "circle",
  FILLCIRCLE: "fillcircle",
  TEXT: "text",
  WAIT: "wait",
  PRINT: "print",
  BEEP: "beep",
  NOTE: "note",
  REST: "rest",
  TEMPO: "tempo",
  PLAY: "play",
  SOUND: "sound",
};

const FUNCTIONS: Record<string, string> = {
  SPAWN: "spawn",
  RND: "rnd-random",
  RANDOM: "rnd-random",
  SIN: "sin",
  COS: "cos",
  ABS: "abs",
  ROUND: "round",
  KEY: "key",
  HIT: "hit",
  LIST: "list-push-item-count",
  ITEM: "list-push-item-count",
  COUNT: "list-push-item-count",
};

const METHODS: Record<string, string> = {
  ".SIZE": "size",
  ".MOVE": "move",
  ".MOVE_BY": "move-by",
  ".TURN": "turn",
  ".SHOW": "show",
  ".HIDE": "hide",
  ".DESTROY": "destroy",
  ".SAY": "say",
  ".EXPLODE": "explode",
};

const PROPERTIES: Record<string, string> = {
  ".X": "x-y-visible",
  ".Y": "x-y-visible",
  ".VISIBLE": "x-y-visible",
  ".WIDTH": "size",
  ".HEIGHT": "size",
  ".ALIVE": "size",
};

const KEYWORDS: Record<string, string> = {
  FOR: "for",
  NEXT: "for",
  STEP: "for",
  TO: "for",
  IF: "if",
  THEN: "if",
  "END IF": "if",
  END: "if",
  ELSE: "else",
  DO: "do-loop",
  LOOP: "do-loop",
  AND: "and-or-not",
  OR: "and-or-not",
  NOT: "and-or-not",
  LET: "variables",
};

const OPERATORS: Record<string, string> = {
  "+": "arithmetic",
  "-": "arithmetic",
  "*": "arithmetic",
  "/": "arithmetic",
  "=": "comparisons",
  "<>": "comparisons",
  "<": "comparisons",
  ">": "comparisons",
  "<=": "comparisons",
  ">=": "comparisons",
};

function collect(
  kind: ReferenceKind,
  spellsById: Record<string, string>,
): ReferenceEntry[] {
  return Object.entries(spellsById).map(([key, spellId]) => ({
    key,
    spellId,
    kind,
    syntax: SYNTAX[key],
  }));
}

export const referenceEntries: ReferenceEntry[] = [
  ...collect("command", COMMANDS),
  ...collect("function", FUNCTIONS),
  ...collect("method", METHODS),
  ...collect("property", PROPERTIES),
  ...collect("keyword", KEYWORDS),
  ...collect("operator", OPERATORS),
];

const byKey = new Map<string, ReferenceEntry>();
for (const entry of referenceEntries) {
  if (byKey.has(entry.key))
    throw new Error(`Duplicate inline reference token: ${entry.key}`);
  byKey.set(entry.key, entry);
}

/** Token lookups are case-insensitive for words; operators are exact. */
export function lookupReference(raw: string): ReferenceEntry | undefined {
  return byKey.get(normalizeToken(raw));
}

/**
 * Build a localized card from a Spellbook entry. The prose, example and
 * translations always come from the Spellbook; only the signature can be
 * token-specific.
 */
export function buildReferenceCard(
  entry: ReferenceEntry,
  localizedSpells: readonly Spell[],
): ReferenceCard | null {
  const spell = localizedSpells.find(
    (candidate) => candidate.id === entry.spellId,
  );
  if (!spell) return null;
  return {
    key: entry.key,
    kind: entry.kind,
    spell,
    syntax: entry.syntax ?? spell.syntax,
  };
}
