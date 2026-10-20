# Sound Lab (card #124)

The Sound Lab is the full-screen editor for personal sound effects and pitched instruments. It follows the Pixel Editor's shell (modal `<dialog>`, header with name/status/Save, unsaved-work guard) and is reached from **INVENTORY → New sound** (registered and Demo sessions; guests keep the built-in sound previews and cannot write personal sounds).

Ownership: this card owns the React/CSS UI and the `SoundDraftAdapter` seam. Card #123 owns the canonical recipe types, the synth, persistence and `SOUND` in BASIC. The lab contains **no synthesizer and no storage format of its own**.

## Files

| File | Role |
| --- | --- |
| `src/SoundEditor.tsx` | The dialog: presets, kind switch, controls, transport, piano, unsaved dialog, status |
| `src/SoundGraph.tsx`, `src/sound-graph.ts` | Pitch / volume / wave graph; pure geometry computed from the draft |
| `src/sound-draft.ts` | `SoundDraft`, limits, normalisation, presets, randomize, bounded undo/redo, `SoundDraftAdapter`, inert `disconnectedAdapter` |
| `src/sound-contract.ts` | `draftToRecipe` / `recipeToDraft` over canonical `shared/assets.ts` types and `createContractAdapter` |
| `src/sound-adapter.ts` | The production adapter over the shared WebAudio engine and private sound API; DEV-only test hook |
| `src/Inventory.tsx`, `src/inventory-model.ts` | **New sound** button, personal sounds under My assets (`@alias`), Preview/Stop, **Edit** and pinned **Insert in CODE** |

## Behavior

- **Two kinds.** *Sound effect* (one short sound for `SOUND`, with a start→end pitch glide) and *Instrument* (a voice that plays any note; the glide is replaced by audition keys `A S D F G H J K` and an octave switch, plus fine tuning in cents). Same controls and the same recipe vocabulary for both. The kind of a saved sound is locked.
- **Presets:** Laser, Coin, Jump, Explosion, Power-up, Blip, Drum, Wind. Choosing one is an undoable edit and suggests a name if the name is empty.
- **Controls:** waveform (Square, Triangle, Saw, Sine, Noise), start pitch, end pitch, a Rising/Falling/Flat direction switch and Swap, length, volume, ADSR (Attack, Decay, Sustain, Release). *Advanced* shows only what the engine supports: pulse width (square only), noise mix (not for the noise waveform), fine tune (instruments). Every control has a `?` help line.
- **Graph:** three tracks computed from the draft: pitch glide on a musical (logarithmic) axis, volume envelope × volume with stage markers, and a waveform schematic whose cycle density follows the glide and whose shape follows waveform, pulse width and noise mix. Static SVG; the only motion is a CSS playhead while a preview runs (none under `prefers-reduced-motion`). There is no audio-driven redraw loop.
- **Preview / Stop** run from an explicit click or key. Moving a slider never plays a sound unless the person turns on *Play after each change* (off by default, 350 ms debounce). Preview resumes AudioContext from the gesture, reports a rejected unlock, and restarts cleanly. Stop, closing the lab, a hidden tab and unmount all call `adapter.stop()`. Inventory audition uses the same engine and is cancelled by Stop/RUN/RESET. A **Mute** toggle temporarily mutes the shared engine and resets when the lab closes.
- **History:** Undo/Redo bounded to 100 steps; a slider drag is one step. **Reset** returns to the last saved (or initial) sound and is itself undoable. **Randomize** stays inside pleasant bounds (≤ 0.9 s, volume ≤ 70%) and is undoable.
- **Saving:** Save (new asset, then new immutable versions of the same asset), Save copy (always a new asset named “… copy”). The status line shows *Unsaved changes / Saving… / Saved* or an error (name needed, version conflict, save failed). After a successful save the lab offers **Insert in CODE**; insertion loads and pins the exact immutable version into the project snapshot, then writes `SOUND "@alias"` for SFX or `NOTE "C4",0.5,"@alias"` for an Instrument at the CODE caret. My Assets insertion does the same. A dirty lab asks before closing and also sets `beforeunload`.
- **Keyboard:** Ctrl/⌘+Enter Preview/Stop, Ctrl/⌘+S Save, Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl/⌘+Y redo, Esc close (guarded). Piano keys only fire outside text fields.
- **Accessibility:** native range inputs with labels, `aria-valuetext` (`440 Hz · A4`), `aria-pressed` toggles, `role="status"` for save state, `role="alert"` for audio errors, `role="img"` graph with a text alternative, the confirm dialog traps focus (`inert` behind it) and focuses *Keep editing*; closing returns focus to the opener (the clicked button is passed explicitly because Safari does not focus buttons on click).
- **Layout:** three columns ≥ 1100 px, narrower columns at 1024, one scrolling column ≤ 900 px with the transport row sticky at the bottom. Verified with no horizontal overflow at 1440×900, 1024×768, 820×874 and 390×844.
- **Copy:** every string is a `sl*` key localized in all eight locales.

## Integration status (be precise)

- **Connected to the real engine and private API:** `soundDraftAdapter()` uses the same `soundPreviewAdapter` and `SoundEngine` as BASIC. `preview()` resolves on completion/Stop and rejects with a `blocked` status when the browser refuses the AudioContext unlock. Registered and Demo sessions use `/assets/sounds`; guests can audition recipes but cannot save. The dev-only recording adapter remains test-only.
- **Canonical contract:** `src/sound-contract.ts` imports and re-exports the recipe, preview and asset interfaces from `shared/assets.ts`; `recipeWithinContract` delegates to `assertSoundRecipe`. `SoundPreviewAdapter.preview` returns a promise and has an explicit `unlock()` method so asynchronous asset fetches can resume audio synchronously during the click gesture.
- **Mapping rules** (tested): seconds → whole milliseconds (10 ms steps); `saw` ↔ `sawtooth`; a square whose pulse width ≠ 50% is the engine's `pulse`; the noise layer is dropped for the noise waveform; tuning applies to instruments only; malformed or out-of-range recipes fail shared validation before they are stored or played.
- **Insert and project pinning:** insertion loads the saved asset and writes its exact immutable version into `ProjectSnapshot.assetManifest.sounds` before inserting BASIC code. Portable project snapshots, publication and `.randusr` bundles retain the recipe and stable alias but strip private asset/version IDs. Public publications therefore stay pinned when the private library later adds a version.
- **Master volume:** there is no user slider yet. The shared engine defaults its output gain to `0.20` and clamps programmatic master volume to `0.25`; recipe volume is also bounded to `0..1`. The Sound Lab mute control affects the shared engine temporarily and is cleared when the lab closes.
- **Shared seams touched:** `src/App.tsx` (lazy lab + state), `src/Inventory.tsx`, `src/inventory-model.ts`, `src/style.css` (one appended `SOUND LAB` block), `src/locales/en.ts` (one `// Sound Lab` block) and the generated locale tables, and `scripts/i18n-check.mjs` (identical-to-English allowances for genuine cognates such as “Laser”, “Instrument”). #123 edits several of the same files; expect trivial merge conflicts in `en.ts`, the locale JSON/CSV and `Inventory.tsx`.

## Tests

- `tests/sound-draft.test.ts`: normalisation and bounds, presets, pitch scale, envelope, randomize bounds, history (merge, redo clearing, 100-step bound), graph geometry follows the draft, inert adapter.
- `tests/sound-contract.test.ts`: every preset and 400 random drafts map to a recipe that satisfies the contract rules; unit conversion; round trips; adapter create/version/rename, conflict, guest, mute, stop settling with no stray timer.
- `tests/sound-editor.test.tsx`: markup in all eight locales, every range labelled with `aria-valuetext`, honest disconnected state, instrument layout, kind lock.
- `tests/e2e/sound-lab.spec.ts` (hosted harness, Chromium / WebKit / tablet): the fake-adapter suite checks UI states and the integrated native-audio test checks AudioContext unlock, source creation, immediate voice disconnection on Stop, Demo save, project pin, BASIC `SOUND`, and BASIC STOP against real browser WebAudio. The browser is headless and audio output is muted, so this validates source scheduling and cleanup, not subjective speaker quality.
- `tests/e2e/sound-lab-screens.spec.ts` (`SOUND_SCREENS=1`): screenshots EN/RU/DE/JA × four sizes plus instrument views, in `docs/qa-124/`.

## Known limits

- Speaker/headphone sound quality still needs a human listening pass; headless browser audio output is muted.
- Stage B items (per-asset sharing, folders, tracker) are separate cards.
