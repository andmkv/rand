import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { t, type Locale } from "./i18n";
import {
  defaultDraft,
  emptyHistory,
  instrumentDraft,
  limits,
  matchingPreset,
  noteName,
  noteToHz,
  normalizeDraft,
  pitchDirection,
  pitchSteps,
  pitchToStep,
  presetDraft,
  presetIds,
  randomizeDraft,
  recordEdit,
  redo,
  sameDraft,
  soundSnippet,
  stepToPitch,
  swapPitch,
  undo,
  waveforms,
  withDirection,
  type DraftHistory,
  type NumericField,
  type PitchDirection,
  type PresetId,
  type SavedSound,
  type SoundDraft,
  type SoundDraftAdapter,
  type SoundKind,
  type Waveform,
} from "./sound-draft";
import { SoundGraph } from "./SoundGraph";

type Key = Parameters<typeof t>[0];


type Copy = (key: Key) => string;
/** Adapters may come from another bundle, so read the code instead of trusting `instanceof`. */
const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
function Help({
  id,
  text,
  open,
  copy,
  onToggle,
}: {
  id: string;
  text: Key;
  open: boolean;
  copy: Copy;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="sl-help"
        aria-expanded={open}
        aria-controls={`sl-help-${id}`}
        aria-label={`${copy("slHelp")}: ${copy(("slLabel_" + id) as Key)}`}
        title={copy(text)}
        onClick={() => onToggle(id)}
      >
        ?
      </button>
      {open && (
        <p className="sl-help-text" id={`sl-help-${id}`}>
          {copy(text)}
        </p>
      )}
    </>
  );
}
function Slider({
  id,
  min,
  max,
  step,
  value,
  display,
  text,
  open,
  copy,
  onToggle,
  onValue,
}: {
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  text: Key;
  open: boolean;
  copy: Copy;
  onToggle: (id: string) => void;
  onValue: (value: number) => void;
}) {
  return (
    <div className="sl-row" data-field={id}>
      <label htmlFor={`sl-${id}`} className="sl-label">
        {copy(("slLabel_" + id) as Key)}
      </label>
      <Help id={id} text={text} open={open} copy={copy} onToggle={onToggle} />
      <output className="sl-value" htmlFor={`sl-${id}`}>
        {display}
      </output>
      <input
        id={`sl-${id}`}
        className="sl-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        onChange={(event) => onValue(Number(event.target.value))}
      />
    </div>
  );
}

export interface SoundEditorAsset {
  id: string;
  alias: string;
  version: number;
  name: string;
  draft: SoundDraft;
}

/** Eight keys of one octave; the letters mirror a piano row on the home keys. */
const pianoKeys = [
  { key: "a", semitone: 0, label: "C" },
  { key: "s", semitone: 2, label: "D" },
  { key: "d", semitone: 4, label: "E" },
  { key: "f", semitone: 5, label: "F" },
  { key: "g", semitone: 7, label: "G" },
  { key: "h", semitone: 9, label: "A" },
  { key: "j", semitone: 11, label: "B" },
  { key: "k", semitone: 12, label: "C" },
] as const;
const octaves = [3, 4, 5] as const;
/** MIDI number of C in the given octave (C4 = 60). */
const cMidi = (octave: number) => 12 * (octave + 1);

type Status = "idle" | "saving" | "saved" | "error";
type Confirm = "close" | null;

const waveKey: Record<Waveform, Key> = {
  square: "slWaveSquare",
  triangle: "slWaveTriangle",
  saw: "slWaveSaw",
  sine: "slWaveSine",
  noise: "slWaveNoise",
};
const presetKey: Record<PresetId, Key> = {
  laser: "slPresetLaser",
  coin: "slPresetCoin",
  jump: "slPresetJump",
  explosion: "slPresetExplosion",
  powerup: "slPresetPowerup",
  blip: "slPresetBlip",
  drum: "slPresetDrum",
  wind: "slPresetWind",
};
const directionKey: Record<PitchDirection, Key> = {
  rising: "slRising",
  falling: "slFalling",
  flat: "slFlat",
};
const directionGlyph: Record<PitchDirection, string> = {
  rising: "↗",
  falling: "↘",
  flat: "→",
};

export function SoundEditor({
  locale,
  adapter,
  asset,
  returnFocus,
  onSaved,
  onInsert,
  onClose,
}: {
  locale: Locale;
  adapter: SoundDraftAdapter;
  asset?: SoundEditorAsset | null;
  /** Where focus goes on close; falls back to the previously focused element (Safari does not focus buttons on click). */
  returnFocus?: HTMLElement | null;
  /** Called after every successful save so the Inventory can refresh its list. */
  onSaved?: (saved: SavedSound) => void;
  /** Writes `SOUND "@alias"` at the CODE caret and closes the lab. */
  onInsert?: (snippet: string, saved: SavedSound & { version: number }) => void;
  onClose: () => void;
}) {
  const copy = (key: Key) => t(key, locale);
  const initial = useMemo(
    () => asset?.draft ?? defaultDraft("sfx"),
    // The first draft is decided once; later asset prop changes never replace unsaved work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [draft, setDraft] = useState<SoundDraft>(initial);
  const [history, setHistory] = useState<DraftHistory>(emptyHistory);
  const [name, setName] = useState(asset?.name ?? "");
  const [baseline, setBaseline] = useState<{ draft: SoundDraft; name: string }>({
    draft: initial,
    name: asset?.name ?? "",
  });
  const [saved, setSaved] = useState<(SavedSound & { version: number }) | null>(
    asset ? { id: asset.id, alias: asset.alias, name: asset.name, version: asset.version } : null,
  );
  const [status, setStatus] = useState<Status>("idle");
  const [problem, setProblem] = useState<Key | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playRun, setPlayRun] = useState(0);
  const [notice, setNotice] = useState<Key | null>(null);
  const [auto, setAuto] = useState(false);
  const [muted, setMuted] = useState(false);
  const [octave, setOctave] = useState<number>(4);
  const [note, setNote] = useState<number | null>(null);
  const [help, setHelp] = useState<Set<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const run = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const historyRef = useRef(history);
  historyRef.current = history;
  const noteRef = useRef(note);
  noteRef.current = note;
  const autoTimer = useRef<number | null>(null);
  const edited = useRef(false);

  const dirty = !sameDraft(draft, baseline.draft) || name.trim() !== baseline.name.trim();
  const isInstrument = draft.kind === "instrument";
  const hasAsset = !!saved;
  const canPreview = adapter.available.preview;
  const canSave = adapter.available.save;
  const direction = pitchDirection(draft);
  const preset = matchingPreset(draft);
  const playedHz = isInstrument ? (note ?? noteToHz(cMidi(octave))) : undefined;

  useLayoutEffect(() => {
    opener.current = returnFocus ?? (document.activeElement as HTMLElement | null);
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      // Leave modal mode first; an element outside an open modal dialog cannot take focus.
      if (element?.open) element.close();
      opener.current?.focus?.();
    };
  }, []);
  // The sound stops with the lab: closing, a hidden tab and a locale change never leave a voice.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      run.current += 1;
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
      adapter.stop();
      // The mute toggle is a temporary audition control on the shared engine.
      adapter.setMuted?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (confirm) keepButton.current?.focus();
  }, [confirm]);
  // Opt-in only: "Play after each change" auditions once edits settle; sliders alone never sound.
  useEffect(() => {
    if (!edited.current) return;
    edited.current = false;
    if (!auto || !canPreview) return;
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    autoTimer.current = window.setTimeout(() => void preview(), 350);
    return () => {
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  /* ------------------------------------------------------------------ editing */

  function commit(next: SoundDraft, key: string) {
    const current = draftRef.current;
    if (sameDraft(next, current)) return;
    setHistory((h) => recordEdit(h, current, key, performance.now()));
    setDraft(next);
    setStatus((value) => (value === "saved" ? "idle" : value));
    setProblem(null);
    edited.current = true;
  }
  function setField(field: NumericField, value: number) {
    commit(normalizeDraft({ ...draftRef.current, [field]: value }, field), field);
  }
  function applyUndo() {
    const result = undo(historyRef.current, draftRef.current);
    if (!result) return;
    setHistory(result.history);
    setDraft(result.draft);
  }
  function applyRedo() {
    const result = redo(historyRef.current, draftRef.current);
    if (!result) return;
    setHistory(result.history);
    setDraft(result.draft);
  }
  function choosePreset(id: PresetId) {
    commit(presetDraft(id, draftRef.current.kind), "");
    if (!name.trim() && !hasAsset) setName(copy(presetKey[id]));
  }
  function chooseKind(kind: SoundKind) {
    if (hasAsset || draftRef.current.kind === kind) return;
    commit(
      kind === "instrument"
        ? instrumentDraft()
        : presetDraft("laser", "sfx"),
      "",
    );
  }
  function reset() {
    commit(baseline.draft, "");
  }

  /* ------------------------------------------------------------------ preview */

  function stop() {
    run.current += 1;
    adapter.stop();
    setPlaying(false);
  }
  async function preview(hz?: number) {
    if (!canPreview) return;
    adapter.stop();
    const mine = ++run.current;
    setNotice(null);
    setPlaying(true);
    setPlayRun(mine);
    try {
      await adapter.preview(
        draftRef.current,
        draftRef.current.kind === "instrument"
          ? { noteHz: hz ?? noteToHz(cMidi(octave)) }
          : undefined,
      );
    } catch (error) {
      if (mine === run.current)
        setNotice(
          errorCode(error) === "blocked"
            ? "slPreviewBlocked"
            : errorCode(error) === "unavailable"
              ? "slEngineMissing"
              : "slPreviewFailed",
        );
    } finally {
      if (mine === run.current) setPlaying(false);
    }
  }
  function playNote(semitone: number) {
    const hz = noteToHz(cMidi(octave) + semitone);
    setNote(hz);
    noteRef.current = hz;
    void preview(hz);
  }
  function togglePreview() {
    if (playing) stop();
    else void preview(playedHz);
  }

  /* ------------------------------------------------------------------ save */

  async function save(asCopy: boolean) {
    const clean = name.trim();
    if (!clean) {
      setProblem("slNameNeeded");
      setStatus("error");
      nameInput.current?.focus();
      return;
    }
    if (!canSave) return;
    setStatus("saving");
    setProblem(null);
    try {
      const nextName = asCopy ? copyName(clean) : clean;
      const result = await adapter.save({
        draft,
        name: nextName,
        existing:
          !asCopy && saved
            ? { id: saved.id, baseVersion: saved.version }
            : undefined,
      });
      setSaved(result);
      setName(nextName);
      setBaseline({ draft, name: nextName });
      setStatus("saved");
      onSaved?.(result);
    } catch (error) {
      setStatus("error");
      setProblem(
        errorCode(error) === "conflict"
          ? "slSaveConflict"
          : "slSaveFailed",
      );
    }
  }
  function copyName(base: string) {
    return `${base} ${copy("slCopySuffix")}`.slice(0, 64);
  }

  /* ------------------------------------------------------------------ closing & keys */

  function requestClose() {
    stop();
    if (dirty) setConfirm("close");
    else onClose();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (confirm) return;
    const target = event.target as HTMLElement;
    const typing =
      target instanceof HTMLInputElement && target.type === "text";
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save(false);
    } else if (mod && event.key === "Enter") {
      event.preventDefault();
      togglePreview();
    } else if (!typing && mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) applyRedo();
      else applyUndo();
    } else if (!typing && mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      applyRedo();
    } else if (
      isInstrument &&
      !mod &&
      !event.altKey &&
      !typing &&
      !(target instanceof HTMLSelectElement) &&
      !event.repeat
    ) {
      const piano = pianoKeys.find((item) => item.key === event.key.toLowerCase());
      if (piano) {
        event.preventDefault();
        playNote(piano.semitone);
      }
    }
  }
  function toggleHelp(id: string) {
    setHelp((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ------------------------------------------------------------------ pieces */

  const statusText =
    status === "saving"
      ? copy("slSaving")
      : status === "error" && problem
        ? copy(problem)
        : dirty
          ? copy("slUnsaved")
          : status === "saved"
            ? copy("slSaved")
            : "";
  const engineNote = !canPreview || !canSave;

  const envelopeMax = isInstrument ? limits.envelopeMax : draft.duration;
  const hz = (value: number) => `${value} Hz · ${noteName(value)}`;
  const seconds = (value: number) => `${value.toFixed(2)} s`;

  return (
    <dialog
      ref={dialog}
      className="sl"
      aria-label={copy("slTitle")}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <div className="sl-shell" inert={confirm !== null}>
        <header className="sl-header">
          <h2>{copy("slTitle")}</h2>
          <label className="sl-name">
            <span>{copy("slName")}</span>
            <input
              ref={nameInput}
              type="text"
              value={name}
              maxLength={64}
              aria-invalid={problem === "slNameNeeded"}
              onChange={(event) => {
                setName(event.target.value);
                setStatus((value) => (value === "saved" ? "idle" : value));
                if (problem === "slNameNeeded") setProblem(null);
              }}
            />
          </label>
          <span
            className={"sl-status" + (status === "error" ? " error" : "")}
            role="status"
            data-status={status}
          >
            {statusText}
          </span>
          <div className="sl-header-actions">
            <button
              type="button"
              className="primary sl-save"
              onClick={() => void save(false)}
              disabled={!canSave || status === "saving"}
              aria-keyshortcuts="Control+S Meta+S"
            >
              {copy("slSave")}
            </button>
            <button
              type="button"
              className="sl-save-copy"
              onClick={() => void save(true)}
              disabled={!canSave || status === "saving"}
            >
              {copy("slSaveCopy")}
            </button>
            <button
              type="button"
              className="sl-close"
              onClick={requestClose}
              aria-label={copy("close")}
            >
              ✕
            </button>
          </div>
        </header>
        {engineNote && (
          <p className="sl-engine" role="note" data-engine="disconnected">
            {copy(
              !canPreview && !canSave
                ? "slEngineMissing"
                : !canPreview
                  ? "slEnginePreviewMissing"
                  : "slEngineSaveMissing",
            )}
          </p>
        )}
        <div className="sl-body">
          <section className="sl-col sl-recipe" aria-label={copy("slPresets")}>
            <div
              className="sl-kinds"
              role="group"
              aria-label={copy("slKind")}
            >
              {(["sfx", "instrument"] as SoundKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="sl-kind"
                  aria-pressed={draft.kind === kind}
                  disabled={hasAsset && draft.kind !== kind}
                  onClick={() => chooseKind(kind)}
                >
                  <strong>{copy(kind === "sfx" ? "slKindSfx" : "slKindInstrument")}</strong>
                  <span>{copy(kind === "sfx" ? "slKindSfxHint" : "slKindInstrumentHint")}</span>
                </button>
              ))}
            </div>
            <h3>{copy("slPresets")}</h3>
            <div className="sl-presets" role="group" aria-label={copy("slPresets")}>
              {presetIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="sl-preset"
                  data-preset={id}
                  aria-pressed={preset === id}
                  onClick={() => choosePreset(id)}
                >
                  {copy(presetKey[id])}
                </button>
              ))}
            </div>
            <details className="sl-guide">
              <summary>{copy("slGuide")}</summary>
              <h4>{copy("slGuideLaser")}</h4>
              <ol>
                <li>{copy("slGuideLaser1")}</li>
                <li>{copy("slGuideLaser2")}</li>
                <li>{copy("slGuideLaser3")}</li>
              </ol>
              <h4>{copy("slGuideBasic")}</h4>
              <ol>
                <li>{copy("slGuideBasic1")}</li>
                <li>{copy("slGuideBasic2")}</li>
                <li>{copy("slGuideBasic3")}</li>
              </ol>
            </details>
          </section>

          <section className="sl-col sl-stage" aria-label={copy("slPreview")}>
            <SoundGraph
              draft={draft}
              noteHz={playedHz}
              playing={playing}
              playRun={playRun}
              labels={{
                graph: copy("slGraphLabel"),
                pitch: copy("slGraphPitch"),
                volume: copy("slGraphVolume"),
                wave: copy("slGraphWave"),
              }}
              description={`${copy(waveKey[draft.waveform])}; ${
                isInstrument
                  ? hz(Math.round(playedHz ?? draft.pitchStart))
                  : `${hz(draft.pitchStart)} → ${hz(draft.pitchEnd)}`
              }; ${seconds(draft.duration)}; ${Math.round(draft.volume * 100)}%`}
            />
            <div className="sl-transport">
              <button
                type="button"
                className="primary sl-preview"
                onClick={togglePreview}
                disabled={!canPreview}
                aria-pressed={playing}
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {copy(playing ? "slStop" : "slPlay")}
              </button>
              <div className="sl-history" role="group" aria-label={copy("slHistory")}>
                <button
                  type="button"
                  className="sl-undo"
                  onClick={applyUndo}
                  disabled={!history.past.length}
                  aria-keyshortcuts="Control+Z Meta+Z"
                >
                  ↶ {copy("slUndo")}
                </button>
                <button
                  type="button"
                  className="sl-redo"
                  onClick={applyRedo}
                  disabled={!history.future.length}
                  aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
                >
                  ↷ {copy("slRedo")}
                </button>
              </div>
              <button type="button" className="sl-reset" onClick={reset}>
                {copy("slReset")}
              </button>
              <button
                type="button"
                className="sl-random"
                onClick={() => commit(randomizeDraft(draftRef.current), "")}
              >
                ⚄ {copy("slRandomize")}
              </button>
              {adapter.setMuted && (
                <button
                  type="button"
                  className="sl-mute"
                  aria-pressed={muted}
                  onClick={() => {
                    const next = !muted;
                    setMuted(next);
                    adapter.setMuted?.(next);
                    if (next) stop();
                  }}
                >
                  {copy(muted ? "slUnmute" : "slMute")}
                </button>
              )}
              <label className="sl-auto">
                <input
                  type="checkbox"
                  checked={auto}
                  disabled={!canPreview}
                  onChange={(event) => setAuto(event.target.checked)}
                />
                <span>{copy("slAuto")}</span>
              </label>
            </div>
            {notice && (
              <p className="sl-notice error" role="alert">
                {copy(notice)}
              </p>
            )}
            {isInstrument && (
              <div className="sl-piano" role="group" aria-label={copy("slPiano")}>
                <div className="sl-octaves" role="group" aria-label={copy("slOctave")}>
                  {octaves.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={octave === value}
                      onClick={() => {
                        setOctave(value);
                        setNote(null);
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <div className="sl-keys">
                  {pianoKeys.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="sl-key"
                      disabled={!canPreview}
                      aria-keyshortcuts={item.key.toUpperCase()}
                      aria-label={`${item.label}${octave + (item.semitone === 12 ? 1 : 0)}`}
                      onClick={() => playNote(item.semitone)}
                    >
                      <span>{item.label}</span>
                      <kbd aria-hidden="true">{item.key.toUpperCase()}</kbd>
                    </button>
                  ))}
                </div>
                <p className="sl-hint">{copy("slPianoHint")}</p>
              </div>
            )}
            {saved && status !== "error" && !dirty && saved.alias && (
              <div className="sl-saved" data-saved={saved.alias}>
                <code>{soundSnippet(saved.alias, draft.kind)}</code>
                {onInsert && (
                  <button
                    type="button"
                    className="primary sl-insert"
                    onClick={() => onInsert(soundSnippet(saved.alias, draft.kind), saved)}
                  >
                    {copy("inventoryInsert")}
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="sl-col sl-controls" aria-label={copy("slControls")}>
            <fieldset className="sl-group">
              <legend>{copy("slLabel_wave")}</legend>
              <div className="sl-waves" role="group" aria-label={copy("slLabel_wave")}>
                {waveforms.map((wave) => (
                  <button
                    key={wave}
                    type="button"
                    className="sl-wave"
                    data-wave={wave}
                    aria-pressed={draft.waveform === wave}
                    onClick={() => commit({ ...draft, waveform: wave }, "")}
                  >
                    <WaveGlyph wave={wave} />
                    <span>{copy(waveKey[wave])}</span>
                  </button>
                ))}
              </div>
              <div className="sl-row-help">
                <Help id="wave" text="slHelpWave" open={help.has("wave")} copy={copy} onToggle={toggleHelp} />
              </div>
            </fieldset>
            <fieldset className="sl-group">
              <legend>{copy("slPitch")}</legend>
              {isInstrument ? (
                <p className="sl-hint">{copy("slInstrumentPitch")}</p>
              ) : (
                <>
                  <Slider
                    id="pitchStart"
                    open={help.has("pitchStart")}
                    copy={copy}
                    onToggle={toggleHelp}
                    min={0}
                    max={pitchSteps}
                    step={5}
                    value={pitchToStep(draft.pitchStart)}
                    display={hz(draft.pitchStart)}
                    text="slHelpPitchStart"
                    onValue={(v) => setField("pitchStart", stepToPitch(v))}
                  />
                  <Slider
                    id="pitchEnd"
                    open={help.has("pitchEnd")}
                    copy={copy}
                    onToggle={toggleHelp}
                    min={0}
                    max={pitchSteps}
                    step={5}
                    value={pitchToStep(draft.pitchEnd)}
                    display={hz(draft.pitchEnd)}
                    text="slHelpPitchEnd"
                    onValue={(v) => setField("pitchEnd", stepToPitch(v))}
                  />
                  <div className="sl-direction" role="group" aria-label={copy("slDirection")}>
                    {(["rising", "falling", "flat"] as PitchDirection[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        data-direction={value}
                        aria-pressed={direction === value}
                        onClick={() => commit(withDirection(draft, value), "")}
                      >
                        <span aria-hidden="true">{directionGlyph[value]}</span>{" "}
                        {copy(directionKey[value])}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="sl-swap"
                      onClick={() => commit(swapPitch(draft), "")}
                      disabled={direction === "flat"}
                    >
                      ⇄ {copy("slSwap")}
                    </button>
                  </div>
                </>
              )}
            </fieldset>
            <fieldset className="sl-group">
              <legend>{copy("slLevel")}</legend>
              <Slider
                id="duration"
                    open={help.has("duration")}
                    copy={copy}
                    onToggle={toggleHelp}
                min={limits.durationMin}
                max={limits.durationMax}
                step={0.05}
                value={draft.duration}
                display={seconds(draft.duration)}
                text={isInstrument ? "slHelpDurationNote" : "slHelpDuration"}
                onValue={(v) => setField("duration", v)}
              />
              <Slider
                id="volume"
                    open={help.has("volume")}
                    copy={copy}
                    onToggle={toggleHelp}
                min={0}
                max={1}
                step={0.01}
                value={draft.volume}
                display={`${Math.round(draft.volume * 100)}%`}
                text="slHelpVolume"
                onValue={(v) => setField("volume", v)}
              />
            </fieldset>
            <fieldset className="sl-group">
              <legend>{copy("slEnvelope")}</legend>
              <Slider
                id="attack"
                    open={help.has("attack")}
                    copy={copy}
                    onToggle={toggleHelp}
                min={0}
                max={envelopeMax}
                step={0.01}
                value={draft.attack}
                display={seconds(draft.attack)}
                text="slHelpAttack"
                onValue={(v) => setField("attack", v)}
              />
              <Slider
                id="decay"
                    open={help.has("decay")}
                    copy={copy}
                    onToggle={toggleHelp}
                min={0}
                max={envelopeMax}
                step={0.01}
                value={draft.decay}
                display={seconds(draft.decay)}
                text="slHelpDecay"
                onValue={(v) => setField("decay", v)}
              />
              <Slider
                id="sustain"
                    open={help.has("sustain")}
                    copy={copy}
                    onToggle={toggleHelp}
                min={0}
                max={1}
                step={0.01}
                value={draft.sustain}
                display={`${Math.round(draft.sustain * 100)}%`}
                text="slHelpSustain"
                onValue={(v) => setField("sustain", v)}
              />
              <Slider
                id="release"
                    open={help.has("release")}
                    copy={copy}
                    onToggle={toggleHelp}
                min={0}
                max={envelopeMax}
                step={0.01}
                value={draft.release}
                display={seconds(draft.release)}
                text="slHelpRelease"
                onValue={(v) => setField("release", v)}
              />
            </fieldset>
            <details className="sl-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}>
              <summary>{copy("slAdvanced")}</summary>
              {draft.waveform === "square" && (
                <Slider
                  id="pulseWidth"
                  min={limits.pulseMin}
                  max={limits.pulseMax}
                  step={0.01}
                  value={draft.pulseWidth}
                  display={`${Math.round(draft.pulseWidth * 100)}%`}
                  text="slHelpPulseWidth"
                  open={help.has("pulseWidth")}
                  copy={copy}
                  onToggle={toggleHelp}
                  onValue={(v) => setField("pulseWidth", v)}
                />
              )}
              {draft.waveform !== "noise" && (
                <Slider
                  id="noiseAmount"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.noiseAmount}
                  display={`${Math.round(draft.noiseAmount * 100)}%`}
                  text="slHelpNoiseAmount"
                  open={help.has("noiseAmount")}
                  copy={copy}
                  onToggle={toggleHelp}
                  onValue={(v) => setField("noiseAmount", v)}
                />
              )}
              {isInstrument && (
                <Slider
                  id="tuning"
                  min={-limits.tuningMax}
                  max={limits.tuningMax}
                  step={1}
                  value={draft.tuning}
                  display={`${draft.tuning > 0 ? "+" : ""}${draft.tuning} ¢`}
                  text="slHelpTuning"
                  open={help.has("tuning")}
                  copy={copy}
                  onToggle={toggleHelp}
                  onValue={(v) => setField("tuning", v)}
                />
              )}
            </details>
          </section>
        </div>
      </div>
      {confirm && (
        <div
          className="sl-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label={copy("slDiscardTitle")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setConfirm(null);
            }
          }}
        >
          <h3>{copy("slDiscardTitle")}</h3>
          <p>{copy("slDiscardBody")}</p>
          <div className="sl-confirm-actions">
            <button
              ref={keepButton}
              type="button"
              className="sl-keep"
              onClick={() => setConfirm(null)}
            >
              {copy("slKeepEditing")}
            </button>
            <button
              type="button"
              className="primary sl-discard"
              onClick={() => {
                setConfirm(null);
                onClose();
              }}
            >
              {copy("slDiscard")}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** Small pictogram for each waveform; decorative, the button carries the name. */
function WaveGlyph({ wave }: { wave: Waveform }) {
  const paths: Record<Waveform, string> = {
    square: "M1 14V4h8v10h8V4h8",
    triangle: "M1 14L7 4l6 10 6-10 6 10",
    saw: "M1 14L10 4v10L19 4v10l6-10",
    sine: "M1 9c3-10 6-10 8 0s5 10 8 0 5-10 8 0",
    noise: "M1 9l2-5 2 9 2-7 2 10 2-9 2 6 2-8 2 9 2-6 2 5 2-3",
  };
  return (
    <svg viewBox="0 0 26 18" width="26" height="18" aria-hidden="true" focusable="false">
      <path
        d={paths[wave]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
    </svg>
  );
}
