# The Randomize USR Handbook — how to contribute

The handbook is a real book: 17 teaching chapters, a complete BASIC reference, troubleshooting, a glossary and challenges. It is public at `/book` (no account needed), written in plain Markdown files in this folder, and **every BASIC program in it is executed by the test suite** against the real interpreter.

It is written against the runtime of build `84bb1e7` ("Integrate Sound Lab with shared audio engine"). The version, date and build are in [`toc.json`](toc.json) and are shown on the book's home page.

```text
book/
  toc.json              order of chapters, part titles per language, version, date, build
  en/NN-slug.md         English (complete, the source of truth)
  ru/NN-slug.md         Russian (complete)
  assets/NAME.json      sample sprites and sounds that examples can bring into Sandbox
  README.md             this file
```

Reader code: `src/Book.tsx` (page), `src/book.css`, `src/book/markdown.ts` (parser), `src/book/content.ts` (loading and fallback), `src/book/search.ts`, `src/book/sandbox.ts` (safe "Open in Sandbox"), `src/book/ui.ts` (interface strings for all eight locales). Tests: `tests/book.test.ts` (content gate) and `tests/e2e/book.spec.ts` (browser).

## Commands

```sh
npm run book:check        # the content gate: structure, links, every example, reference coverage (fast)
npm test                  # includes the gate
npm run dev               # then open http://localhost:5173/book
npx playwright test tests/e2e/book.spec.ts   # browser tests against the dev server (guest only, no API needed)
```

## Writing a chapter

1. Add `book/en/NN-slug.md` and list `slug` in `toc.json` under a part. `NN` is only for sorting files; the slug is what the URL uses (`/book/slug`).
2. Start with front matter and a single `#` title:

   ```markdown
   ---
   summary: One sentence that appears under the title and on the book's home page.
   ---

   # Title of the chapter
   ```

3. Teach in this shape: **goal** → a 5–25 line program that runs → a short explanation → a "change it" exercise with hints and answers in `<details>` → a "What you learned" list → a link to the next chapter. Never invent syntax or output. If you are not sure what a command does, run it.
4. Write the Russian version in `book/ru/` with the same slug, the same `id`s on code blocks and the same explicit heading anchors (see below). Other languages: see "Translations".
5. Run `npm run book:check`. Then read the page at `/book/slug` on a desktop and at 390 px width.

### Markdown you can use

Headings `##`–`####`, paragraphs, lists (nested), tables, `**bold**`, `*italic*`, `` `code` ``, links, horizontal rules, fenced code, GitHub alerts (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!IMPORTANT]`) and `<details><summary>…</summary> … </details>` (leave a blank line after `</summary>`). Raw HTML, images and embedded scripts are not supported; the page is built from a parsed tree and never injects HTML.

**Links.** Between chapters use `[text](book:slug)` or `[text](book:slug#anchor)`. In the same page use `[text](#anchor)`. External links start with `https://`. The gate fails on a missing chapter or anchor.

**Anchors.** Every heading gets an anchor made from its text. Anchors that other pages link to, and every heading on the reference pages, must be written explicitly, so they are identical in every language: `### `CIRCLE` {#cmd-circle}`.

### Code blocks

Everything that is BASIC is written as ```` ```basic ```` with attributes after the word. There are three kinds of fenced block:

| Fence | Meaning |
| --- | --- |
| ```` ```basic id=… ```` | A complete program. It is run by the gate, shown with **Copy** and **Open in Sandbox**. |
| ```` ```basic id=… fragment ```` | A piece of a program. It must at least parse; it has **Copy** only. |
| ```` ```basic id=… fragment quote=GAME ```` | A word-for-word excerpt of a shipped game or example (`alien-attack`, `brick-breaker`, `pixel-quest`, or an example id). The gate checks that the lines occur in that program, so the book cannot drift from the code. |
| ```` ```text ````, ```` ```json ````, ```` ```sh ````, ```` ```md ```` | Anything that is not BASIC. A fence with no language fails the gate. |

`id` is required and unique in the whole book; the English and Russian versions of an example must use the same id.

### Test attributes

The gate runs the program on the real `Engine` and `World` with a controllable clock. A program without `DO` must finish (within 130 simulated seconds). Add attributes to check what it did:

| Attribute | Example | Checks |
| --- | --- | --- |
| `output="a\|b"` | `output="14\|20"` | The exact lines of `PRINT`, joined with `\|`. |
| `px="x,y=c;…"` | `px="128,96=14"` | The colour shown at a SCREEN pixel, as a palette number 0–15 (`BRIGHT` shade included; unpainted pixels show the paper). Black drawn with `INK 0` is palette 0. |
| `sprites=N` | `sprites=2` | Number of living sprites at the end. |
| `vars="NAME op n;…"` | `vars="SCORE>=1;LIVES=3"` | Numeric variables at the end (`=`, `<`, `>`, `<=`, `>=`). |
| `events=A,B` | `events=TEXT,SFX` | Commands that ran at least once (`SPAWN:cat` for a sprite). |
| `error=code` | `error=limit` | The program must fail with this error code (see the error reference). |
| `input="a\|b"` | `input="Mia\|4"` | Answers for `INPUT`, in order. |
| `keys=A,B` | `keys=LEFT,SPACE` | Keys held down from the start. |
| `endless` | `endless wait=5` | A `DO … LOOP` program: it must still be running after `wait` simulated seconds (default 8), and STOP must end it with `stopped`. Required for any program that contains `DO`. |
| `assets=NAME` | `assets=workshop` | Loads `book/assets/NAME.json` (sample sprites and sounds) and passes it to **Open in Sandbox**. |
| `title="…"` | | Project title used by **Open in Sandbox** (default: the chapter title). |

Use checks that are deterministic. Random programs get range checks (`vars="X>=1;X<=6"`), not exact values.

## The reference stays in step with the runtime

`src/content/reference.ts` already lists every command, function, method, property, keyword and operator, and `tests/reference.test.ts` keeps that list equal to `src/runtime/engine.ts`. `tests/book.test.ts` goes one step further: **every token on that list needs a heading in the reference pages (`ref-*.md`) in English and in Russian, and every token in a heading there must exist in the runtime.** So:

- Adding a command to the interpreter fails the book gate until the command has a reference section with an example.
- Removing or renaming one fails it until the page is updated.
- A reference heading holds the token in code, e.g. `### `FOR` `NEXT` `STEP` `TO` {#kw-for}`. One section may cover several tokens.

When you change anything the book describes (the language, built-in sprites and sounds in `src/runtime/assets.ts`, the editor, the pixel editor or Sound Lab, projects and sharing), update the matching chapters in the same change. Built-in sprites and sounds are also checked: all of them must appear in `ref-assets.md`.

## Translations and honest fallback

English and Russian are written in full, and the gate requires both to stay complete. The other six interface languages (`es`, `fr`, `de`, `sr-Latn`, `ja`, `uk`) have **translated reader interface strings** (`src/book/ui.ts`, tested for completeness) but show the English text for the content, with a notice on every page and an "EN" mark in the contents. The reader never presents untranslated pages as translated.

To add a language:

1. Create `book/<locale>/` (the folder name is the locale id from `src/locales/registry.ts`).
2. Translate chapters one by one. A missing chapter simply keeps falling back to English; a translated chapter must keep the same slug, the same code block ids and the same explicit heading anchors. Add the language to the part titles in `toc.json`.
3. Translate printed strings (`PRINT "Hello"`) if you like, and update `output=` to match; never translate commands, asset ids or key names.
4. Run `npm run book:check`. The home page reports how many chapters exist in the language.

Russian terms follow the app: ЭКРАН, КОД, ▶ ЗАПУСК, ■ СТОП, ↺ СБРОС, ИСТОРИЯ, Песочница, КНИГА ЗАКЛИНАНИЙ, ПРИМЕРЫ, ИНВЕНТАРЬ. Look them up in `src/locales/ru.imported.json`.

## Things the book must not do

- Describe a feature that is not shipped as available. The Music Tracker is postponed: the only mention allowed is the "not available yet" page (`roadmap`), and the gate fails if "tracker" appears elsewhere. Games that are not shipped in the Examples drawer are not described either.
- Contain screenshots that will go stale, copied artwork, or text from other books. All examples and the sample bundle are original.
- Teach commands that do not exist (`ELSE IF`, `WHILE`, `GOTO`, one-line `IF`…). Where such a thing is missing, say so and show the workaround.
- Publish secrets, account details or private URLs.

## How the reader works (short)

- `import.meta.glob` loads `book/*/*.md` as raw text. `content.ts` parses each page with `markdown.ts`, picks the reader's language or falls back to English per chapter.
- `Book.tsx` renders the parsed tree as React elements. Code blocks are highlighted with the editor's own tokenizer; **Open in Sandbox** (`sandbox.ts`) writes the example (and its `assets=` bundle) into the local project and opens `/create?mode=sandbox`, asking first if that would replace code the person wrote.
- `/book/print` renders every chapter for printing or "Save as PDF", with print styles; the book can also be downloaded as one Markdown file in the visitor's language. Neither needs a server.
- Search is client-side over the loaded pages.
