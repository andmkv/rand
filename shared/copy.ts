import { en } from "../src/locales/en.js";
import { tables } from "../src/locales/tables.js";
import { isLocale } from "../src/locales/registry.js";
export function hostedCopy(
  key: string,
  locale = "en",
  params: Record<string, string | number> = {},
): string {
  const source = (en.hosted as Record<string, string>)[key] ?? key;
  const value = isLocale(locale)
    ? (tables[locale][`hosted.${key}`] ?? source)
    : source;
  return value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}
