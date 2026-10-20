# User asset foundation

The personal asset library stores indexed sprites, static or animated. They are not upload URLs or executable programs. The API stores authored payloads and immutable versions; projects store the exact selected pixels/frames so they can run offline, in Demo, and for anonymous visitors.

## Contract

- `IndexedSpriteV1` is in `shared/assets.ts`. `pixels` is a row-major array whose entries index the local `palette`; palette entries select one of the existing 16 Spectrum colors. `transparentIndex` selects a transparent palette slot or is `null` for an opaque sprite.
- A saved asset has a stable UUID and a generated ASCII alias such as `@hero`. Aliases are unique per owner, use `^@[a-z][a-z0-9_-]{0,30}$`, and do not change when the display name is renamed. Built-in names remain unchanged and cannot collide with this namespace.
- `ProjectSnapshot.assetManifest` is optional, versioned, and absent on old projects. Each binding carries the embedded sprite payload plus the exact library asset/version IDs while it is in private cloud state. Project revisions and publication revisions capture the bundle at checkpoint time.
- Portable `.randusr` and anonymous published responses retain alias, display name, palette, dimensions, transparency and pixel indexes, but remove private library IDs. No private library endpoint or storage URL is reachable from a project viewer.

## Bounds

The shared limits in `assetLimits` are 64×64 / 4,096 pixels per frame; at most 16 palette entries; 32 frames and 131,072 frame-pixels per animation; 64 active assets per account; 100 versions per asset; 5 MiB of version payloads per account; and 16 sprites, 16,384 base pixels, 131,072 total frame-pixels and 512 KiB of manifest data per project. The existing `.randusr` file ceiling remains 1 MB. API JSON schemas bound the payload before route logic and shared validators enforce exact frame/pixel counts, palette references, unique aliases and byte/pixel totals.

The project manifest is capped below the file ceiling to leave space for source and metadata. The API process and Demo store retain their existing overall request/session memory bounds. The drawing UI is the separate pixel editor below; animation wraps the same indexed Spectrum pixels and never invents a second storage system.

## API and editor adapter

Registered, verified account routes live under `/api/v1/assets`; Demo mirrors them under `/api/v1/demo/assets` using session memory only:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/assets` | List private asset summaries and bounded thumbnails |
| `POST` | `/assets` | Create a private sprite and immutable version 1 |
| `GET` | `/assets/:id` | Load the latest sprite data |
| `GET` | `/assets/:id/versions/:number` | Load an exact immutable version |
| `PATCH` | `/assets/:id` | Rename without changing alias or pixel history |
| `POST` | `/assets/:id/versions` | Save a new immutable version with `baseVersion` conflict check |
| `DELETE` | `/assets/:id` | Archive from the library; bundled projects continue to work |

The UI contract is `SpriteEditorAdapter` in `shared/assets.ts`. `src/assets.ts` supplies the HTTP adapter, thumbnail data, project binding helper and BASIC snippet helper. Use `spriteSpawnSnippet(alias)` for valid code, currently `SPRITE = SPAWN("@hero",80,120)`. Existing `SPAWN("cat",...)` and audio commands are unaffected.

The existing API error vocabulary covers unauthorized sessions, unverified accounts, malformed payloads, missing/foreign resources, stale versions and quotas: `AUTH_REQUIRED`, `EMAIL_UNVERIFIED`, `INVALID_INPUT`, `NOT_FOUND`, `VERSION_CONFLICT`, and `QUOTA_EXCEEDED`.

## Storage, Demo, migration and rollback

PostgreSQL tables `user_assets` and `user_asset_versions` are additive. Static and animated recipes share the existing `sprite` JSONB payload and immutable version table; no animation migration is required. Asset creation, version save, rename and archive write allowlisted audit events. The server locks the owner row for quota and alias allocation; ownership is checked from the cookie-backed account on every route. Version payloads are never updated in place. The version table's database trigger also rejects `UPDATE`.

Account NDJSON export includes each asset, including archived records, and every immutable version payload. Self-service and administrator account deletion erase the private library, immutable versions, and asset-target audit rows before anonymizing the account.

Demo stores the same contracts in each isolated `DemoSession`; it does not import the database client. Session expiry/logout/API restart discards library items. Demo projects and revisions bundle pixel data so their temporary shares do not rely on a library lookup.

Migration `0010_user-assets.sql` only adds tables/indexes/trigger and has no data rewrite. It is not deployed with Stage A. Before a future production migration, follow `docs/OPERATIONS.md`: protected randusr backup, checksum, isolated PostgreSQL 17 restore-check, explicit maintenance/release approval, then one-shot migration. Rollback is application rollback to 82e8c00 with the same database volume; leave the additive asset tables/data in place. No automatic down migration or volume removal.

## Sound effects and pitched instruments v1

`SfxRecipeV1` and `PitchedInstrumentV1` are versioned, declarative synthesis recipes in
`shared/assets.ts`. They contain no source code, samples, URLs or executable modulation. Both
use `SoundVoiceRecipeV1`: waveform (`square`, `pulse`, `triangle`, `sawtooth`, `sine` or
`noise`), pulse width, optional white-noise mix, recipe volume and ADSR envelope. An SFX adds
start/end frequency and duration; an Instrument adds bounded tuning in cents and receives
frequency/duration per note. The same `SoundEngine` renders BASIC, Inventory audition and the
Sound Lab adapter, so a future tracker can schedule notes on this engine.

Shared validation limits frequency to 30–4,000 Hz, effect duration to 50–5,000 ms, ADSR stages
to 2,000 ms each and no longer than the effect, tuning to ±1,200 cents, recipe JSON to 2 KiB,
bound sounds to 16 per project, live voices to eight, and events to 32 per rolling second.
Master gain is capped at 0.25. Saturated events are dropped; there is no audio event queue.
Audio nodes disconnect on end or stop; pulse waves and one deterministic noise buffer use
bounded caches.

The server uses the same private asset table and JSONB immutable version rows. Registered
accounts use `/api/v1/assets/sounds`; Demo mirrors it under `/api/v1/demo/assets/sounds` in
session memory. Recipe format determines SFX versus Instrument and cannot change when saving a
new version. Stable aliases are generated once and remain unchanged on rename. Projects pin an
exact version and embed its complete recipe, so cloud revisions, `.randusr` files and anonymous
published runs are self-contained. Portable exports and public responses keep the recipe, name
and alias while stripping private library/version IDs. Sound assets share the existing 64-item
and 5 MiB account quotas. Migration `0011_sound-assets.sql` only widens the asset-type check;
it is a reviewed forward migration and has not been run in production.

`SoundAssetAdapter` owns library CRUD, `SoundPreviewAdapter` owns Preview/Stop plus global
mute/volume, and `bindSoundToProject` embeds a loaded immutable version. `soundInsertSnippet`
generates `SOUND "@alias"` for an effect or `NOTE "C4",0.5,"@alias"` for an instrument.
Existing `SOUND "laser"`, `SFX`, `BEEP`, `NOTE` and `PLAY` remain available. NOTE and PLAY
accept an optional final Instrument alias.

## Animated sprite v1

`AnimatedSpriteV1` lives beside `IndexedSpriteV1` in `shared/assets.ts` and uses the same asset rows, version API, project binding and sprite alias. Its recipe has `format: "randusr.animated-sprite"`, `version: 1`, common `width`, `height`, `palette`, `transparentIndex`, `frames: number[][]`, integer `fps` (1–12) and `loop`. Each row-major frame stores exactly `width * height` palette-slot indexes. A private asset version, cloud project pin, revision and publication snapshot capture all frames and timing. Portable `.randusr` and anonymous snapshots retain those frames and strip only the private asset/version IDs. `ProjectAssetManifestV1.version` stays 1, `.randusr` stays Project v2, and old `IndexedSpriteV1` payloads are unchanged.

`SPAWN("@alias",x,y)` starts frame 0 when the object is created. At each paint, the runtime chooses `floor(elapsedMilliseconds * fps / 1000)`; loop wraps modulo frame count, while a non-looping animation holds its final frame. The world shares one `requestAnimationFrame` paint cycle across all visible animated objects; there is no interval or timer per sprite. The browser suspends that cycle while the tab is hidden and elapsed-time selection resumes deterministically when visible. BASIC RUN starts playback; global STOP freezes current frames and cancels the cycle; RESET clears the scene. No extra per-object animation commands are added in v1.

No SQL migration is needed: `user_asset_versions.sprite` and project/revision/publication snapshots are existing JSONB fields. Runtime/server validators accept exactly the static or animated versioned union and apply the frame and manifest budgets above. Music Tracker, folders, independent asset sharing, remix/attribution and library cleanup remain later work.

## Pixel editor UI (IDEA 02 Stages A and B)

`src/PixelEditor.tsx` is the full-screen editor opened from INVENTORY → **New sprite** (or **Edit** on a
personal sprite). The static editor edits one `IndexedSpriteV1`; the Stage B timeline edits `AnimatedSpriteV1` and submits the full recipe to the same adapter:

- Palette slot 0 is transparent; slots 1–15 map to Spectrum colours 0–15 (slot 8 is black), so a saved
  sprite renders identically through `src/runtime/world.ts` and the inventory thumbnail. No RGB, no
  separate editor file format, no local draft database — the library API is the only save path.
- Tools: pencil, eraser, colour picker, flood fill, filled rectangle and view pan; flip H/V; integer zoom
  (1×–32×) with grid and Fit; bounded undo/redo (40 snapshots) that also covers resize and flips.
- Resize to a preset asks first when the sprite contains pixels, keeps the drawing centred and crops the
  edges when shrinking; undo restores the previous size. Unsaved work needs an explicit discard decision
  before the editor closes.
- Saving creates a new immutable version (`baseVersion` conflict checked by the API) or a new asset, binds
  the exact payload into `Project.assetManifest` and selects it in the drawer. **Insert in CODE** then
  writes `SPRITE = SPAWN("@alias",80,120)` at the caret without stopping a running SCREEN.
- Export PNG writes the exact indexed pixels with a real alpha channel for the transparent slot.
- Keyboard: B/E/I/G/R tools, arrows move a pixel cursor and Enter paints, `[`/`]` zoom, `G` grid, `0` fit,
  Ctrl/⌘+Z and Ctrl/⌘+Shift+Z history, Escape closes through the discard guard.
- Animation (frames, timeline, onion skin, play/stop) uses the same editor and canonical asset API.
  Opening a saved `AnimatedSpriteV1` restores every frame, FPS, Loop and
  order. Saving sends the complete recipe through `SpriteEditorAdapter`; one frame remains the
  unchanged `IndexedSpriteV1` payload.
