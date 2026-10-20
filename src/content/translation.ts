import { assets } from "../runtime/assets.ts";
const assetIds = new Set(assets.map((asset) => asset.id));
export type CopyTable = Record<string, string>;
// BASIC strings have no quote-escape syntax. Ignore machine IDs and musical pitches.
export function programStrings(code: string) {
  const result: { index: number; source: string; line: number }[] = [];
  let index = 0;
  for (const m of code.matchAll(/"([^"\n]*)"/g)) {
    const prefix = code.slice(code.lastIndexOf("\n", m.index) + 1, m.index);
    if (
      /\b(SPAWN|SOUND|SFX|KEY|NOTE|PLAY)\b/i.test(prefix) ||
      !/[\p{L}]/u.test(m[1]) ||
      m[1] === "A" ||
      assetIds.has(m[1])
    )
      continue;
    result.push({
      index: index++,
      source: m[1],
      line: code.slice(0, m.index).split("\n").length,
    });
  }
  return result;
}
export function translateProgram(
  code: string,
  prefix: string,
  copy: CopyTable,
): string {
  let index = 0;
  return code.replace(
    /"([^"\n]*)"/g,
    (match, source: string, offset: number) => {
      const before = code.slice(code.lastIndexOf("\n", offset) + 1, offset);
      if (
        /\b(SPAWN|SOUND|SFX|KEY|NOTE|PLAY)\b/i.test(before) ||
        !/[\p{L}]/u.test(source) ||
        source === "A" ||
        assetIds.has(source)
      )
        return match;
      const translation = copy[`${prefix}.string.${index++}`];
      return translation === undefined || /["\r\n]/.test(translation)
        ? match
        : `"${translation}"`;
    },
  );
}
export function searchWords(tags: string): string {
  const stable = new Set(
    "cat wizard ghost key door star crate dynamite rocket slime explosion coin laser jump for next if then end step to rnd random spawn move move_by turn show hide destroy say explode".split(
      " ",
    ),
  );
  return tags
    .split(/\s+/)
    .filter(
      (w) =>
        w && !stable.has(w.toLowerCase()) && !assetIds.has(w.toLowerCase()),
    )
    .join(" ");
}
