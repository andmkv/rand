import ru from "./ru.imported.json" with { type: "json" };
import es from "./es.imported.json" with { type: "json" };
import fr from "./fr.imported.json" with { type: "json" };
import de from "./de.imported.json" with { type: "json" };
import srLatn from "./sr-Latn.imported.json" with { type: "json" };
import ja from "./ja.imported.json" with { type: "json" };
import uk from "./uk.imported.json" with { type: "json" };
import type { Locale } from "./registry.js";
export const tables: Record<Locale, Record<string, string>> = {
  en: {},
  ru,
  es,
  fr,
  de,
  "sr-Latn": srLatn,
  ja,
  uk,
};
