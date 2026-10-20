# Decisions

## Animated sprite v1 (2026-10-19)

Animation extends the existing `sprite` payload as `AnimatedSpriteV1`; it does not introduce another asset table, upload path, manifest version, or `.randusr` version. `user_asset_versions.sprite` and project snapshots already store versioned JSONB recipes. The recipe shares dimensions, palette and transparency across 1–32 row-major indexed frames, with integer FPS 1–12 and an explicit loop flag. Static `IndexedSpriteV1` remains compatible and renders only one frame. Project revisions/publications pin the complete recipe; portable exports remove only private IDs.

Playback is time-based (`floor(elapsed * fps / 1000)`) with one shared `requestAnimationFrame` loop for visible animated objects. Global RUN starts it, STOP freezes current frames and RESET clears the scene. Background tabs suspend the loop; on visibility return the deterministic elapsed-time frame is selected. This avoids per-sprite timers and parser-language additions. Bounds are 131,072 frame-pixels per animation and project, 512 KiB manifest JSON and the existing 1 MiB `.randusr` ceiling. No migration is required because only existing JSONB payload values expand. Per-object play controls and any new asset type remain deferred.

## 2026-10-17 · Cards 22–23: hosted foundation

The live Backlog now explicitly asks for a full product. Its 22+ contract supersedes MVP-only account/backend/classroom exclusions while retaining the guest coding toy. This increment stops at contract and tested server/DB foundation; no placeholder cloud/gallery/classroom flows are presented as completed.

Initially use independent canLearn/canTeach booleans and a separate isAdmin flag; one dual-role account, no brittle role enum. Card 45 later removed the learning/teaching roles and kept only the admin flag. Admin never automatically acquires learning/teaching capabilities. DB prohibits an unverified administrator. Bootstrap is a verified-address-only idempotent transaction with audit, not an account/password seed. Normal owner APIs have no hidden admin bypass; admin overrides will live behind explicit audited APIs.

Use Fastify 5 (typed routing, JSON schemas and injectable HTTP tests), Drizzle with node-postgres (typed SQL plus reviewable forward migrations), PostgreSQL 17 (real multi-user database). References: [Fastify testing](https://fastify.dev/docs/latest/Guides/Testing/), [Drizzle migrations](https://orm.drizzle.team/docs/migrations). Preserve the existing Vite client and interpreter boundaries. No generic service framework or broad CRUD scaffolding.

Use one package lock and separate server compiler/output, so browser build does not import DB modules; production API installs runtime dependencies only. Drizzle Kit's transitive development-only esbuild was overridden to a patched compatible release; audit is clean. Generated migration SQL and journal stay committed; no schema push on live data.

Projects keep a canonical versioned JSON snapshot plus searchable metadata; revision/publication/class-submission FKs prevent cross-project/class reference mistakes. Tokens store hashes; source/title strings are not translated in the DB. Schema supports later feature services; each service still owns validation, retention and authorization.

HTTP identity comes from an opaque cookie hash looked up in PostgreSQL, never trusted role headers/localStorage. At this foundation step only session lookup existed; later cards added account creation, token issuance/rotation, CSRF for mutations and mail. Guest access provider fails closed for hosted permissions while keeping all local work available even when API is absent.

Real disposable Docker PostgreSQL tests exercise migrations and authorization through HTTP without accepting an external DATABASE_URL. Local Compose binds web/optional DB only to loopback, keeps DB persistent and applies migrations explicitly. Production TLS/Lightsail changes were completed later by card 38; see DEPLOYMENT.md.

## Cards 24–25: authentication and delivery

Keep optional account UI inside the existing editor; no registration wall or local-project reset. Use opaque DB-backed cookie sessions, Argon2id (64 MiB/3 iterations), conditional one-use token consumption and user-row locking. Login/refresh rotate; reset revokes all sessions. Exact canonical Origin plus a random HttpOnly double-submit CSRF cookie protects every API mutation; never store bearer tokens locally. No production mail credentials are inferred from other repositories.

Reuse the small Prodos Nodemailer transport pattern, with a private bounded file sink by default and explicit SMTP opt-in. Production refuses file mail and non-HTTPS canonical URLs. HTML and plain-text copy participate in the normal localization pipeline. Reset requests respond generically with a minimum duration; SMTP delivery runs independently in a bounded in-process set, drained on graceful close. This is not a durable queue; crashes can require resend. Token URL fragments avoid proxy-log leakage. Policies activate only when real document versions are configured.

## Card 26: profile privacy and preferences

Keep private account DTO separate from the minimal public ID/display-name serializer. No handle/biography/upload surface is needed. At that time profile writes accepted only display name, product role and locale; admin privilege/verification/email were never mutable there. Card 45 removed the product-role/classroom scope, so the current endpoint accepts display name and locale only. Password change verifies old hash under user lock, revokes sessions and outstanding resets. The account copy seeds a device once (account id + value are remembered locally), a changed server value is still applied on the next load, and a stale server copy can never undo a newer device choice — the Demo regression where RU flipped back to EN on Home. Local editing/language keeps working offline. Demo stores the choice in the ephemeral demo session (`PATCH /api/v1/demo/account`), so the same contract holds without a user row.

## IDEA 06 Stage A: compact inventory without fake asset sources

The drawer keeps its 520 px footprint and gains one inspector above a square-slot grid that reads only `src/runtime/assets.ts`; `src/inventory-model.ts` carries `source: "standard" | "mine" | "shared"` for IDEA 01 but the UI renders no personal or shared group until permission-checked data exists, so nothing looks selectable that is not. Selection, search and type filter live in module memory rather than React state lifted into `App.tsx`, so collapsing the drawer or switching Story/Sandbox keeps the working context with no new cross-component contract. Insert now goes through an imperative `insertRef` on the CodeMirror host: the snippet is placed at the caret on its own line, CODE is never replaced and a running SCREEN keeps running (the previous append-and-stop behaviour moved only for Inventory; Spellbook still appends). Escape clears a search first, otherwise closes and returns focus to the drawer handle; the drawer stays a plain `aside`, never a modal. Rejected: a virtualized grid (23 built-ins fit in four rows; revisit past a few hundred items), tabs for unavailable sources, and a second audio player inside the component (the existing `AudioToy` preview ref is reused with an explicit stop).

## IDEA 02 Stage A: one indexed sprite, no second asset format

The pixel editor edits the canonical `IndexedSpriteV1` directly instead of a private editor document that would need converting on save. Palette slot 0 is the transparent slot and slots 1–15 are Spectrum colours 0–15 (slot 8 is black), so a saved sprite renders through the existing `world.ts` path, the inventory thumbnail and an exported/bundled project with no UI-only colour model. Built-in sprites load into the editor by mapping their digits 0–7 (bright inks) to palette slots 8–15, which is exactly what the inventory preview already used. Resize keeps the drawing centred and asks first; undo is a bounded array of full sprite snapshots (≤40) rather than per-pixel deltas, because a 64×64 sprite is 4 KiB and correctness beats micro-optimisation here. Saving goes through IDEA 01's `SpriteEditorAdapter` and pins the exact payload into the project manifest; there is no local draft store, so a guest still cannot create assets and no throwaway library format can drift from the server contract. The editor is a native modal `<dialog>` so focus is contained and Escape goes through the discard guard; the inventory drawer underneath keeps its state. Rejected: an editor-only `pixels: string[]` format, a separate localStorage draft library, an alpha/multi-colour pipeline (arbitrary RGB), and building the animation timeline before static save/load/RUN/publish was proven.

## Card 28: immutable checkpoints

Keep meaningful debounced-save checkpoints, not keystrokes. Restore appends; it never updates an old snapshot. SQL trigger protects content while permitting only actor nulling for anonymization. Keep 50 ordinary/30-day revisions (latest always retained) plus FK-pinned publication/starter/submission/remix snapshots. Prune under the project lock atomically with saves. A history copy starts private and does not replace current local code. UI blocks restore while the active local program is not confirmed saved.

## Cards 29–41: publication, gallery, classroom, safety and operations

- Publication pins an explicit revision and is separate from the draft; unlisted and public viewers read only that snapshot. Remix copies it into a new private project. Admin block is audited and revokes guest access while preserving the owner's private source.
- Classroom features (32–33) were delivered as a capability-gated layer. They are now **legacy**: card 45 removes them with a data-preserving migration.
- Admin overrides use separate audited routes, never an implicit owner bypass. Reporting is private, idempotent and rate/quota bounded; moderation decisions remain in history.
- Account export and deletion share one lifecycle core; the last verified active administrator cannot be deleted; backups and provider mail remain governed by operator retention.
- Hosted security uses the permission matrix, CSRF/Origin checks, DB sessions, bounded schemas, rate limits and no-store headers. Per-process IP counters are a single-instance choice; horizontal scaling needs a shared limiter.
- Preview images use bounded PostgreSQL `bytea`, not a new object store; the server constructs PNGs from palette indices and never accepts arbitrary uploads.
- Analytics is optional and consent-gated; production fixes it off. Monitoring counters are operational, not product analytics.

## Card 45: guest + registered account + admin flag (implemented 2026-10-18)

The product has three states: **guest** (public pages, built-in assets, run/edit locally, no cloud save/publish/personal asset library), **ordinary registered account** (cloud projects, autosave, private/unlisted/public publishing, short links, remix, future personal assets) and a protected **admin flag** on an ordinary account. Teacher/student/both roles, classes, join codes, assignments, submissions, grading, related tables/APIs/UI/tests and school-specific copy were removed, not hidden. Migration `0009` copies each distinct legacy submission snapshot that was not already an owned project into a new ordinary private project before dropping the classroom tables and role columns; assignment metadata and feedback are not carried into the project. Existing accounts, projects, revisions, publications, verification and admin flags are preserved. Public signup remains closed until the operator separately approves launch policy.

## Card 46: email-first first-admin onboarding

The owner must not need SSH, a CLI, an invitation file or a token copied through chat. The only unauthenticated invitation trigger is `POST /api/v1/auth/bootstrap-invite`: it accepts no recipient, always targets the configured `ADMIN_BOOTSTRAP_EMAIL`, is CSRF/Origin checked and rate-limited, and becomes a no-op once a verified active admin exists. It sends the localized `invite` template with a **Create your account** link to `/invite#token=...`; tokens stay one-time, seven-day, hash-only and fragment-only. Resend revokes the prior unused invitation. The CLI/file flow remains only for additional operator-invited testers. Admin promotion stays inside the normal verification transaction; no SQL verification or default password is introduced.

## Card 44: agent handoff

Keep root `AGENTS.md` a compact index; detailed behavior stays in `docs/`. Never bake a static Trello card inventory into the repo; the board is live truth. Document MCP connectors without tokens, and use DSH's `insert:` patch shape for new MCP rows (a top-level row is an override). Tests that claim to be rendering-only must mock CSRF/limits rather than depend on a live harness; restart the disposable browser harness for each full run so fixture-created rows do not leak between runs.

## Demo Mode (UAT, 2026-10-18)

Do not implement a shared `demo` password by creating a real PostgreSQL account: every authorization check keys off `users.id`, so a known-password account would be a permanent backdoor into cloud, gallery, moderation and admin surfaces. Instead, demo is an in-process ephemeral store with its own cookie, router (`/api/v1/demo/*`) and principal whose id is `demo:<session>`. It reuses the real UI and DTO contracts but never receives the database handle, mailer or analytics; projects, revisions, previews, publication metadata and short codes live only in memory and are bounded by session/project/revision/byte caps. This guarantees demo data cannot enter a PostgreSQL backup and makes "restart destroys demo data" an explicit property. A separate cookie is required so entering demo does not overwrite an owner's production session; a readable marker cookie lets the SPA choose the API base before its first request. Temporary share links are served by a fallback in the production `/api/v1/shared/:code` route only when the code is absent from PostgreSQL; after logout/expiry a bounded in-memory tombstone answers `410 DEMO_EXPIRED` and the viewer shows a dedicated page. Remix is restricted to the owning demo session so links are view-only across sessions. Rejected: ephemeral rows in permanent tables (backup leak), a separate PostgreSQL schema/database (backup/ops coupling, migrations on every start) and per-session fake UI (diverges from real contracts).

## UAT round 2 (2026-10-18): decisions behind the "Tasks found by UAT" fixes

- **Protect the child's code with shared guards, not per-button prompts.** Everything that replaces CODE (Story "Load starter"/"Show example", the EXAMPLES drawer Load / Load & Run, Spellbook Load) goes through one `confirmReplace`: product-supplied code (any starter, example or spell, in English or the current locale) and an empty editor replace silently; anything else asks once and mentions Ctrl/⌘+Z. Switching Story chapters never asks: the child's own code is remembered per chapter in `randomize-usr.chapters.v1` (local-only; not part of the portable `.randusr` v2 format, so no schema change) and restored on return. Rejected: bumping the project format to carry per-chapter code, which would have touched cloud snapshots and the server validators.
- **Reset keeps the mode.** Story resets restart the story (confirm says so); Sandbox resets to a tiny starter and stays in Sandbox; New is always an empty Sandbox and says so.
- **Tab never deletes.** `insertTab`/`indentLess` from CodeMirror replace the hand-written `replaceSelection`.
- **Restore brings back code, not the title.** The server keeps the current title when it restores a revision (PostgreSQL and demo); the confirmation says so. History previews therefore need no title field. Revisions still get a new `restore` checkpoint.
- **Sharing must not re-open the project.** After a visibility/title change the editor calls `cloud.sync` (re-fetch the version, keep the running program and SCREEN) instead of `cloud.open`. The picture is only replaced when the child ticks "Use the current SCREEN"; the server additionally ignores an all-black frame, and the client refuses to capture a uniform frame for "Update preview".
- **Rename is inline.** `window.prompt` is unavailable in some embedded browsers and surfaced as a generic "connection unavailable" error. A linked project renames locally and lets autosave persist it (so the editor and library cannot disagree); other rows PUT directly.
- **Remix/Duplicate titles are chosen by the client** ("Remix of …", "Copy of …", localized, truncated to 120) because the server has no locale. Remix credit is dynamic (`remixedFrom` on `GET /projects/:id`, share info and the remix response) and degrades to "a project that is no longer shared" without naming a project that went private; a Remix starts with a copy of the published picture.
- **Demo links are expired for everybody.** `DemoStore.shared` looks the code up first and only then distinguishes tombstone (410) from never-existed (404). A foreign-session Remix returns `403 DEMO_FOREIGN_REMIX` and the DTO carries `remixable: false`.
- **One locale for the whole page.** `useLocale` is a tiny external store; before, each component kept its own copy, so the DEMO bar (mounted outside the editor) stayed English after a language switch. The store also remembers which account preference this device already applied, so arriving on a new route can no longer replace the language the person just picked with a stale session default (card 109: Demo RU → Home → EN). A language changed on another device is still applied because the server value then differs from the remembered one.
- **SCREEN scale is exact device pixels.** `src/layout.ts` picks the largest scale `k/devicePixelRatio` (k whole device pixels per SCREEN pixel, so 1.5×/2.5× are exact on 2× displays) that leaves room for CODE and the Story strip; `--px` drives canvas, bezel and grid columns. SCREEN and CODE sit side by side in Story and Sandbox (the Story text becomes a strip underneath; portrait tablets stack SCREEN, CODE, Story), so switching mode only adds or removes the strip. The header is a single row up to 1500 px with file actions, language and (when linked) Share/Update preview/History behind a **More** menu. Rejected: letting the canvas fill whatever space remains (fractional 2.398× pixels) and a three-column Story layout (empty space under SCREEN, narrow CODE).
- **Example thumbnails are pre-rendered.** `scripts/render-example-previews.mjs` runs each example in Chromium and commits `public/previews/examples/<id>.png`; a unit test fails if two examples share an image.
- **Spellbook summaries.** Each entry has a ≤12-word child-level `summary` (translated), the technical description and syntax sit under "More"; beginner entries (INK, PLOT, LINE, CIRCLE, TEXT, SOUND, FOR) come first.

## Card 108: UX redesign of the editor, examples and shared pages (2026-10-19)

Spec, audit and wireframes: [UX-REDESIGN.md](UX-REDESIGN.md).

- **One header at every width.** The 1500 px switch between a button row and a More menu is gone: brand, title (+ ⓘ Project info, save state), Story/Sandbox, one save-or-share action, a labelled **Project** menu and Account. Five always-visible controls instead of 7 (laptop) or 12–15 (wide). Rejected: hiding the mode switch in the menu (Story vs Sandbox must stay obvious) and an icon-only toolbar (unclear for beginners).
- **The machine owns RUN.** RUN/STOP/RESET sit in the SCREEN heading in the editor and on read-only pages, so a read-only page can make the code secondary without losing RUN. RUN is the only mint button; STOP/RESET are quiet. Ctrl/⌘+Enter still runs from CODE.
- **Instructions are said once.** In the editor they sit under SCREEN (two lines, full text in the tooltip); on `/examples/:id` and `/p/:code` they appear only in the info panel. The old line above CODE and the info box duplicate are removed.
- **Play-first read-only pages.** SCREEN on the left at the largest exact scale, title/meta/description/How to play/actions on the right, code underneath them, read-only. Secondary viewer actions (Edit original, Share, Report, Moderate) live in a More menu. Portrait windows stack SCREEN → info → code and scroll; the layout chooses whichever arrangement gives the larger SCREEN.
- **Project info is a dialog, not a toolbar button.** It edits the title now; the instructions textarea is wired to the card 107 contract (`Project.instructions`, `instructionsMax`) and appears when that lands. No frontend-only metadata was invented.
- **Menus keep dialogs alive.** `src/Menu.tsx` hides its panel with `visibility` so a dialog opened from a menu item (History, Share, Report) keeps rendering; Escape and outside clicks close it.
- **Age-neutral copy where policy is not involved.** Account dialog: "accounts are by invitation only" (new `closedTestAccount`); the Privacy page keeps `closedTestOnly` unchanged. Share hint no longer mentions school names. Invitation eligibility, Admin UI and Privacy/Terms are untouched (cards 106 and owner).
- **Home has two starts, not three.** The header "Open editor" link is removed; Start the story / Open sandbox remain.
- **Instructions have one source (card 107 integration).** UI reads only `project.instructions`; the example catalog seeds it once when a program is opened. A project opened before the field existed has empty instructions and shows no block rather than falling back to catalog text, so code and instructions never diverge silently. The owner's shared page leads with Edit my draft; copying actions move to More.

## Card 106: Admin Invitations UX (2026-10-19)

- **The invitation form owns its layout.** `src/Invitations.tsx` uses `.admin-invitations` / `.invite-*` classes scoped in `src/style.css` instead of borrowing `.admin-filters` + `.actions`; the email field is a full-width row, the eligibility checkbox a clickable label row, and the primary action sits on its own row (full-width below 560 px). This fixes the reported collision without touching the other admin filters or any global button/input rules.
- **Eligibility stays truthful and required.** The checkbox remains `required`, the server still rejects anything but `adultTester: true`, and the client now reads the checkbox instead of hard-coding `true`; the label became "I confirm the invitee is an adult". No age policy was relaxed or forged; broader age-neutral positioning stays with the UX card.
- **Compact panel, finished list.** Max width 760 px, 1 px edge and a mint top rule instead of a full-page mint border; status tabs are pressed buttons with a real `aria-label`; rows carry a status badge, sent/expiry dates and resend/revoke; the empty state is a bordered hint, loading is announced, and `MAIL_UNAVAILABLE` has invitation-specific copy. A new listing epoch prevents a slow previous-status response from overwriting the selected tab.
- **Screenshot evidence** lives in [ux-106](ux-106/README.md); the automated layout assertion stays English-only so the shared fixture administrator's saved language is never mutated by a test.

## IDEA 01 Stage A: pinned indexed sprites (2026-10-19)

- **Keep the project snapshot self-contained.** Personal asset records and immutable versions live in private PostgreSQL tables for registered accounts and per-session memory for Demo. A project binding copies the exact indexed pixels and pins its source version. Autosaves, history, restore and publication therefore carry a frozen payload, not a private URL or a live library pointer. This lets logged-out viewers run a published sprite and protects existing shares when the source library item changes.
- **Preserve `.randusr` v2 and old BASIC.** Add an optional versioned `assetManifest` field to v2; legacy snapshots remain valid. A string argument with `@alias` already parses through `SPAWN`, so the runtime resolves aliases from the project bundle while built-in names such as `cat` keep their current behavior.
- **Separate stable alias from display name.** Assign a unique lower-case `@slug` once, and leave it unchanged on rename. The prefixed namespace cannot collide with the built-in registry. Exported `.randusr` and anonymous published DTOs retain only portable data and remove private asset/version UUIDs.
- **Use a bounded indexed representation.** Pixel values index a local palette whose entries select one of the existing 16 runtime colors. One palette slot can be transparent; no arbitrary RGB, external URL, script or audio payload is accepted. `shared/assets.ts` owns shared validation and quotas; see [ASSETS.md](ASSETS.md).
- **Add storage forward-only.** Migration 0010 adds version and owner tables with an update-rejecting version trigger. It does not rewrite projects or delete rows. Production migration/deployment is a separate, owner-approved release; application rollback to 82e8c00 keeps the additive schema and volume.
- **Keep UI ownership separate.** The typed `SpriteEditorAdapter` is the seam for DeepSeek's Inventory/Pixel Editor work. Stage A supplies API, runtime and package behavior without editing those components; sound, animation and independent asset sharing remain Stage B.

## IDEA 08: Inline BASIC reference (2026-10-19)

Spec and evidence: [UX-INLINE-REFERENCE.md](UX-INLINE-REFERENCE.md).

- **Adapter, not a second documentation registry.** The Spellbook already carries stable entry IDs, localized summaries/descriptions/syntax and runnable examples. `src/content/reference.ts` only maps canonical tokens to those IDs and supplies an exact signature when one entry covers several forms (`a >= b`, `condition AND condition`). Rejected: hand-written popover copy or new operator entries with parallel prose, which would drift from the Spellbook and require a second translation set.
- **Tolerant scanner, not the parser.** The runtime parser deliberately rejects half-written code; help must work while a line is incomplete. `src/editor/tokens.ts` mirrors the lexer's string/comment/operator rules without throwing, preserves positions and expands partial selections. It is unit-tested against the acceptance tokens and against lookalikes in comments/strings.
- **Spellbook operator examples were extended, not duplicated.** `AND / OR / NOT`, `Arithmetic` and `Comparisons` gained BASIC lines that exercise every operator in the group, so an inline card can show a runnable, token-specific example without a separate help corpus. No string literals were added, so existing translations did not need re-keying.
- **Non-modal card with explicit focus.** Selection and hover open the card without stealing focus, so copy, selection and typing keep working. `F1` is the intentional keyboard path and focuses the close button; Tab/Shift+Tab then cycle the card's controls. This is explicit because WebKit's desktop/headless tab order skips buttons in a portal, while a document-level trap would break the editor's Tab indent if it applied globally.
- **The card is clamped to CODE.** Width/left are bounded by the editor's rect; height is clamped by the viewport and the card scrolls internally. It never adds body scroll. The selected line stays visible; in very short editors the card may cover SCREEN or the header rather than hiding the token.
- **Selection-only updates clear post-edit suppression.** A guard suppresses auto-help while a document transaction is being typed (Tab indent, autocomplete); a deliberate selection immediately afterwards clears that guard, so mouse/keyboard help is not delayed by an arbitrary timer.
- **Known ambiguity:** `=` opens the comparison card; assignment is taught by the `Variables` entry and `LET` maps to it. There is no sprite type inference, so member cards describe the member form and fall back to the Spellbook's generic object syntax.

## Card 115: reviewed forward-SQL migration workflow (2026-10-19)

- **Runtime history is SQL plus journal.** Drizzle ORM's migrator applies ordered SQL from `_journal.json`; it does not read Drizzle Kit snapshots. The journal/SQL are complete through 0010, but snapshots stop at 0005. The historical commits do not explain why snapshots stopped, so this decision formalizes the policy rather than retroactively claiming that omission was intentional.
- **Do not resolve ambiguous rename prompts.** With the 0005 snapshot copied to an isolated output directory, `drizzle-kit generate` asks whether `product_events` was created or renamed from one of five removed classroom tables. No selected rename is safe to infer from current `schema.ts`; do not create fake history or edit applied SQL to satisfy the generator.
- **Author new changes as reviewed forward SQL and a journal append.** `db:generate` now fails closed with the policy and instructions. `db:verify-schema` generates a temporary fresh reference catalog from `schema.ts`, applies the ordered SQL chain to disposable PostgreSQL, compares catalog objects and explicitly verifies SQL-only triggers. API integration tests prove fresh install, 0009→0010, repeated migration and preservation of account/project/publication revisions.
- **Retain historical storage contracts.** The 0007 CHECK allowed classroom-era event strings that remain in existing `product_events` rows. Current API types do not emit them. Keep the storage constraint represented in the typed schema and avoid a cleanup migration that could reject existing data.
- **No production access.** These checks use disposable PostgreSQL only. Before 0010 deployment, independently confirm current release/source, applied journal, protected backup and restore proof; follow [MIGRATIONS.md](MIGRATIONS.md). No down migration or production DB change is authorized by this decision.


## IDEA 02 Stage B: animation timeline (card 120, 2026-10-19)

Spec: [UX-PIXEL-ANIMATION.md](UX-PIXEL-ANIMATION.md). Evidence: [QA-120.md](QA-120.md).

- **A local draft type, not a second asset format.** `AnimationDraftV1` keeps
  `IndexedSpriteV1` frames in memory with shared dimensions/palette/transparency, so
  every existing tool, thumbnail and PNG export works on a frame without a parallel
  renderer. At the persistence boundary `toAnimatedSpriteV1` mirrors the published
  canonical contract byte-for-byte and `spriteAssetFromDraft` keeps a one-frame sprite
  in the unchanged static format. Rejected: storing frames inside the editor's own
  JSON or localStorage ("no local draft database" from Stage A) and saving frame 1 as
  a static fallback for a multi-frame drawing.
- **Progressive disclosure over a permanent timeline.** One frame renders the exact
  Stage A layout plus a single footer button (**+ Animate**) that adds a copy of the
  current drawing and reveals the timeline; deleting back to one frame collapses it.
  Rejected: an always-visible timeline (clutters a static sprite) and a separate
  animation editor route (duplicates tools and save paths).
- **"Add frame" copies, "Duplicate" copies, blank is explicit.** The friendly first
  step must not throw the drawing away, so adding a frame starts from the current
  drawing (Piskel-like) and an empty frame is a deliberate action. The timeline names
  both, so nobody has to discover the difference by losing work.
- **One document snapshot per user action.** History stores frames + fps + loop +
  selection, bounded by both 60 entries and 1.5 M pixels. A stroke, a frame move or a
  resize is one entry. Rejected: per-frame undo stacks, which would make undo
  ambiguous after a frame is deleted or reordered.
- **Onion skin is a canvas overlay, never data.** Ghosts are drawn under the current
  frame with fixed warm/cool tints at 42% alpha; `frames` is never mutated, so no
  saved, exported or runtime pixel can contain a ghost. Wrapping at the ends follows
  the Loop toggle so the overlay matches what Play shows, and the overlay is hidden
  during playback.
- **A single, cancellable preview timer.** One `setTimeout` chain steps exactly one
  frame per `1000 / fps` ms and is cancelled on pause, close, save, hidden tab, locale
  change, frame-count change and unmount. Rejected: `setInterval`, per-frame timers
  or CSS animation, which cannot guarantee the visible frame and the stopped state
  agree.
- **The persistence seam stays closed on this branch.** `shared/assets.ts` and
  `server/*` are the runtime track's ownership; base `2c9b259` accepts only
  `IndexedSpriteV1`. The adapter therefore reports `available: false` and the editor
  refuses multi-frame Save with a visible localized explanation. `createAnimationAssetAdapter`
  is implemented and unit-tested against the canonical create/version calls so the
  integrated-QA branch can enable it without touching the editor.

## Animated sprite integration (card 121, 2026-10-19)

- The runtime/server track owns the only serialized format: `SpriteAssetV1` in
  `shared/assets.ts`. The editor keeps a bounded `AnimationDraftV1` in memory, but
  conversion, validation and persistence use the shared `AnimatedSpriteV1`.
- The timeline saves through `SpriteEditorAdapter.create` and `saveVersion`; the
  returned full asset is bound into the current project so a cloud save, revision,
  `.randusr` export and publication pin the exact selected pixels and settings.
  Reopening a library asset restores every canonical frame. One frame remains on the
  unchanged `IndexedSpriteV1` path.
- Rejected: a second UI-only server shape or a frame-zero fallback. Animation uses
  the same private sprite routes and existing JSONB columns; no database migration
  or production data change is required.

## Sound engine and user recipes v1 (card 123, 2026-10-20)

- **One synthesis engine and two data recipes.** `SfxRecipeV1` describes a bounded
  one-shot with start/end pitch and duration; `PitchedInstrumentV1` describes a
  reusable voice whose note pitch/duration come from BASIC or a future tracker.
  They share waveform, pulse width, noise mix, volume and ADSR. No samples, scripts
  or generated JavaScript enter project data.
- **Schedule in WebAudio; keep no queue.** `SoundEngine` creates oscillator/noise
  sources and schedules envelope/pitch automation against `AudioContext.currentTime`.
  Eight voices and 32 launches per rolling second bound polyphony and event history;
  saturated calls are dropped. Preview and BASIC share the synthesizer but use owner
  tags for targeted Preview Stop. Global STOP/RESET cancels all active voices. Nodes
  disconnect on `ended` or immediate stop.
- **Cache only small synthesis artifacts.** One deterministic noise buffer is shared
  per audio context. Pulse waves use a 16-entry LRU because a pulse-width control or
  long BASIC program can otherwise create an unbounded series of `PeriodicWave`
  objects after audio nodes are cleaned up.
- **Embed immutable pins.** Private SFX/Instrument versions share the existing asset
  JSONB version storage and account quotas. Cloud/Demo snapshots pin the exact recipe;
  public and `.randusr` data keep recipe and stable alias but drop library IDs. The DB
  type check extension is reviewed migration 0011; production is unchanged.
- **Preserve the old commands.** `SOUND "laser"`, BEEP, NOTE and PLAY continue through
  the same engine. `SOUND "@alias"` selects an SFX, while optional Instrument arguments
  on NOTE/PLAY reuse one recipe at multiple pitches. No tracker keyword or scheduler
  is introduced.
## Explicit mode intent outranks a late cloud restore (card 126, 2026-10-20)

- `?project=<id>` is restored only after the session check, so the editor is
  interactive while the project request is still pending. The snapshot used to be
  applied wholesale, including `mode`, after the child had already clicked STORY.
  The versioned `ModeIntent` in `src/mode-intent.ts` makes the explicit choice win:
  an opened project keeps its code, title, instructions, chapter and progress, while
  `mode` follows the newer intent.
- A deep link passes `intentSince = 0` (any explicit choice since the editor opened
  wins over the automatic restore); a deliberate My Projects/History open uses the
  default "clicked after this request started", so opening a project still restores
  the mode stored in that project.
- Rejected: clearing storage, cancelling the open, or a full reset. Those lose the
  opened project or the prior Sandbox program. Also rejected: keeping the cloud link
  signature as the adopted snapshot; then the chosen mode would silently diverge
  from the cloud copy. The stored signature is kept so the normal autosave persists
  the explicit mode, with the existing version-conflict recovery.
- Sandbox `Reset project` (#89) is untouched: it still stays in Sandbox and never
  loads the Tower starter.

## Handbook (card 51, 2026-10-20)

- **Plain Markdown files in `book/<locale>/`, one file per chapter**, not React pages, MDX or a PDF. Contributors edit text and the diff is readable. A tiny purpose-built parser (`src/book/markdown.ts`, about 300 lines) renders a typed tree as React elements, so no HTML is injected and no dependency or build plugin was added. The same parser feeds the reader, search and the tests, so what is tested is exactly what is shown. Rejected: `marked`/`markdown-it` plus sanitising (a dependency and an injection surface for a closed vocabulary), MDX (executable content in a docs folder), a generated PDF/ePub (not maintainable; the print view and one-file Markdown download cover offline use).
- **Examples are tests, not prose.** Every ```` ```basic ```` block carries an `id` and optional expectations and is executed against the real interpreter in CI (`tests/book.test.ts`); fragments must parse or be word-for-word quotes of a shipped game. Inventing syntax is impossible to publish.
- **The reference is generated from the same source of truth as the editor's inline help.** The gate ties `engine.ts` → `reference.ts` → `book/*/ref-*.md`, so adding or removing a command fails CI until the reference changes.
- **English and Russian are complete; other locales fall back to English honestly.** Interface strings of the reader (`src/book/ui.ts`) are translated for all eight locales and tested for completeness; the content falls back per chapter with a visible notice on every page and an "EN" mark in the contents. Explicit heading ids (`{#id}`) are required where pages link and on reference pages so anchors are identical across languages. Rejected: machine translating the remaining six languages (unreviewed text presented as localisation).
- **Open in Sandbox never silently replaces work.** If the local project differs from the starter project, a Story starter or a built-in example, a modal offers *Save current project as a file*, *Replace and open* and *Cancel* (Escape cancels); otherwise it opens directly. Examples that need pictures or sounds name a bundle in `book/assets/*.json`; the bundle is written into the project's `assetManifest`, so the example runs for guests exactly as shown. Rejected: a separate scratch project slot (the editor has one local project by design).
- **Baseline.** Written against runtime `84bb1e7` (SFX/Sound Lab, animated sprites, user assets, inline reference); the three unmerged game examples and the Music Tracker are intentionally absent. The book states `HIT`'s default 16×16 box for custom sprites until `SIZE` is called, because that is what the runtime does.

## Structured programming: EXIT, SUB/CALL, SET, MIN/MAX/INT/MOD (2026-10-20)

- **Why now.** Game loops could only end with STOP, long programs repeated code (restart blocks, platform generators) and lists were append-only, so the first real games (UAT Hoppy Hobby) had to fake arrays with `X1,X2,X3` variables and duplicate blocks. The additions are the smallest set that removes those walls while keeping the language readable for children.
- **`SUB name … END SUB` / `CALL name` without parameters or return values.** Variables are already global, so a SUB is a named block that shares them. Parameters, locals and `FUNCTION`s were rejected for now: they need scoping, a call stack of environments and new error cases, and children can pass values through variables. Rejected also: `GOSUB`/`RETURN` with line labels (needs line numbers or labels, makes flow harder to read and to parse into the existing block AST).
- **SUBs are top-level only and hoisted.** The engine collects them before running, so a `CALL` may come before its `SUB`, and an unknown or duplicate name fails before anything draws (with the usual did-you-mean hint). Depth is capped at 32 and uses the existing `limit` message, so recursion cannot hang or exhaust the browser; every statement inside still passes `checkpoint()`, so STOP works.
- **`EXIT DO/FOR/SUB` as a flow signal, not an exception.** `execute()` returns `"DO" | "FOR" | "SUB" | undefined` and every block passes an unmatched signal upwards, so an `EXIT DO` inside a `FOR` inside a `DO` leaves the `DO`. The parser tracks what it is inside and rejects an `EXIT` without a matching block (per SUB) before running, which also makes it impossible to leave a SUB through the caller's loops. `WHILE`, `BREAK`, `CONTINUE` and `EXIT` with a label were not added.
- **`SET list,index,value` instead of `LIST(i) = v`.** `PUSH` is already a command with the list first; a statement starting `NAME(` would be ambiguous with commands called with a bracketed first argument (`INK (1)`), and the parser does not know command names. `SET` cannot grow a list (use `PUSH`), keeps the flat-list and 128-item limits and the shared-by-reference semantics.
- **`MIN`, `MAX`, `INT`, `MOD`.** `INT` is a floor (`INT(-0.5)` is −1, like classic Spectrum BASIC). `MOD` is both an operator (`7 MOD 3`, precedence of `*` and `/`) and a function (`MOD(7,3)`), and uses a floored remainder so wrapping animations (`X MOD 8` for negative `X`) never goes negative. Zero divisor is the existing `zero` error.
- **Compatibility.** Old programs may use these words as variable names; `EXIT`, `SUB` and `CALL` are only keywords when they start a statement that is not an assignment, `SET` is a command only when not assigned to, and `MIN/MAX/INT/MOD` are functions only when followed by `(` (`MOD` is an operator only between two values, never as a quoted string). Published revisions keep running. New names were added to the editor highlighting/autocomplete, the inline reference, the Spellbook (seven translations) and book reference pages (English and Russian); `tests/language-structure.test.ts` covers all of it.
- **Examples.** Only where it teaches something real: FIREWORKS uses two SUBs, NUMBER WIZARD stops asking after a right guess with `EXIT FOR`, ALIEN ATTACK computes the alien grid with `MOD` and `INT`. Other games keep their shipped code, because handbook chapters quote them word for word.
