import { assets } from "../src/runtime/assets.ts";
import { readFileSync } from "node:fs";
import { en } from "../src/locales/en.ts";
import { examples } from "../src/content/examples.ts";
import { spells } from "../src/content/spellbook.ts";
import { programStrings, searchWords } from "../src/content/translation.ts";
export const columns = [
  "key",
  "source",
  "translation",
  "context",
  "type",
  "file",
  "notes",
];
export function collectRows() {
  const rows = [];
  const add = (key, source, context, type, file, notes = "") => {
    if (!source) return;
    const placeholders = source.match(/\{\w+\}/g) ?? [];
    rows.push({
      key,
      source,
      translation: "",
      context,
      type,
      file,
      notes: [
        notes,
        placeholders.length
          ? `Keep placeholders exactly: ${[...new Set(placeholders)].join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  };
  for (const [key, value] of Object.entries(en)) {
    if (typeof value === "string")
      add(
        "ui." + key,
        value,
        `Application ${key} label/status`,
        "ui",
        "src/locales/en.ts",
        key === "brand"
          ? "Product name; keep unchanged."
          : "Keep UI labels concise.",
      );
    else
      for (const [name, text] of Object.entries(value))
        add(
          key + "." + (key === "errorValues" ? encodeURIComponent(name) : name),
          text,
          `${key === "errors" ? "Friendly error template" : "Expected ingredient/error value"}: ${name}`,
          key === "errors" ? "error" : "other",
          "src/locales/en.ts",
        );
  }
  for (const asset of assets) {
    for (const field of ["name", "tags"])
      add(
        `asset.${asset.id}.${field}`,
        asset[field],
        `Inventory ${asset.category}: ${asset.id} ${field}`,
        "other",
        "src/runtime/assets.ts",
        field === "tags"
          ? "Space-separated search terms. Internal asset ID stays unchanged."
          : "Human name only; keep the separate runtime ID unchanged.",
      );
  }
  const addProgram = (prefix, code, file, context) => {
    for (const text of programStrings(code))
      add(
        `${prefix}.string.${text.index}`,
        text.source,
        `${context}, program string on line ${text.line}`,
        "other",
        file,
        "Translate human words only; keep surrounding BASIC syntax English. No double quotes or line breaks in this cell. Preserve intentional edge spaces.",
      );
  };
  for (const ex of examples) {
    for (const field of ["title", "description", "tweak", "controls"])
      add(
        `example.${ex.id}.${field}`,
        ex[field],
        `Example ${ex.title}: ${field}`,
        field === "tweak" ? "hint" : "example",
        "src/content/examples.ts",
      );
    addProgram(
      `example.${ex.id}.code`,
      ex.code,
      "src/content/examples.ts",
      ex.title,
    );
  }
  for (const spell of spells) {
    const prefix = `spell.${spell.id}`;
    if (!/^\.?[A-Z_]+(?:\s*\/\s*\.?[A-Z_]+)*$/.test(spell.name))
      add(
        prefix + ".name",
        spell.name,
        `Concept/entry heading; ${spell.syntax}`,
        "concept",
        "src/content/spellbook.ts",
      );
    add(
      prefix + ".description",
      spell.description,
      `Spellbook explanation for ${spell.name}`,
      spell.id.includes("concept") || spell.id === "variables"
        ? "concept"
        : "spellbook",
      "src/content/spellbook.ts",
    );
    add(
      prefix + ".summary",
      spell.summary,
      `Child-friendly one-line summary for ${spell.name}`,
      "spellbook",
      "src/content/spell-summaries.ts",
      "One short, friendly sentence for 7–10-year-olds (about 12 words or fewer).",
    );
    add(
      prefix + ".search",
      searchWords(spell.tags),
      `Additional search terms for ${spell.name}`,
      "spellbook",
      "src/content/spellbook.ts",
      "Space-separated search words; English command/ID terms remain searchable.",
    );
    addProgram(
      prefix + ".code",
      spell.code,
      "src/content/spellbook.ts",
      `Spellbook ${spell.name}`,
    );
  }
  const markdown = readFileSync(
      new URL("../src/content/stories/en/tower.md", import.meta.url),
      "utf8",
    ),
    metadata = JSON.parse(
      readFileSync(
        new URL("../src/content/stories/en/tower.json", import.meta.url),
        "utf8",
      ),
    );
  add(
    "story.tower.title",
    markdown.split("\n")[0].replace(/^# /, ""),
    "Story title",
    "story",
    "src/content/stories/en/tower.md",
  );
  markdown
    .split(/^## /m)
    .slice(1)
    .forEach((chunk, i) => {
      const [title, ...rest] = chunk.trim().split("\n");
      const prefix = `story.tower.scene.${i}`;
      add(
        prefix + ".title",
        title,
        `Chapter ${i + 1} heading`,
        "story",
        "src/content/stories/en/tower.md",
      );
      rest
        .join("\n")
        .trim()
        .split(/\n\s*\n/)
        .forEach((p, j) =>
          add(
            `${prefix}.paragraph.${j}`,
            p,
            `Chapter ${i + 1}: ${title}, paragraph ${j + 1}`,
            "story",
            "src/content/stories/en/tower.md",
          ),
        );
      add(
        prefix + ".hint",
        metadata[i].hint,
        `Chapter ${i + 1} Spellbook hint`,
        "hint",
        "src/content/stories/en/tower.json",
      );
      for (const field of ["starter", "example"])
        addProgram(
          prefix + "." + field,
          metadata[i][field],
          "src/content/stories/en/tower.json",
          `Chapter ${i + 1} ${field}`,
        );
    });
  const seen = new Map();
  for (const row of rows) {
    if (seen.has(row.key) && seen.get(row.key).source !== row.source)
      throw new Error("Conflicting duplicate key: " + row.key);
    seen.set(row.key, row);
  }
  return [...seen.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}
export function encodeCsv(rows) {
  return (
    "\uFEFF" +
    [columns, ...rows.map((r) => columns.map((k) => r[k] ?? ""))]
      .map((row) =>
        row
          .map((value) => '"' + String(value).replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const records = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error("Unexpected quote");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed) throw new Error("Characters after closing quote");
      cell += c;
    }
  }
  if (quoted) throw new Error("Missing closing quote");
  if (cell || row.length) {
    row.push(cell);
    records.push(row);
  }
  const header = records.shift();
  if (
    !header ||
    columns.some((c) => !header.includes(c)) ||
    new Set(header).size !== header.length
  )
    throw new Error("Unexpected CSV columns");
  return records
    .filter((r) => r.some(Boolean))
    .map((r) => {
      if (r.length !== header.length)
        throw new Error("Unexpected CSV cell count");
      return Object.fromEntries(header.map((key, i) => [key, r[i]]));
    });
}
export function validateTranslations(csv, rows = collectRows()) {
  const known = new Map(rows.map((r) => [r.key, r])),
    seen = new Set(),
    table = {};
  for (const row of parseCsv(csv)) {
    if (!known.has(row.key)) throw new Error("Unknown key: " + row.key);
    if (seen.has(row.key)) throw new Error("Duplicate key: " + row.key);
    seen.add(row.key);
    const source = known.get(row.key).source;
    if (row.source !== source) throw new Error("Outdated source: " + row.key);
    if (row.translation === "") continue;
    const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join("|");
    if (placeholders(row.translation) !== placeholders(source))
      throw new Error("Changed placeholders: " + row.key);
    if (/\.string\.\d+$/.test(row.key) && /["\r\n]/.test(row.translation))
      throw new Error(
        "BASIC strings cannot contain double quotes or line breaks: " + row.key,
      );
    if (
      /\.string\.\d+$/.test(row.key) &&
      ((source.startsWith(" ") && !row.translation.startsWith(" ")) ||
        (source.endsWith(" ") && !row.translation.endsWith(" ")))
    )
      throw new Error("Changed program string edge spaces: " + row.key);
    table[row.key] = row.translation;
  }
  return Object.fromEntries(
    Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}
