// Native language names stay recognizable regardless of the selected UI language.
export const locales = [
  { id: "en", name: "English" },
  { id: "ru", name: "Русский" },
  { id: "es", name: "Español" },
  { id: "fr", name: "Français" },
  { id: "de", name: "Deutsch" },
  { id: "sr-Latn", name: "Srpski (latinica)" },
  { id: "ja", name: "日本語" },
  { id: "uk", name: "Українська" },
] as const;
export type Locale = (typeof locales)[number]["id"];
export const translationLocales = locales.filter(
  (locale) => locale.id !== "en",
);
export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale.id === value);
}
