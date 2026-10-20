# QA — Handbook (card 51, "Complete Randomize USR handbook and tested BASIC reference")

The Handbook is checked against the BASIC runtime and built-in content in this source snapshot. It covers shipped functionality only; in-progress game projects are excluded, and the postponed Music Tracker appears only on the "Not available yet" page. This source snapshot has not been deployed.

## What shipped

| Item | Where |
| --- | --- |
| Public reader at `/book`, `/book/<chapter>`, `/book/print` (no account, no API) | `src/Book.tsx`, `src/book.css`, `src/book/*` |
| 30 pages: 17 teaching chapters, 13 reference/support pages | `book/en/*.md` (≈28,900 words), `book/ru/*.md` (≈25,700 words) |
| Chapter order, part titles, version/date/build | `book/toc.json` |
| Sample pictures and sounds that examples carry into Sandbox | `book/assets/workshop.json` (original art, sounds `@zap`, `@pluck`) |
| Contributor guide, example test attributes, translation process | `book/README.md` |
| Entry points | Home header link and hero button; **Handbook ↗** link at the top of the Spellbook drawer |
| Gates | `tests/book.test.ts` (`npm run book:check`, part of `npm test`), `tests/e2e/book.spec.ts` |

Contents: **I Meet the machine** (getting started, first picture, shapes and text, variables, loops, decisions) · **II Living worlds** (sprites, motion, lists, sound) · **III Make games** (keyboard, collisions and score, STAR CATCHER built in four runnable steps, reading the three shipped games) · **IV Your own pictures and sounds** (pixel editor with animation, Sound Lab) · **V Projects and sharing** (autosave/`.randusr`/cloud, History, Demo, sharing, Remix, safety) · **VI Reference** (language, drawing, time and input, sprites, lists, numbers, sound, built-in assets, error messages and limits, troubleshooting, glossary, challenges, not available yet).

## Hard acceptance

| # | Requirement | Result |
| --- | --- | --- |
| 1 | Extract-and-execute every tagged BASIC example on the exact HEAD, bounded loops, expected state | 150 `basic` blocks per language (142 complete programs + 8 fragments) run on the real `Engine`/`World` with fake timers. Checks: `output`, `px` (displayed palette colour), `sprites`, `vars`, `events`, `error`, `input`, `keys`. Endless programs run a bounded simulated time and must stop with `stopped`, leaving no timers. Fragments must parse or be word-for-word quotes of a shipped game. The two sample-asset examples load `book/assets/workshop.json` (validated by `assertProjectAssetManifest`) |
| 2 | Fresh Guest follows chapters 1–6, opens a sample in Sandbox without losing unsaved work, copies, reads at 390/820, keyboard, no broken anchors | `book.spec.ts`: beginner path with Next links; copy writes the exact code; **Open in Sandbox** opens directly only when the local project is a starter/example/empty, otherwise a modal (Save current project as a file / Replace and open / Cancel, Escape cancels) — cancel and escape leave `localStorage` byte-identical; 390 and 820 px have no horizontal overflow on 8 representative pages and contents collapse behind a button; every internal link and anchor in both languages resolves |
| 3 | Accurate 256×192, indexed sprites/sounds, pinning, Demo limits, registered access, publishing | Chapters 15–17 and `ref-assets`; Demo is described as temporary, not an account; sharing is a pinned snapshot; only shipped baseline content is described |
| 4 | Reference tracks the source of truth; CI fails on undocumented/stale commands | All 77 tokens of `src/content/reference.ts` (itself asserted equal to `engine.ts`) plus `INPUT`/`REM` have a heading in `ref-*.md` in English and Russian; a stale heading also fails. All 19 built-in sprites and 8 sounds must appear on `ref-assets` |
| 5 | Editable Markdown and contribution instructions; README link only after the build is verified | `book/README.md`; README links the book (typecheck, tests and build pass) |

## Commands and results

| Command | Result |
| --- | --- |
| `npm run book:check` | 371 tests pass (structure for 60 pages, 142 programs + 8 fragments ×2 languages, reference, honesty, UI strings) |
| `npm run typecheck` | pass (client and server projects) |
| `npm test` | 27 files, 788 tests pass; localization CSV tests pass; `i18n:check` 1034/1034 keys in all seven locales |
| `npm run build` | pass; the reader and each chapter are separate lazy chunks (reader 33 kB / 10 kB gzip, chapters 7–14 kB each) |
| `npx playwright test tests/e2e/book.spec.ts` (Chromium, WebKit, 820 px tablet) | 44 passed, 1 skipped (link-integrity run is Chromium-only by design) |
| Existing guest suites touched by the home/Spellbook change: `home`, `layout`, `locales`, `locale-navigation`, `app`, `inline-reference`, `access` (Chromium) | pass; one `inline-reference` Russian test failed once under 3 parallel workers (`html lang` after reload) and passed on 2 isolated reruns; it does not load the new code |
| `npm run api:test` | not run: no server, schema or deploy file was changed (Docker-backed) |

## What was checked by eye

Desktop (800 and 1440 px), phone 390×844 and tablet 820×1180 in the in-app browser and Playwright screenshots (`test-results/book-phone.png`, `book-tablet.png`): header, search, contents toggle, code blocks with syntax colours, callouts, tables, Russian reference page. Reading text uses the system font (Handjet only for the brand mark), 17–18 px with 1.65 line height, code blocks scroll inside their own box, buttons are at least 44 px tall.

Accessibility measures: skip link; focus moves to the chapter heading (or the requested section) on load and never steals focus from the search box; landmarks (banner, search, navigation, main), one `h1` per page, `aria-current` in the contents, `aria-expanded` on the contents toggle, `role="status"` on search results and copy feedback, native `<dialog>` with the safe button focused and Escape to cancel, keyboard-focusable scrollable code and tables, `lang` set per page (English fallback pages declare `en`), reduced motion respected (nothing animates), print styles (white, no chrome, hints opened, code wrapped).

## Translation coverage (honest)

- **English**: 30/30 pages. **Russian**: 30/30 pages, same example ids and anchors (gate-enforced); printed strings in beginner chapters are Russian, game HUD text stays English like the shipped games.
- **es, fr, de, sr-Latn, ja, uk**: reader interface (buttons, search, notices, callout labels) fully translated and gate-tested; **book text 0/30 — shown in English** with a notice on every page, `lang="en"`, an "EN" mark in the contents and a "N of 30 chapters available" line on the home page. No page is presented as translated when it is not. New languages are added chapter by chapter (see `book/README.md`).
- Russian terminology follows the app's own strings (ЭКРАН, КОД, ▶ ЗАПУСК, …). It has not had a native-reviewer pass beyond the author's own proofreading.

## Known limits

- Independent quick audit of the language, drawing, timing/input, sprites and sound reference against `src/runtime/language.ts`, `src/runtime/engine.ts`, `src/runtime/world.ts`, `src/runtime/audio.ts` and the shared asset validators found no factual mismatch. The executable-example gate proves examples run and match declared results; it does not prove that every explanation is complete.
- The reader is not a documentation site generator: no versioned back-editions, no per-heading search index beyond section text, no PDF/ePub (print view and one-file Markdown download instead).
- Speaker quality of the sound examples is not asserted (the harness proves they are scheduled within the runtime's limits).
- Chapter text describes the baseline SHA. If a later build changes behaviour, the gate will fail for commands, assets, and examples; narrative text (UI labels, sharing flow) still needs a human read.
- WebKit does not tab to buttons by default, so the dialog focus-trap assertion runs in Chromium; the dialog opens, cancels and replaces correctly in WebKit.
