import { readFileSync } from "node:fs";
import {
  collectRows,
  parseCsv,
  validateTranslations,
} from "./localization.mjs";
import { translationLocales } from "../src/locales/registry.ts";
const rows = collectRows();
// These are brand/legal copy, native language names, BASIC syntax, onomatopoeia,
// genuine cognates, or an internationally used unit abbreviation (FPS).
const common = [
  "ui.brand",
  "ui.brandCopyright",
  "ui.russian",
  "ui.animationFps",
  "spell.comments.search",
  "hosted.demoBadge",
];
const same = {
  ru: [],
  es: ["errorValues.color%20(0%E2%80%937)", "ui.spriteZoom"],
  fr: [
    "ui.slGraphVolume",
    "ui.slKindInstrument",
    "ui.slLabel_decay",
    "ui.slLabel_release",
    "ui.slLabel_sustain",
    "ui.slLabel_volume",
    "ui.slOctave",
    "ui.slPresetExplosion",
    "ui.slPresetLaser",
    "ui.slWaveTriangle",
    "hosted.adminInvitations",
    "asset.dynamite.name",
    "asset.explosion.name",
    "example.alien-attack.code.string.1",
    "example.brick-breaker.code.string.1",
    "spell.print.search",
    "spell.rnd-random.search",
    "spell.wait.search",
    "ui.animationPause",
    "ui.code",
    "ui.mode",
    "ui.sprites",
    "ui.spriteTransparent",
    "ui.spriteZoom",
    "ui.standardAssets",
    "ui.toolRect",
  ],
  de: [
    "ui.slKindInstrument",
    "ui.slLabel_attack",
    "ui.slLabel_decay",
    "ui.slLabel_release",
    "ui.slLabel_sustain",
    "ui.slPresetExplosion",
    "ui.slPresetLaser",
    "ui.slPresetPowerup",
    "ui.slPresetWind",
    "asset.ball.name",
    "asset.explosion.name",
    "example.robot.code.string.0",
    "ui.animationPause",
    "ui.code",
    "ui.spriteTransparent",
    "ui.spriteZoom",
    "ui.standardAssets",
  ],
  "sr-Latn": [
    "ui.slKindInstrument",
    "ui.slPresetLaser",
    "ui.slStop",],
  ja: [],
  uk: [],
};
for (const { id } of translationLocales) {
  const csv = readFileSync(
    new URL(`../localization/${id}.csv`, import.meta.url),
    "utf8",
  );
  const validated = validateTranslations(csv, rows);
  const bundled = JSON.parse(
    readFileSync(
      new URL(`../src/locales/${id}.imported.json`, import.meta.url),
      "utf8",
    ),
  );
  if (JSON.stringify(validated) !== JSON.stringify(bundled))
    throw Error(`${id}: CSV and bundled locale differ; run i18n:import`);
  const allowed = new Set([...common, ...same[id]]);
  for (const row of rows) {
    const value = validated[row.key];
    if (!value?.trim()) throw Error(`${id}: missing/blank ${row.key}`);
    if (
      id === "sr-Latn" &&
      row.key !== "ui.russian" &&
      /\p{Script=Cyrillic}/u.test(value)
    )
      throw Error(`${id}: use Latin script for ${row.key}`);
    if (value === row.source && !allowed.has(row.key))
      throw Error(`${id}: untranslated ${row.key}`);
    if (
      /\.string\.\d+$/.test(row.key) &&
      ((row.source.startsWith(" ") && !value.startsWith(" ")) ||
        (row.source.endsWith(" ") && !value.endsWith(" ")))
    )
      throw Error(`${id}: lost literal spacing ${row.key}`);
  }
  if (parseCsv(csv).length !== rows.length)
    throw Error(`${id}: incomplete CSV`);
  console.log(
    `${id}: ${rows.length}/${rows.length} current keys, no missing/blank/stale translations`,
  );
}
