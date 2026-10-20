/**
 * Handbook gate (`npm run book:check`, also part of `npm test`).
 *
 * 1. Structure   – every chapter in book/toc.json exists in English and Russian, has front matter,
 *                  unique heading ids, and only working internal links.
 * 2. Execution   – every ```basic block is extracted from the Markdown, run on the real Engine +
 *                  World, and its declared expectations (output, pixels, sprites, variables, error)
 *                  are asserted. Endless programs are simulated for a bounded time, then STOPped.
 *                  ```basic fragment blocks must at least parse, or be an exact quote of a shipped game.
 * 3. Reference   – every token the runtime knows has a heading in the reference pages and vice versa.
 * 4. Honesty     – no unshipped games, and no Music Tracker lesson.
 *
 * The attribute syntax is documented in book/README.md.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine, commands, functions, methods } from "../src/runtime/engine";
import { World } from "../src/runtime/world";
import { parse } from "../src/runtime/language";
import { games } from "../src/content/games";
import { examples } from "../src/content/examples";
import { referenceEntries } from "../src/content/reference";
import { assets } from "../src/runtime/assets";
import { assertProjectAssetManifest, type ProjectAssetManifestV1 } from "../shared/assets";
import {
  bookLinks,
  codeBlocks,
  headings,
  parseDocument,
  type Doc,
} from "../src/book/markdown";
import { bookUi, bookUiLocales } from "../src/book/ui";
import { locales } from "../src/locales/registry";

const root = join(__dirname, "..", "book");
const toc = JSON.parse(readFileSync(join(root, "toc.json"), "utf8")) as {
  parts: { id: string; chapters: string[] }[];
};
const slugs = toc.parts.flatMap((p) => p.chapters);
const contentLocales = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "assets")
  .map((d) => d.name);

function files(locale: string) {
  return readdirSync(join(root, locale))
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ slug: f.replace(/^\d+-/, "").replace(/\.md$/, ""), file: f }));
}
const docs = new Map<string, Doc>();
function load(locale: string, slug: string): Doc | undefined {
  const key = `${locale}/${slug}`;
  if (!docs.has(key)) {
    const entry = files(locale).find((f) => f.slug === slug);
    if (!entry) return undefined;
    docs.set(key, parseDocument(readFileSync(join(root, locale, entry.file), "utf8")));
  }
  return docs.get(key);
}

afterEach(() => vi.useRealTimers());

function manifest(name: string): ProjectAssetManifestV1 {
  const value = JSON.parse(readFileSync(join(root, "assets", `${name}.json`), "utf8"));
  assertProjectAssetManifest(value);
  return value;
}

describe("structure", () => {
  it("lists every chapter once and ships English and Russian in full", () => {
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(contentLocales).toContain("en");
    expect(contentLocales).toContain("ru");
    for (const locale of contentLocales) {
      const have = files(locale).map((f) => f.slug);
      expect(have.filter((s) => !slugs.includes(s)), `${locale} has chapters not in toc.json`).toEqual([]);
      if (locale === "en" || locale === "ru")
        expect(slugs.filter((s) => !have.includes(s)), `${locale} misses chapters`).toEqual([]);
    }
    for (const locale of contentLocales)
      expect(locales.some((l) => l.id === locale), `unknown locale folder ${locale}`).toBe(true);
  });

  it.each(contentLocales.flatMap((l) => files(l).map((f) => [l, f.slug] as const)))(
    "%s/%s has front matter, unique ids and working links",
    (locale, slug) => {
      const doc = load(locale, slug)!;
      expect(doc.meta.summary, "summary").toBeTruthy();
      const ids = headings(doc.blocks).map((h) => h.id);
      expect(new Set(ids).size, "duplicate heading ids").toBe(ids.length);
      const h1 = headings(doc.blocks).filter((h) => h.level === 1);
      expect(h1.length, "exactly one # title").toBe(1);
      expect(doc.blocks[0], "the # title comes first").toBe(h1[0]);
      for (const href of bookLinks(doc.blocks)) {
        if (href.startsWith("#")) {
          expect(ids, `${href} in ${locale}/${slug}`).toContain(href.slice(1));
        } else if (href.startsWith("/book/")) {
          const [target, anchor] = href.slice(6).split("#");
          if (!target || target === "print") continue;
          expect(slugs, `chapter ${target} (${locale}/${slug})`).toContain(target);
          if (anchor) {
            // Anchors must exist in the same language when that language has the page, else in English.
            const other = load(locale, target) ?? load("en", target)!;
            expect(
              headings(other.blocks).map((h) => h.id),
              `${href} in ${locale}/${slug}`,
            ).toContain(anchor);
          }
        }
      }
    },
  );

  it("keeps the same runnable example ids in English and Russian", () => {
    const ids = (locale: string) =>
      slugs
        .flatMap((s) => codeBlocks(load(locale, s)?.blocks ?? []))
        .filter((b) => b.lang === "basic")
        .map((b) => String(b.attrs.id))
        .sort();
    expect(ids("ru")).toEqual(ids("en"));
    const all = ids("en");
    expect(new Set(all).size, "example ids must be unique").toBe(all.length);
    for (const slug of slugs) {
      // Headings with an explicit {#id} are the stable anchors; they must exist in both languages.
      const sig = (locale: string) =>
        headings(load(locale, slug)!.blocks)
          .filter((h) => h.explicit)
          .map((h) => h.id)
          .join(",");
      expect(sig("ru"), `explicit heading ids differ between en and ru in ${slug}`).toBe(sig("en"));
    }
  });

  it("ships valid sample asset bundles, and every assets= names one", () => {
    const names = readdirSync(join(root, "assets")).map((f) => f.replace(/\.json$/, ""));
    for (const name of names) expect(() => manifest(name), name).not.toThrow();
    for (const locale of contentLocales)
      for (const slug of slugs)
        for (const b of codeBlocks(load(locale, slug)?.blocks ?? []))
          if (typeof b.attrs.assets === "string")
            expect(names, `${locale}/${slug}:${b.line}`).toContain(b.attrs.assets);
  });

  it("labels every code fence", () => {
    for (const locale of contentLocales)
      for (const slug of slugs) {
        const doc = load(locale, slug);
        if (!doc) continue;
        for (const b of codeBlocks(doc.blocks)) {
          expect(["basic", "text", "json", "sh", "md"], `${locale}/${slug}:${b.line}`).toContain(b.lang);
          if (b.lang === "basic") expect(b.attrs.id, `${locale}/${slug}:${b.line} needs id=`).toBeTruthy();
        }
      }
  });
});

interface Sim {
  output: string[];
  world: World;
  engine: Engine;
  error?: { code: string };
  finished: boolean;
}
async function simulate(code: string, attrs: Record<string, string | true>): Promise<Sim> {
  vi.useFakeTimers();
  const world = new World();
  const output: string[] = [];
  world.onPrint = (text) => output.push(text);
  const answers = typeof attrs.input === "string" ? attrs.input.split("|") : [];
  world.ask = async () => answers.shift() ?? "";
  if (typeof attrs.assets === "string") world.setProjectAssets(manifest(attrs.assets));
  const engine = new Engine(world);
  const sim: Sim = { output, world, engine, finished: false };
  const running = engine.run(code);
  // run() resets the world synchronously (which releases keys), so hold the keys afterwards.
  if (typeof attrs.keys === "string") for (const k of attrs.keys.split(",")) world.keys.add(k.trim());
  const done = running.then(
    () => {
      sim.finished = true;
    },
    (error) => {
      sim.finished = true;
      sim.error = error;
    },
  );
  const seconds = attrs.endless ? Number(attrs.wait ?? 8) : 130;
  for (let s = 0; s < seconds && !sim.finished; s++) await vi.advanceTimersByTimeAsync(1000);
  (sim as Sim & { done: Promise<void> }).done = done;
  return sim;
}
function shown(world: World, x: number, y: number) {
  const v = world.pixels[y * 256 + x];
  return v ? v - 1 : world.paper + world.bright * 8;
}
function compare(actual: number, op: string, expected: number) {
  return { "=": actual === expected, ">": actual > expected, "<": actual < expected, ">=": actual >= expected, "<=": actual <= expected }[op];
}

const runnable = contentLocales.flatMap((locale) =>
  slugs.flatMap((slug) =>
    codeBlocks(load(locale, slug)?.blocks ?? [])
      .filter((b) => b.lang === "basic")
      .map((b) => ({ locale, slug, block: b, name: `${locale}/${slug} ${b.attrs.id}` })),
  ),
);

describe("basic examples run on the real engine", () => {
  it("finds examples", () => expect(runnable.length).toBeGreaterThan(40));

  const full = runnable.filter((r) => !r.block.attrs.fragment);
  it.each(full.map((r) => [r.name, r] as const))(
    "%s",
    async (_name, { block }) => {
      const a = block.attrs;
      const sim = await simulate(block.code, a);
      if (a.endless) {
        expect(sim.finished, "an endless program must still be running").toBe(false);
        expect(sim.engine.longRunning).toBe(true);
      } else if (a.error) {
        expect(sim.error?.code).toBe(String(a.error));
      } else {
        expect(sim.finished, "program did not finish in 130 simulated seconds").toBe(true);
        expect(sim.error, `error ${JSON.stringify(sim.error)}`).toBeUndefined();
      }
      if (typeof a.output === "string") expect(sim.output).toEqual(a.output.split("|"));
      if (typeof a.px === "string")
        for (const item of a.px.split(";")) {
          const m = /^(\d+),(\d+)=(\d+)$/.exec(item.trim());
          expect(m, `bad px= item ${item}`).toBeTruthy();
          expect(shown(sim.world, +m![1], +m![2]), `pixel ${item}`).toBe(+m![3]);
        }
      if (typeof a.sprites === "string")
        expect(sim.world.objects.filter((o) => o.alive).length).toBe(Number(a.sprites));
      if (typeof a.vars === "string")
        for (const item of a.vars.split(";")) {
          const m = /^([A-Z][A-Z0-9_]*)(>=|<=|=|>|<)(-?[\d.]+)$/.exec(item.trim());
          expect(m, `bad vars= item ${item}`).toBeTruthy();
          const value = sim.engine.variables.get(m![1]);
          expect(compare(Number(value), m![2], Number(m![3])), `${m![1]} is ${String(value)}, wanted ${item}`).toBe(true);
        }
      if (typeof a.events === "string")
        for (const event of a.events.split(","))
          expect(sim.world.eventCounts.get(event.trim()) ?? 0, `event ${event}`).toBeGreaterThan(0);
      if (a.endless) {
        sim.engine.stop();
        await (sim as Sim & { done: Promise<void> }).done;
        expect(sim.error?.code).toBe("stopped");
        expect(vi.getTimerCount()).toBe(0);
      }
    },
    30000,
  );

  const fragments = runnable.filter((r) => r.block.attrs.fragment);
  it.each(fragments.map((r) => [r.name, r] as const))("fragment %s", (_name, { block }) => {
    const quote = block.attrs.quote;
    if (typeof quote === "string") {
      const game = games.find((g) => g.id === quote) ?? examples.find((e) => e.id === quote);
      expect(game, `unknown game ${quote}`).toBeTruthy();
      const flat = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
      expect(flat(game!.code), "quoted lines are not in the shipped source").toContain(flat(block.code));
    } else {
      expect(() => parse(block.code)).not.toThrow();
    }
  });
});

describe("reference covers the runtime", () => {
  const extras = ["INPUT", "REM"];
  const expected = new Set([...referenceEntries.map((e) => e.key), ...extras]);
  for (const locale of ["en", "ru"]) {
    it(`${locale}: every runtime token has a heading, and no heading is stale`, () => {
      const documented = new Set<string>();
      for (const entry of files(locale).filter((f) => f.slug.startsWith("ref-"))) {
        const doc = load(locale, entry.slug)!;
        for (const h of headings(doc.blocks))
          for (const node of h.c) if (node.t === "code") documented.add(node.v);
      }
      expect([...expected].filter((t) => !documented.has(t)), "undocumented").toEqual([]);
      expect([...documented].filter((t) => !expected.has(t)), "documented but unknown to the runtime").toEqual([]);
    });
  }
  it("also checks the raw engine lists", () => {
    const tokens = new Set(referenceEntries.map((e) => e.key));
    for (const c of commands) expect(tokens.has(c), c).toBe(true);
    for (const f of functions) expect(tokens.has(f), f).toBe(true);
    for (const m of methods) expect(tokens.has("." + m), m).toBe(true);
  });
  it("names every built-in sprite and sound on the assets page", () => {
    const text = JSON.stringify(load("en", "ref-assets")!.blocks);
    for (const a of assets) expect(text, a.id).toContain(`"${a.id}"`);
  });
});

describe("honesty", () => {
  it("does not describe unshipped games or the Music Tracker as available", () => {
    for (const locale of contentLocales)
      for (const slug of slugs) {
        const raw = existsSync(join(root, locale))
          ? JSON.stringify(load(locale, slug)?.blocks ?? [])
          : "";
        if (slug !== "roadmap") expect(raw, `${locale}/${slug}`).not.toMatch(/tracker|трекер/i);
      }
  });
});

describe("reader interface strings", () => {
  it("are complete for every locale", () => {
    expect(bookUiLocales).toEqual(locales.map((l) => l.id));
    const keys = Object.keys(bookUi.en).sort();
    for (const locale of bookUiLocales) {
      expect(Object.keys(bookUi[locale]).sort(), locale).toEqual(keys);
      for (const key of keys) expect((bookUi[locale] as Record<string, string>)[key].trim(), `${locale}.${key}`).not.toBe("");
    }
  });
});
