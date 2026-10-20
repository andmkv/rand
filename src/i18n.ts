import { translateProgram, type CopyTable } from "./content/translation";
import { examples, type Example } from "./content/examples";
import type { Spell } from "./content/spellbook";
import type { Scene } from "./content/story";
import { tables } from "./locales/tables";
export { locales, isLocale } from "./locales/registry";
import type { Locale } from "./locales/registry";
export type { Locale } from "./locales/registry";
import { en } from "./locales/en";
// English fallback protects user projects; shipped locale coverage is checked in CI.
export function t(key: keyof typeof en, locale: Locale = "en"): string {
  return String(tables[locale]["ui." + key] ?? en[key]);
}
export function message(
  code: string,
  params: Record<string, unknown> = {},
  locale: Locale = "en",
): string {
  const template =
    tables[locale]["errors." + code] ??
    en.errors[code as keyof typeof en.errors] ??
    en.errors.internal;
  if (code === "unknown")
    params = {
      ...params,
      hint: params.suggestion
        ? message("suggest", { value: params.suggestion }, locale)
        : "",
    };
  if (["expected", "range"].includes(code)) {
    const k = String(params.value) as keyof typeof en.errorValues;
    params = {
      ...params,
      value:
        tables[locale]["errorValues." + encodeURIComponent(k)] ??
        en.errorValues[k] ??
        params.value,
    };
  }
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}
export function exampleInstructions(id: string, locale: Locale): string {
  return (
    content("examples", examples, locale).find((example) => example.id === id)
      ?.controls ?? ""
  );
}

export function content<T>(key: string, english: T, locale: Locale): T {
  if (locale === "en") return english;
  const base = english;
  const imported: CopyTable = tables[locale];
  const text = (key: string, value: string) => imported[key] ?? value;
  if (key === "storyTitle")
    return text("story.tower.title", base as string) as T;
  if (key === "examples")
    return (base as Example[]).map((ex) => {
      const p = `example.${ex.id}`;
      return {
        ...ex,
        title: text(p + ".title", ex.title),
        description: text(p + ".description", ex.description),
        tweak: text(p + ".tweak", ex.tweak),
        controls: ex.controls ? text(p + ".controls", ex.controls) : undefined,
        code: translateProgram(ex.code, p + ".code", imported),
      };
    }) as T;
  if (key === "spells")
    return (base as Spell[]).map((spell) => {
      const p = `spell.${spell.id}`;
      return {
        ...spell,
        name: text(p + ".name", spell.name),
        description: text(p + ".description", spell.description),
        summary: text(p + ".summary", spell.summary),
        tags: spell.tags + " " + (imported[p + ".search"] ?? ""),
        code: translateProgram(spell.code, p + ".code", imported),
      };
    }) as T;
  if (key === "scenes")
    return (base as Scene[]).map((scene) => {
      const p = `story.tower.scene.${scene.id}`;
      return {
        ...scene,
        title: text(p + ".title", scene.title),
        paragraphs: scene.paragraphs.map((v, i) =>
          text(p + ".paragraph." + i, v),
        ),
        hint: text(p + ".hint", scene.hint),
        starter: translateProgram(scene.starter, p + ".starter", imported),
        example: translateProgram(scene.example, p + ".example", imported),
      };
    }) as T;
  return (typeof base === "string" ? text(key, base) : base) as T;
}
