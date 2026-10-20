/**
 * Loads the Handbook from `book/<locale>/NN-slug.md`.
 *
 * `book/toc.json` fixes the chapter order. A locale that lacks a chapter falls back to English for
 * that chapter, and the reader says so; nothing is silently shown as translated.
 */
import toc from "../../book/toc.json";
import type { Locale } from "../locales/registry";
import type { ProjectAssetManifestV1 } from "../../shared/assets";
import { headings, parseDocument, type Doc } from "./markdown";

const raw = import.meta.glob("../../book/*/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const manifests = import.meta.glob("../../book/assets/*.json", {
  eager: true,
  import: "default",
}) as Record<string, ProjectAssetManifestV1>;

/** Sample pictures and sounds that ship with the book, by file name without `.json`. */
export function bookAssets(name: string): ProjectAssetManifestV1 | undefined {
  const key = Object.keys(manifests).find((path) => path.endsWith(`/${name}.json`));
  return key ? manifests[key] : undefined;
}

export interface Chapter {
  slug: string;
  part: string;
  /** Position in the book, starting at 1 (the number readers see). */
  number: number;
  /** Language the text is actually written in. */
  language: string;
  fallback: boolean;
  title: string;
  summary: string;
  doc: Doc;
  source: string;
}

export const bookInfo = {
  version: toc.version,
  updated: toc.updated,
  build: toc.build,
};
export const partIds = toc.parts.map((p) => p.id);
export function partTitle(id: string, locale: string): string {
  const part = toc.parts.find((p) => p.id === id);
  const titles = (part?.title ?? {}) as Record<string, string>;
  return titles[locale] ?? titles.en ?? id;
}
export function documentTitle(doc: Doc): string | undefined {
  return headings(doc.blocks).find((h) => h.level === 1)?.text;
}
export const order: { slug: string; part: string }[] = toc.parts.flatMap((p) =>
  p.chapters.map((slug) => ({ slug, part: p.id })),
);

function entry(locale: string, slug: string) {
  const suffix = new RegExp(`/book/${locale}/(\\d+-)?${slug}\\.md$`);
  return Object.entries(raw).find(([path]) => suffix.test(path));
}

/** Locales that have at least one translated chapter. */
export function writtenLocales(): string[] {
  return [...new Set(Object.keys(raw).map((p) => /\/book\/([^/]+)\//.exec(p)![1]))];
}

export function translatedCount(locale: string): number {
  return order.filter((c) => entry(locale, c.slug)).length;
}

const cache = new Map<string, Promise<Chapter[]>>();

/** Every chapter in book order, for one interface locale. */
export function loadBook(locale: Locale): Promise<Chapter[]> {
  let promise = cache.get(locale);
  if (!promise) {
    promise = Promise.all(
      order.map(async ({ slug, part }, index): Promise<Chapter> => {
        const own = entry(locale, slug);
        const found = own ?? entry("en", slug);
        if (!found) throw new Error(`Missing chapter ${slug}`);
        const source = await found[1]();
        const doc = parseDocument(source);
        return {
          slug,
          part,
          number: index + 1,
          language: own ? locale : "en",
          fallback: !own && locale !== "en",
          title: documentTitle(doc) ?? slug,
          summary: doc.meta.summary ?? "",
          doc,
          source,
        };
      }),
    );
    promise.catch(() => cache.delete(locale));
    cache.set(locale, promise);
  }
  return promise;
}
