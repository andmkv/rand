import { assets } from "../src/runtime/assets.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectRows,
  encodeCsv,
  parseCsv,
  validateTranslations,
} from "./localization.mjs";
import {
  programStrings,
  translateProgram,
} from "../src/content/translation.ts";
test("deterministic coverage with stable keys, no BASIC or IDs as source rows", () => {
  const rows = collectRows();
  assert.deepEqual(rows, collectRows());
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
  for (const key of [
    "ui.sandbox",
    "ui.openFile",
    "ui.saveFile",
    "errors.importInvalid",
    "story.tower.scene.8.hint",
    "example.cards.tweak",
    "spell.loop-concept.description",
  ])
    assert.ok(
      rows.some((r) => r.key === key),
      key,
    );
  assert.ok(
    !rows.some((r) =>
      ["FOR", "CIRCLE", "SPAWN", "cat", "coin"].includes(r.source),
    ),
  );
  assert.ok(rows.every((r) => r.context && r.file && r.type));
});
test("UTF-8 CSV preserves multiline text, edge spaces, quotes, commas and Cyrillic", () => {
  const rows = [
    {
      key: "test",
      source: ' Привет, Даня! Živjo\n"Ćao" ',
      translation: ' Љубав, Єнот\n"Šuma" ',
      context: "context",
      type: "other",
      file: "file",
      notes: "notes",
    },
  ];
  assert.deepEqual(parseCsv(encodeCsv(rows)), rows);
  assert.equal(
    Buffer.from(encodeCsv(rows), "utf8").toString("utf8"),
    encodeCsv(rows),
  );
});
test("strict translation import validates keys, duplicates, placeholders and source revision", () => {
  const rows = collectRows(),
    r = rows.find((r) => r.key === "ui.line");
  const good = encodeCsv([{ ...r, translation: "Строка {line}: {message}" }]);
  assert.equal(
    validateTranslations(good)["ui.line"],
    "Строка {line}: {message}",
  );
  for (const invalid of [
    [{ ...r, key: "oops" }],
    [r, r],
    [{ ...r, source: "changed" }],
    [{ ...r, translation: "Строка без параметров" }],
  ])
    assert.throws(() => validateTranslations(encodeCsv(invalid)));
});
test("human program strings translate without touching command names or machine IDs", () => {
  const code =
    'CAT=SPAWN("cat",1,2)\nSOUND "coin"\nPLAY "C4 E4"\nINPUT "Name?",NAME\nCAT.SAY "Hello, " + NAME';
  const words = programStrings(code);
  assert.deepEqual(
    words.map((w) => w.source),
    ["Name?", "Hello, "],
  );
  const changed = translateProgram(code, "demo", {
    "demo.string.0": "Как тебя зовут?",
    "demo.string.1": "Привет, ",
  });
  assert.ok(changed.includes('SPAWN("cat"'));
  assert.ok(changed.includes('SOUND "coin"'));
  assert.ok(changed.includes('INPUT "Как тебя зовут?"'));
  assert.ok(changed.includes('SAY "Привет, "'));
});

test("all manifest names/tags and game controls export without translating input or asset IDs", () => {
  const rows = collectRows();
  for (const asset of assets)
    for (const field of ["name", "tags"])
      assert.equal(
        rows.find((r) => r.key === `asset.${asset.id}.${field}`).source,
        asset[field],
      );
  for (const id of ["alien-attack", "brick-breaker", "pixel-quest"])
    assert.ok(rows.some((r) => r.key === `example.${id}.controls`));
  const code =
    'IF KEY("LEFT") THEN\nSFX "laser"\nEND IF\nKIND="brick_cyan"\nTEXT 10,10,"GO!"';
  assert.deepEqual(
    programStrings(code).map((word) => word.source),
    ["GO!"],
  );
  const changed = translateProgram(code, "game", {
    "game.string.0": "ВПЕРЁД!",
  });
  assert.ok(changed.includes('KEY("LEFT")'));
  assert.ok(changed.includes('KIND="brick_cyan"'));
  assert.ok(changed.includes('SFX "laser"'));
});

test("program translations must retain concatenation spaces", () => {
  const row = {
    key: "test.string.0",
    source: " Hello, ",
    translation: " Привет, ",
    context: "program",
    type: "other",
    file: "test",
    notes: "Keep edge spaces",
  };
  assert.equal(
    validateTranslations(encodeCsv([row]), [row])[row.key],
    row.translation,
  );
  for (const translation of ["Привет, ", " Привет,"])
    assert.throws(
      () => validateTranslations(encodeCsv([{ ...row, translation }]), [row]),
      /edge spaces/,
    );
});
