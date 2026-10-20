import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { collectRows, encodeCsv } from "./localization.mjs";
const rows = collectRows();
mkdirSync(new URL("../localization/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../localization/en.csv", import.meta.url),
  encodeCsv(rows),
  "utf8",
);
console.log(
  `Exported ${rows.length} stable keys to localization/en.csv (UTF-8, BOM, RFC 4180).`,
);
const app = ["App.tsx", "Inventory.tsx"]
  .map((file) =>
    readFileSync(new URL("../src/" + file, import.meta.url), "utf8"),
  )
  .join("\n");
const hardcoded = [...app.matchAll(/>\s*([A-Za-z][A-Za-z !?.,]{3,})\s*</g)]
  // A TS arrow return type such as `() => Promise<void>` also resembles a JSX
  // text node to this deliberately small heuristic. Only skip that syntax form.
  .filter((m) => app[m.index - 1] !== "=")
  .map((m) => m[1]);
if (hardcoded.length)
  throw new Error("Review hardcoded JSX copy: " + hardcoded.join("; "));
console.log("JSX copy check: no obvious literal UI text outside resources.");
