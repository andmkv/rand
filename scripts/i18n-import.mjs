import { translationLocales } from "../src/locales/registry.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { validateTranslations } from "./localization.mjs";
const [locale, file] = process.argv.slice(2);
if (!translationLocales.some((entry) => entry.id === locale) || !file)
  throw new Error(
    "Usage: npm run i18n:import -- <ru|es|fr|de|sr-Latn|ja|uk> path/to/locale.csv",
  );
const table = validateTranslations(readFileSync(file, "utf8"));
const target = new URL(
  `../src/locales/${locale}.imported.json`,
  import.meta.url,
);
writeFileSync(target, JSON.stringify(table, null, 2) + "\n", "utf8");
console.log(
  `Imported ${Object.keys(table).length} validated ${locale} translations. Missing/blank keys fall back to existing resources.`,
);
