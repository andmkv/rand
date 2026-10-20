/** Client-side full-text search over the loaded chapters (no server, works offline once loaded). */
import { blocksText, type Block } from "./markdown";
import type { Chapter } from "./content";

export interface Hit {
  slug: string;
  id: string;
  chapter: string;
  heading: string;
  before: string;
  match: string;
  after: string;
  score: number;
}
interface Section {
  slug: string;
  id: string;
  chapter: string;
  heading: string;
  text: string;
  lower: string;
}
const indexes = new WeakMap<Chapter[], Section[]>();

function sectionsOf(chapters: Chapter[]): Section[] {
  const cached = indexes.get(chapters);
  if (cached) return cached;
  const out: Section[] = [];
  for (const c of chapters) {
    let id = "";
    let heading = c.title;
    let group: Block[] = [];
    const flush = () => {
      const text = (heading + "\n" + blocksText(group)).replace(/\s+/g, " ").trim();
      if (text) out.push({ slug: c.slug, id, chapter: c.title, heading, text, lower: text.toLowerCase() });
      group = [];
    };
    for (const b of c.doc.blocks) {
      if (b.t === "heading" && b.level <= 3) {
        if (b.level > 1) {
          flush();
          id = b.id;
          heading = b.text;
        }
      } else group.push(b);
    }
    flush();
  }
  indexes.set(chapters, out);
  return out;
}

export function searchBook(chapters: Chapter[], query: string, limit = 30): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const s of sectionsOf(chapters)) {
    if (!words.every((w) => s.lower.includes(w))) continue;
    const head = (s.chapter + " " + s.heading).toLowerCase();
    let score = 0;
    for (const w of words) {
      score += head.includes(w) ? 8 : 0;
      score += Math.min(5, s.lower.split(w).length - 1);
    }
    const at = Math.max(0, s.lower.indexOf(words[0]));
    const start = Math.max(0, at - 50);
    hits.push({
      slug: s.slug,
      id: s.id,
      chapter: s.chapter,
      heading: s.heading,
      before: (start > 0 ? "…" : "") + s.text.slice(start, at),
      match: s.text.slice(at, at + words[0].length),
      after: s.text.slice(at + words[0].length, at + words[0].length + 90) + (s.text.length > at + 90 ? "…" : ""),
      score,
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
