/**
 * Small, dependency-free Markdown reader for the Handbook.
 *
 * The same parser is used by the reader (`src/Book.tsx`) and by the example
 * test (`tests/book.test.ts`), so the programs that are tested are exactly the
 * programs readers see. Output is a plain AST that React renders as elements:
 * nothing is injected as HTML.
 *
 * Supported: front matter, `#`–`####` headings with `{#id}`, paragraphs, lists
 * (nested), GitHub alerts (`> [!TIP]`), tables, fenced code with attributes,
 * `<details><summary>`, rules, **bold**, *italic*, `code`, [links](url).
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type CodeAttrs = Record<string, string | true>;
export type AlertKind = "note" | "tip" | "warning" | "important";

export type Block =
  | {
      t: "heading";
      level: 1 | 2 | 3 | 4;
      id: string;
      /** True when the author wrote `{#id}`; those ids are stable across languages. */
      explicit: boolean;
      c: Inline[];
      text: string;
    }
  | { t: "para"; c: Inline[] }
  | { t: "list"; ordered: boolean; items: Block[][] }
  | { t: "quote"; kind?: AlertKind; blocks: Block[] }
  | {
      t: "code";
      lang: string;
      attrs: CodeAttrs;
      code: string;
      /** 1-based line of the opening fence inside the source file. */
      line: number;
    }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "details"; summary: Inline[]; blocks: Block[] }
  | { t: "hr" };

export interface Doc {
  meta: Record<string, string>;
  blocks: Block[];
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

export function parseAttrs(info: string): { lang: string; attrs: CodeAttrs } {
  const trimmed = info.trim();
  const lang = trimmed.split(/\s+/)[0] ?? "";
  const attrs: CodeAttrs = {};
  for (const m of trimmed
    .slice(lang.length)
    .matchAll(/([A-Za-z][\w-]*)(?:=("([^"]*)"|[^\s"]+))?/g))
    attrs[m[1]] = m[2] === undefined ? true : m[3] !== undefined ? m[3] : m[2];
  return { lang, attrs };
}

function safeHref(href: string): string | null {
  if (href.startsWith("book:")) return "/book/" + href.slice(5);
  if (/^(https?:\/\/|\/|#|mailto:)/i.test(href)) return href;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|<>]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (src[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const end = src.indexOf(fence, i + n);
      if (end > 0) {
        flush();
        out.push({ t: "code", v: src.slice(i + n, end).replace(/^ (.*) $/, "$1") });
        i = end + n;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[((?:[^\][]|\[[^\]]*\])*)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        flush();
        if (href) out.push({ t: "link", href, c: parseInline(m[1]) });
        else out.push(...parseInline(m[1]));
        i += m[0].length;
        continue;
      }
    }
    if (ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" && src[i + 1] !== " " && src[i + 1] !== "*") {
      const end = src.indexOf("*", i + 1);
      if (end > i + 1 && src[end - 1] !== " ") {
        flush();
        out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineText(n.c)))
    .join("");
}

const FENCE = /^(\s*)(`{3,}|~{3,})\s*(.*)$/;
const HEADING = /^(#{1,4})\s+(.*?)(?:\s+\{#([A-Za-z0-9_-]+)\})?\s*#*\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseBlocks(lines: string[], base: number, used: Set<string>): Block[] {
  const out: Block[] = [];
  let i = 0;
  const startsBlock = (line: string, next?: string) =>
    FENCE.test(line) ||
    HEADING.test(line) ||
    /^\s*>/.test(line) ||
    LIST.test(line) ||
    /^\s*<details/i.test(line) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const indent = fence[1].length;
      const marker = fence[2];
      const { lang, attrs } = parseAttrs(fence[3]);
      const body: string[] = [];
      const startLine = base + i + 1;
      i++;
      while (
        i < lines.length &&
        !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[i])
      ) {
        body.push(lines[i].slice(Math.min(indent, lines[i].search(/\S|$/))));
        i++;
      }
      i++;
      out.push({ t: "code", lang, attrs, code: body.join("\n"), line: startLine });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const c = parseInline(heading[2]);
      const text = inlineText(c);
      let id = heading[3] ?? slugify(text);
      if (!heading[3]) {
        let n = 2;
        const root = id;
        while (used.has(id)) id = `${root}-${n++}`;
      }
      used.add(id);
      out.push({
        t: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4,
        id,
        explicit: !!heading[3],
        c,
        text,
      });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*<details/i.test(line)) {
      let depth = 0;
      const inner: string[] = [];
      const start = i;
      for (; i < lines.length; i++) {
        depth += (lines[i].match(/<details/gi) ?? []).length;
        depth -= (lines[i].match(/<\/details>/gi) ?? []).length;
        inner.push(lines[i]);
        if (depth <= 0) break;
      }
      i++;
      let text = inner.join("\n").replace(/^\s*<details[^>]*>/i, "");
      text = text.replace(/<\/details>\s*$/i, "");
      const sm = /<summary>([\s\S]*?)<\/summary>/i.exec(text);
      const summary = sm ? parseInline(sm[1].trim()) : [{ t: "text", v: "…" } as Inline];
      if (sm) text = text.replace(sm[0], "");
      out.push({
        t: "details",
        summary,
        blocks: parseBlocks(text.split("\n"), base + start + 1, used),
      });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s*> ?/, ""));
        i++;
      }
      let kind: AlertKind | undefined;
      const m = /^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*$/i.exec(inner[0] ?? "");
      if (m) {
        kind = m[1].toLowerCase() as AlertKind;
        inner.shift();
      }
      out.push({ t: "quote", kind, blocks: parseBlocks(inner, base + i, used) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      out.push({ t: "table", head, rows });
      continue;
    }
    const list = LIST.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const indent = list[1].length;
      const items: Block[][] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (!m || m[1].length !== indent) break;
        const width = m[0].length - m[3].length;
        const itemLines = [m[3]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) {
            // A blank line continues the item only if the next line is indented.
            const next = lines[i + 1];
            if (next !== undefined && next.trim() && next.search(/\S/) > indent) {
              itemLines.push("");
              i++;
              continue;
            }
            break;
          }
          if (l.search(/\S/) <= indent) break;
          itemLines.push(l.slice(Math.min(width, l.search(/\S/))));
          i++;
        }
        items.push(parseBlocks(itemLines, base + i, used));
        while (i < lines.length && !lines[i].trim() && LIST.test(lines[i + 1] ?? "") && (LIST.exec(lines[i + 1])![1].length === indent)) i++;
      }
      out.push({ t: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i], lines[i + 1]))) {
      para.push(lines[i].trim());
      i++;
    }
    out.push({ t: "para", c: parseInline(para.join(" ")) });
  }
  return out;
}

export function parseDocument(source: string): Doc {
  let text = source.replace(/\r\n?/g, "\n");
  const meta: Record<string, string> = {};
  let offset = 0;
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (m) meta[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
    offset = fm[0].split("\n").length - 1;
    text = text.slice(fm[0].length);
  }
  return { meta, blocks: parseBlocks(text.split("\n"), offset, new Set()) };
}

/** Plain text of a document, for search. */
export function blocksText(blocks: Block[]): string {
  const parts: string[] = [];
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.t === "heading") parts.push(b.text);
      else if (b.t === "para") parts.push(inlineText(b.c));
      else if (b.t === "code") parts.push(b.code);
      else if (b.t === "list") b.items.forEach(walk);
      else if (b.t === "quote") walk(b.blocks);
      else if (b.t === "details") {
        parts.push(inlineText(b.summary));
        walk(b.blocks);
      } else if (b.t === "table") {
        [b.head, ...b.rows].forEach((r) => parts.push(r.map(inlineText).join(" ")));
      }
    }
  };
  walk(blocks);
  return parts.join("\n");
}

/** Every fenced code block, anywhere in the tree, in document order. */
export function codeBlocks(blocks: Block[]): Extract<Block, { t: "code" }>[] {
  const found: Extract<Block, { t: "code" }>[] = [];
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.t === "code") found.push(b);
      else if (b.t === "list") b.items.forEach(walk);
      else if (b.t === "quote" || b.t === "details") walk(b.blocks);
    }
  };
  walk(blocks);
  return found;
}

export function headings(blocks: Block[]): Extract<Block, { t: "heading" }>[] {
  const found: Extract<Block, { t: "heading" }>[] = [];
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.t === "heading") found.push(b);
      else if (b.t === "list") b.items.forEach(walk);
      else if (b.t === "quote" || b.t === "details") walk(b.blocks);
    }
  };
  walk(blocks);
  return found;
}

/** Links with a `book:` target, for the link checker. */
export function bookLinks(blocks: Block[]): string[] {
  const links: string[] = [];
  const inline = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.t === "link") {
        links.push(n.href);
        inline(n.c);
      } else if (n.t === "strong" || n.t === "em") inline(n.c);
    }
  };
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.t === "para" || b.t === "heading") inline(b.c);
      else if (b.t === "list") b.items.forEach(walk);
      else if (b.t === "quote") walk(b.blocks);
      else if (b.t === "details") {
        inline(b.summary);
        walk(b.blocks);
      } else if (b.t === "table") [b.head, ...b.rows].forEach((r) => r.forEach(inline));
    }
  };
  walk(blocks);
  return links;
}
