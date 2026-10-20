import { describe, expect, it } from "vitest";
import { commands, functions, methods } from "../src/runtime/engine";
import { spells } from "../src/content/spellbook";
import {
  buildReferenceCard,
  lookupReference,
  referenceEntries,
  type ReferenceKind,
} from "../src/content/reference";
import {
  normalizeToken,
  resolveCaretToken,
  resolveSelectionToken,
  scanBasicLine,
} from "../src/editor/tokens";
import { content, locales } from "../src/i18n";
import { tables } from "../src/locales/tables";

const code = [
  "INK 6",
  "CIRCLE 128,96,30",
  "FOR N = 1 TO 3",
  "  PLOT N,N",
  "NEXT N",
  "R = RND(1,6)",
  "REM CIRCLE in a comment",
  'TEXT 1,1,"CIRCLE in a string"',
  'CAT = SPAWN("cat",70,120)',
  "CAT.MOVE_BY 2,0",
  "IF 5 >= 3 AND 2 <> 4 OR NOT FALSE THEN",
  '  PRINT "OK"',
  "END IF",
].join("\n");

function lineStart(index: number) {
  return code.split("\n").slice(0, index).join("\n").length + (index ? 1 : 0);
}

function select(line: number, text: string, offset = 0) {
  const start = lineStart(line) + code.split("\n")[line].indexOf(text);
  return resolveSelectionToken(
    code,
    start + offset,
    start + offset + text.length,
  );
}

function hit(line: number, text: string) {
  return select(line, text);
}

describe("tolerant BASIC tokenizer", () => {
  it("marks strings and comments so lookalike words are inert", () => {
    expect(scanBasicLine('TEXT 1,1,"CIRCLE"').map((t) => t.kind)).toContain(
      "string",
    );
    expect(scanBasicLine("REM CIRCLE")[0]).toMatchObject({
      kind: "comment",
      text: "REM CIRCLE",
    });
    expect(scanBasicLine("' CIRCLE")[0].kind).toBe("comment");
    expect(scanBasicLine("REMIX 1")[0]).toMatchObject({
      kind: "word",
      text: "REMIX",
    });
    expect(scanBasicLine("A >= 3").map((t) => t.text)).toEqual([
      "A",
      ">=",
      "3",
    ]);
    expect(scanBasicLine("CAT.MOVE_BY 2,0").map((t) => t.text)).toEqual([
      "CAT",
      ".MOVE_BY",
      "2",
      ",",
      "0",
    ]);
  });
});

describe("selection resolution", () => {
  it.each([
    ["CIRCLE", 1, "CIRCLE"],
    ["FOR", 2, "FOR"],
    ["NEXT", 4, "NEXT"],
    ["RND", 5, "RND"],
    ["SPAWN", 8, "SPAWN"],
    ["MOVE_BY", 9, ".MOVE_BY"],
    ["AND", 10, "AND"],
    ["OR", 10, "OR"],
    ["NOT", 10, "NOT"],
    [">=", 10, ">="],
    ["END IF", 12, "END IF"],
  ])("resolves %s on line %i", (text, line, expected) => {
    expect(hit(line, text)?.token).toBe(expected);
  });

  it("expands part of a token and part of a compound operator", () => {
    expect(hit(1, "IRCL")?.token).toBe("CIRCLE");
    expect(hit(10, ">")?.token).toBe(">=");
    expect(hit(10, "=")?.token).toBe(">=");
  });

  it("resolves an object member even when the whole expression is selected", () => {
    expect(hit(9, "CAT.MOVE_BY")?.token).toBe(".MOVE_BY");
    expect(hit(9, "MOVE_BY")?.token).toBe(".MOVE_BY");
  });

  it("never resolves inside comments or strings", () => {
    expect(hit(6, "CIRCLE")).toBeNull();
    expect(hit(7, "CIRCLE")).toBeNull();
    expect(hit(7, '"CIRCLE in a string"')).toBeNull();
  });

  it("does not treat arbitrary identifiers or large ranges as spells", () => {
    expect(hit(1, "128")?.token).toBe("128");
    expect(lookupReference("128")).toBeUndefined();
    expect(
      resolveSelectionToken(code, lineStart(1), lineStart(5) + 3),
    ).toBeNull();
    expect(normalizeToken("myCircle")).toBe("MYCIRCLE");
    expect(lookupReference("MYCIRCLE")).toBeUndefined();
    const expression = "PRINT CAT.X";
    expect(resolveSelectionToken(expression, 0, expression.length)).toBeNull();
  });

  it("resolves the caret token for keyboard help", () => {
    const circle = lineStart(1) + "CIRCLE".length;
    expect(resolveCaretToken(code, circle)?.token).toBe("CIRCLE");
    const comment = lineStart(6) + 8;
    expect(resolveCaretToken(code, comment)).toBeNull();
    const operator = lineStart(10) + "IF 5 ".length + 1;
    expect(resolveCaretToken(code, operator)?.token).toBe(">=");
  });
});

describe("reference registry", () => {
  it("covers every runtime command, function, method and sprite property", () => {
    for (const command of commands)
      expect(lookupReference(command), command).toBeDefined();
    for (const fn of functions) expect(lookupReference(fn), fn).toBeDefined();
    for (const method of methods)
      expect(lookupReference("." + method), method).toBeDefined();
    for (const property of ["X", "Y", "WIDTH", "HEIGHT", "VISIBLE", "ALIVE"])
      expect(lookupReference("." + property), property).toBeDefined();
  });

  it("maps every token to a real Spellbook entry and a usable syntax", () => {
    const ids = new Set(spells.map((spell) => spell.id));
    const keys = new Set<string>();
    for (const entry of referenceEntries) {
      expect(keys.has(entry.key), entry.key).toBe(false);
      keys.add(entry.key);
      expect(ids.has(entry.spellId), `${entry.key} -> ${entry.spellId}`).toBe(
        true,
      );
      const spell = spells.find((candidate) => candidate.id === entry.spellId)!;
      expect(entry.syntax ?? spell.syntax).toBeTruthy();
    }
  });

  it("uses the Spellbook prose and examples as the single source", () => {
    const expectations: Array<[string, string, ReferenceKind, string]> = [
      ["CIRCLE", "circle", "command", "CIRCLE x,y,radius"],
      [
        "FOR",
        "for",
        "keyword",
        "FOR name = start TO end [STEP amount] … NEXT name",
      ],
      ["RND", "rnd-random", "function", "RND(min,max)"],
      ["SPAWN", "spawn", "function", 'TOY = SPAWN("kind",x,y)'],
      [".MOVE_BY", "move-by", "method", "TOY.MOVE_BY dx,dy"],
      ["AND", "and-or-not", "keyword", "condition AND condition"],
      [">=", "comparisons", "operator", "a >= b"],
    ];
    for (const [token, spellId, kind, syntax] of expectations) {
      const entry = lookupReference(token)!;
      expect(entry.spellId).toBe(spellId);
      expect(entry.kind).toBe(kind);
      const spell = spells.find((candidate) => candidate.id === spellId)!;
      const card = buildReferenceCard(entry, spells)!;
      expect(card.syntax).toBe(syntax);
      expect(card.spell.summary).toBe(spell.summary);
      expect(card.spell.code).toContain(token);
    }
  });

  it("keeps operator examples runnable and specific to every operator", () => {
    const comparisons = spells.find((spell) => spell.id === "comparisons")!;
    for (const operator of ["=", "<>", "<", ">", "<=", ">="])
      expect(comparisons.code, operator).toContain(operator);
    const arithmetic = spells.find((spell) => spell.id === "arithmetic")!;
    for (const operator of ["+", "-", "*", "/"])
      expect(arithmetic.code, operator).toContain(operator);
    const boolean = spells.find((spell) => spell.id === "and-or-not")!;
    for (const operator of ["AND", "OR", "NOT"])
      expect(boolean.code, operator).toContain(operator);
  });

  it("returns null instead of inventing a card for an unknown Spellbook id", () => {
    expect(
      buildReferenceCard(
        { key: "NOPE", spellId: "missing", kind: "command" },
        spells,
      ),
    ).toBeNull();
  });
});

describe("localized inline reference", () => {
  it.each(locales)(
    "$id: acceptance tokens resolve to translated Spellbook content",
    ({ id }) => {
      const localized = content("spells", spells, id);
      for (const token of [
        "CIRCLE",
        "FOR",
        "RND",
        "SPAWN",
        ".MOVE_BY",
        "AND",
        ">=",
      ]) {
        const entry = lookupReference(token)!;
        const card = buildReferenceCard(entry, localized)!;
        expect(card.spell.summary.length).toBeGreaterThan(0);
        expect(card.spell.name.length).toBeGreaterThan(0);
        expect(card.spell.code.length).toBeGreaterThan(0);
        const expected = tables[id][`spell.${entry.spellId}.summary`];
        if (id !== "en") expect(card.spell.summary).toBe(expected);
      }
    },
  );

  it("keeps BASIC syntax and operator tokens untranslated", () => {
    for (const { id } of locales) {
      const localized = content("spells", spells, id);
      const card = buildReferenceCard(lookupReference(">=")!, localized)!;
      expect(card.syntax).toBe("a >= b");
      expect(card.key).toBe(">=");
      const and = buildReferenceCard(lookupReference("AND")!, localized)!;
      expect(and.spell.code).toContain("AND");
    }
  });
});
