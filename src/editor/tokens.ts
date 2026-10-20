/**
 * Tolerant, position-preserving BASIC tokenizer used by the inline reference.
 *
 * It mirrors the CodeMirror StreamLanguage tokenizer in `Editor.tsx` and the
 * runtime lexer in `runtime/language.ts`, but never throws: user code is often
 * half-written, and the reference must still ignore strings/comments safely.
 */

export type BasicTokenKind =
  "word" | "property" | "number" | "operator" | "punct" | "string" | "comment";

export interface BasicToken {
  /** Absolute offset in the document. */
  from: number;
  /** Absolute end offset (exclusive). */
  to: number;
  text: string;
  kind: BasicTokenKind;
}

export interface TokenHit {
  /** Canonical uppercase word / dotted method / operator. */
  token: string;
  from: number;
  to: number;
}

const WORD = /^[\p{L}_][\p{L}\p{M}\p{N}_]*/u;
// Same shape as the editor tokenizer: a dot followed by ASCII letters/underscore.
const PROPERTY = /^\.[A-Za-z_]+/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)/;
const OPERATOR = /^(<=|>=|<>|[+\-*/=<>])/;
const PUNCT = /^[(),.]/;
const SPACE = /^\s/;

/** Tokenize one line (without its trailing newline). */
export function scanBasicLine(line: string, offset = 0): BasicToken[] {
  const tokens: BasicToken[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (SPACE.test(rest)) {
      i++;
      continue;
    }
    // `REM` must be a whole word; `REMIX` stays an identifier.
    if (rest[0] === "'" || /^REM\b/i.test(rest)) {
      tokens.push({
        from: offset + i,
        to: offset + line.length,
        text: line.slice(i),
        kind: "comment",
      });
      break;
    }
    if (rest[0] === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j++;
      if (j < line.length) j++; // include the closing quote
      tokens.push({
        from: offset + i,
        to: offset + j,
        text: line.slice(i, j),
        kind: "string",
      });
      i = j;
      continue;
    }
    const number = rest.match(NUMBER);
    if (number) {
      tokens.push({
        from: offset + i,
        to: offset + i + number[0].length,
        text: number[0],
        kind: "number",
      });
      i += number[0].length;
      continue;
    }
    const property = rest.match(PROPERTY);
    if (property) {
      tokens.push({
        from: offset + i,
        to: offset + i + property[0].length,
        text: property[0],
        kind: "property",
      });
      i += property[0].length;
      continue;
    }
    const word = rest.match(WORD);
    if (word) {
      tokens.push({
        from: offset + i,
        to: offset + i + word[0].length,
        text: word[0],
        kind: "word",
      });
      i += word[0].length;
      continue;
    }
    const operator = rest.match(OPERATOR);
    if (operator) {
      tokens.push({
        from: offset + i,
        to: offset + i + operator[0].length,
        text: operator[0],
        kind: "operator",
      });
      i += operator[0].length;
      continue;
    }
    const punct = rest.match(PUNCT);
    if (punct) {
      tokens.push({
        from: offset + i,
        to: offset + i + punct[0].length,
        text: punct[0],
        kind: "punct",
      });
      i += punct[0].length;
      continue;
    }
    // Unknown symbol: keep scanning instead of failing on half-written code.
    tokens.push({
      from: offset + i,
      to: offset + i + 1,
      text: line[i],
      kind: "punct",
    });
    i++;
  }
  return tokens;
}

export interface LineInfo {
  start: number;
  end: number;
  text: string;
}

/** Locate the line containing `pos` (a newline itself belongs to the line before). */
export function lineAt(doc: string, pos: number): LineInfo {
  const start = doc.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  let end = doc.indexOf("\n", Math.max(0, pos));
  if (end < 0) end = doc.length;
  return { start, end, text: doc.slice(start, end) };
}

/** Canonical form used by the reference registry: words uppercase, operators as-is. */
export function normalizeToken(raw: string): string {
  const value = raw.trim();
  return /^[+\-*/=<>]+$/.test(value) ? value : value.toUpperCase();
}

/**
 * Resolve a mouse/keyboard selection to one BASIC token.
 *
 * - partial selections expand to the whole token;
 * - `HERO.MOVE_BY` resolves to the member method;
 * - `END IF` resolves as one construct;
 * - anything inside a string, comment, or spanning several tokens returns null.
 */
export function resolveSelectionToken(
  doc: string,
  from: number,
  to: number,
): TokenHit | null {
  if (from < 0 || to > doc.length) return null;
  if (from === to) return resolveCaretToken(doc, from);

  while (from < to && /\s/.test(doc[from])) from++;
  while (to > from && /\s/.test(doc[to - 1])) to--;
  if (from >= to) return null;

  const line = lineAt(doc, from);
  // A range selection over more than one line is not a reference request.
  if (to > line.end) return null;

  const tokens = scanBasicLine(line.text, line.start);
  const overlapping = tokens.filter((t) => t.from < to && t.to > from);
  if (!overlapping.length) return null;
  if (overlapping.some((t) => t.kind === "string" || t.kind === "comment"))
    return null;

  if (overlapping.length === 1) {
    const token = overlapping[0];
    return {
      token: normalizeToken(token.text),
      from: token.from,
      to: token.to,
    };
  }

  const first = overlapping[0];
  const last = overlapping[overlapping.length - 1];

  // `END IF` is the only multi-word construct in the reference surface.
  if (
    first.kind === "word" &&
    last.kind === "word" &&
    first.text.toUpperCase() === "END" &&
    last.text.toUpperCase() === "IF"
  )
    return { token: "END IF", from: first.from, to: last.to };

  // `HERO.MOVE_BY` (or `CAT.X`) resolves to the trailing member token. Keep this
  // to an object + member pair; a whole expression ending in `.X` is not a request.
  if (
    overlapping.length === 2 &&
    first.kind === "word" &&
    last.kind === "property" &&
    last.to >= to
  )
    return {
      token: normalizeToken(last.text),
      from: last.from,
      to: last.to,
    };

  return null;
}

/**
 * Resolve the token at a caret. Used by F1 so help is reachable with the keyboard
 * without selecting text first.
 */
export function resolveCaretToken(doc: string, pos: number): TokenHit | null {
  const clamped = Math.max(0, Math.min(pos, doc.length));
  const line = lineAt(doc, clamped);
  const tokens = scanBasicLine(line.text, line.start);
  let token =
    tokens.find((t) => t.from <= clamped && clamped < t.to) ??
    tokens.find((t) => t.to === clamped) ??
    tokens.find((t) => t.from === clamped);

  if (!token) {
    const left = [...tokens].reverse().find((t) => t.to <= clamped);
    const right = tokens.find((t) => t.from >= clamped);
    if (left && clamped - left.to <= 1) token = left;
    else if (right && right.from - clamped <= 1) token = right;
  }
  if (!token || token.kind === "string" || token.kind === "comment")
    return null;
  return {
    token: normalizeToken(token.text),
    from: token.from,
    to: token.to,
  };
}
