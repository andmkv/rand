/**
 * Sound Lab draft model (card #124). UI-owned working copy of a sound while it is being edited.
 *
 * This is NOT the canonical storage format. GPT's card #123 owns `SfxRecipeV1` / `PitchedInstrumentV1`
 * and the synth; when those types are published, `SoundDraftAdapter` is the single seam that maps
 * a `SoundDraft` to and from them. Nothing in here synthesizes audio.
 */

export type SoundKind = "sfx" | "instrument";
export type Waveform = "square" | "triangle" | "saw" | "sine" | "noise";
export const waveforms: Waveform[] = [
  "square",
  "triangle",
  "saw",
  "sine",
  "noise",
];

export interface SoundDraft {
  kind: SoundKind;
  waveform: Waveform;
  /** Hz at the start of the sound. */
  pitchStart: number;
  /** Hz at the end of the sound (one-shot sound effects only; instruments follow the played note). */
  pitchEnd: number;
  /** Seconds. For an instrument this is the length of the audition note. */
  duration: number;
  /** 0..1 before the global safe-volume bound. */
  volume: number;
  /** Pulse duty cycle for the square wave, 0.1..0.9 (0.5 is a plain square). */
  pulseWidth: number;
  /** White-noise layer under any waveform, 0..1. */
  noiseAmount: number;
  /** Instruments only: fine tuning in cents, -1200..1200. */
  tuning: number;
  /** Envelope: seconds, seconds, 0..1 level, seconds. */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export const limits = {
  pitchMin: 30,
  pitchMax: 4000,
  durationMin: 0.05,
  durationMax: 5,
  volumeMax: 1,
  envelopeStep: 0.01,
  envelopeMax: 2,
  pulseMin: 0.1,
  pulseMax: 0.9,
  tuningMax: 1200,
  /** Undo depth. */
  history: 100,
} as const;

export type NumericField =
  | "pitchStart"
  | "pitchEnd"
  | "duration"
  | "volume"
  | "pulseWidth"
  | "noiseAmount"
  | "tuning"
  | "attack"
  | "decay"
  | "sustain"
  | "release";

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Returns a valid draft: every value finite and in range, and attack + decay + release never
 * longer than the sound. `keep` names the field the person is moving; the others give way first.
 */
export function normalizeDraft(
  draft: SoundDraft,
  keep?: NumericField,
): SoundDraft {
  const finite = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  const duration = round(
    clamp(
      finite(draft.duration, 0.3),
      limits.durationMin,
      limits.durationMax,
    ),
    2,
  );
  const envelopeCap =
    draft.kind === "instrument" ? limits.envelopeMax : duration;
  const next: SoundDraft = {
    ...draft,
    pitchStart: Math.round(
      clamp(finite(draft.pitchStart, 440), limits.pitchMin, limits.pitchMax),
    ),
    pitchEnd: Math.round(
      clamp(finite(draft.pitchEnd, 440), limits.pitchMin, limits.pitchMax),
    ),
    duration,
    volume: round(clamp(finite(draft.volume, 0.6), 0, limits.volumeMax), 2),
    pulseWidth: round(
      clamp(finite(draft.pulseWidth, 0.5), limits.pulseMin, limits.pulseMax),
      2,
    ),
    noiseAmount: round(clamp(finite(draft.noiseAmount, 0), 0, 1), 2),
    tuning:
      draft.kind === "instrument"
        ? Math.round(
            clamp(finite(draft.tuning, 0), -limits.tuningMax, limits.tuningMax),
          )
        : 0,
    attack: round(clamp(finite(draft.attack, 0), 0, envelopeCap), 2),
    decay: round(clamp(finite(draft.decay, 0), 0, envelopeCap), 2),
    sustain: round(clamp(finite(draft.sustain, 0.6), 0, 1), 2),
    release: round(clamp(finite(draft.release, 0), 0, envelopeCap), 2),
  };
  // An instrument's stages are independent of the audition length; only a sound effect must
  // fit all of its stages inside its own duration (the canonical validator's rule).
  if (draft.kind === "instrument") return next;
  const shaped: ("attack" | "decay" | "release")[] = [
    "attack",
    "decay",
    "release",
  ];
  let over = next.attack + next.decay + next.release - duration;
  if (over > 0.0001) {
    const order = shaped.filter((field) => field !== keep);
    // Take the excess from the other stages, starting with the longest.
    order.sort((a, b) => next[b] - next[a]);
    for (const field of order) {
      const take = Math.min(next[field], over);
      next[field] = round(next[field] - take, 2);
      over = round(over - take, 4);
      if (over <= 0.0001) break;
    }
    if (over > 0.0001 && keep && shaped.includes(keep as never))
      (next as unknown as Record<string, number>)[keep] = round(
        Math.max(0, (next as unknown as Record<string, number>)[keep] - over),
        2,
      );
  }
  return next;
}

export const sameDraft = (a: SoundDraft, b: SoundDraft) =>
  (Object.keys(a) as (keyof SoundDraft)[]).every((key) => a[key] === b[key]);

/* ------------------------------------------------------------------ pitch scale */

/** Pitch sliders are musical (equal steps per octave), not linear in Hz. */
export const pitchSteps = 1000;
export function pitchToStep(hz: number): number {
  const ratio = Math.log(clamp(hz, limits.pitchMin, limits.pitchMax) / limits.pitchMin);
  const span = Math.log(limits.pitchMax / limits.pitchMin);
  return Math.round((ratio / span) * pitchSteps);
}
export function stepToPitch(step: number): number {
  const span = Math.log(limits.pitchMax / limits.pitchMin);
  return Math.round(
    limits.pitchMin * Math.exp((clamp(step, 0, pitchSteps) / pitchSteps) * span),
  );
}
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** Nearest equal-tempered note name (A4 = 440 Hz), e.g. `A4`. */
export function noteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${noteNames[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
export function noteToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/* ------------------------------------------------------------------ shape curves */

/** Gain 0..1 (before volume) at time `t` seconds, for a note held for the whole duration. */
export function envelopeAt(draft: SoundDraft, t: number): number {
  const { attack, decay, sustain, release, duration } = draft;
  if (t <= 0) return 0;
  if (t >= duration) return 0;
  const releaseStart = Math.max(attack + decay, duration - release);
  if (t >= releaseStart) {
    const held = envelopeAtHeld(draft, releaseStart);
    return release > 0 ? held * (1 - (t - releaseStart) / (duration - releaseStart || 1)) : held;
  }
  return envelopeAtHeld(draft, t);
}
function envelopeAtHeld(draft: SoundDraft, t: number): number {
  const { attack, decay, sustain } = draft;
  if (attack > 0 && t < attack) return t / attack;
  if (decay > 0 && t < attack + decay)
    return 1 - ((t - attack) / decay) * (1 - sustain);
  return attack === 0 && decay === 0 && t === 0 ? 1 : sustain;
}

/** Pitch in Hz at time `t`: a smooth glide on the musical scale, as the engine will render it. */
export function pitchAt(draft: SoundDraft, t: number): number {
  const progress = clamp(t / draft.duration, 0, 1);
  return draft.pitchStart * (draft.pitchEnd / draft.pitchStart) ** progress;
}

export type PitchDirection = "rising" | "falling" | "flat";
export function pitchDirection(draft: SoundDraft): PitchDirection {
  if (draft.pitchEnd > draft.pitchStart) return "rising";
  if (draft.pitchEnd < draft.pitchStart) return "falling";
  return "flat";
}
/** Sets the glide direction while keeping the size of the interval. */
export function withDirection(
  draft: SoundDraft,
  direction: PitchDirection,
): SoundDraft {
  if (direction === pitchDirection(draft)) return draft;
  if (direction === "flat")
    return normalizeDraft({ ...draft, pitchEnd: draft.pitchStart });
  const ratio =
    draft.pitchEnd === draft.pitchStart
      ? 2
      : Math.max(draft.pitchEnd, draft.pitchStart) /
        Math.min(draft.pitchEnd, draft.pitchStart);
  const end =
    direction === "rising"
      ? draft.pitchStart * ratio
      : draft.pitchStart / ratio;
  return normalizeDraft({ ...draft, pitchEnd: end });
}
export function swapPitch(draft: SoundDraft): SoundDraft {
  return { ...draft, pitchStart: draft.pitchEnd, pitchEnd: draft.pitchStart };
}

/* ------------------------------------------------------------------ presets */

export type PresetId =
  | "laser"
  | "coin"
  | "jump"
  | "explosion"
  | "powerup"
  | "blip"
  | "drum"
  | "wind";
export const presetIds: PresetId[] = [
  "laser",
  "coin",
  "jump",
  "explosion",
  "powerup",
  "blip",
  "drum",
  "wind",
];
/**
 * Starting points shown in the lab. TODO(#123): replace with the canonical recipes exported by
 * the sound engine so Preview and BASIC `SOUND` share one definition.
 */
type PresetBase = Omit<SoundDraft, "kind" | "pulseWidth" | "noiseAmount" | "tuning">;
const presetBase: Record<PresetId, PresetBase> = {
  laser: { waveform: "square", pitchStart: 1800, pitchEnd: 180, duration: 0.3, volume: 0.6, attack: 0, decay: 0.12, sustain: 0.5, release: 0.1 },
  coin: { waveform: "square", pitchStart: 988, pitchEnd: 1319, duration: 0.25, volume: 0.55, attack: 0, decay: 0.05, sustain: 0.7, release: 0.12 },
  jump: { waveform: "square", pitchStart: 260, pitchEnd: 720, duration: 0.28, volume: 0.6, attack: 0, decay: 0.1, sustain: 0.6, release: 0.1 },
  explosion: { waveform: "noise", pitchStart: 900, pitchEnd: 60, duration: 1.1, volume: 0.7, attack: 0, decay: 0.5, sustain: 0.3, release: 0.4 },
  powerup: { waveform: "triangle", pitchStart: 330, pitchEnd: 1320, duration: 0.6, volume: 0.6, attack: 0.02, decay: 0.15, sustain: 0.7, release: 0.2 },
  blip: { waveform: "square", pitchStart: 880, pitchEnd: 880, duration: 0.08, volume: 0.5, attack: 0, decay: 0.02, sustain: 0.7, release: 0.03 },
  drum: { waveform: "sine", pitchStart: 160, pitchEnd: 45, duration: 0.35, volume: 0.8, attack: 0, decay: 0.2, sustain: 0.1, release: 0.1 },
  wind: { waveform: "noise", pitchStart: 400, pitchEnd: 700, duration: 2.5, volume: 0.35, attack: 0.8, decay: 0.4, sustain: 0.6, release: 0.9 },
};
export function presetDraft(id: PresetId, kind: SoundKind = "sfx"): SoundDraft {
  return normalizeDraft({
    kind,
    pulseWidth: 0.5,
    noiseAmount: 0,
    tuning: 0,
    ...presetBase[id],
  });
}
/** A neutral instrument: a soft square note that follows the key that is played. */
export function instrumentDraft(): SoundDraft {
  return normalizeDraft({
    kind: "instrument",
    waveform: "square",
    pulseWidth: 0.5,
    noiseAmount: 0,
    tuning: 0,
    pitchStart: 262,
    pitchEnd: 262,
    duration: 0.6,
    volume: 0.5,
    attack: 0.01,
    decay: 0.12,
    sustain: 0.6,
    release: 0.2,
  });
}
export function defaultDraft(kind: SoundKind): SoundDraft {
  return kind === "instrument" ? instrumentDraft() : presetDraft("laser");
}
/** Which preset (if any) the draft still exactly matches. */
export function matchingPreset(draft: SoundDraft): PresetId | null {
  return (
    presetIds.find((id) => sameDraft(presetDraft(id, draft.kind), draft)) ?? null
  );
}
/** Switching kind keeps the recipe; an instrument has no pitch glide. */
export function withKind(draft: SoundDraft, kind: SoundKind): SoundDraft {
  if (draft.kind === kind) return draft;
  return normalizeDraft({
    ...draft,
    kind,
    pitchEnd: kind === "instrument" ? draft.pitchStart : draft.pitchEnd,
  });
}

/* ------------------------------------------------------------------ randomize */

/** Randomize inside "pleasant" bounds: moderate length and volume, a real but not extreme glide. */
export function randomizeDraft(
  draft: SoundDraft,
  random: () => number = Math.random,
): SoundDraft {
  const pick = <T,>(items: readonly T[]) =>
    items[Math.floor(random() * items.length) % items.length];
  const between = (min: number, max: number) => min + random() * (max - min);
  const start = stepToPitch(between(150, 800));
  const octaves = between(-2, 2);
  const duration = between(0.1, 0.9);
  return normalizeDraft({
    ...draft,
    waveform: pick(waveforms),
    pitchStart: start,
    pitchEnd: draft.kind === "instrument" ? start : start * 2 ** octaves,
    duration,
    volume: between(0.4, 0.7),
    attack: random() < 0.3 ? between(0, duration * 0.2) : 0,
    decay: between(0, duration * 0.4),
    sustain: between(0.2, 0.8),
    release: between(0.02, duration * 0.4),
  });
}

/* ------------------------------------------------------------------ history */

export interface DraftHistory {
  past: SoundDraft[];
  future: SoundDraft[];
  /** Coalescing: repeated edits of one control within a short time become a single undo step. */
  lastKey: string | null;
  lastAt: number;
}
export const emptyHistory: DraftHistory = {
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
};
const coalesceMs = 700;
export function recordEdit(
  history: DraftHistory,
  before: SoundDraft,
  key: string,
  now: number,
): DraftHistory {
  const merge =
    key !== "" && history.lastKey === key && now - history.lastAt < coalesceMs;
  return {
    past: merge
      ? history.past
      : [...history.past, before].slice(-limits.history),
    future: [],
    lastKey: key || null,
    lastAt: now,
  };
}
export function undo(
  history: DraftHistory,
  current: SoundDraft,
): { history: DraftHistory; draft: SoundDraft } | null {
  const previous = history.past[history.past.length - 1];
  if (!previous) return null;
  return {
    draft: previous,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future].slice(0, limits.history),
      lastKey: null,
      lastAt: 0,
    },
  };
}
export function redo(
  history: DraftHistory,
  current: SoundDraft,
): { history: DraftHistory; draft: SoundDraft } | null {
  const [next, ...rest] = history.future;
  if (!next) return null;
  return {
    draft: next,
    history: {
      past: [...history.past, current].slice(-limits.history),
      future: rest,
      lastKey: null,
      lastAt: 0,
    },
  };
}

/* ------------------------------------------------------------------ adapter seam */

export interface SavedSound {
  id: string;
  /** Stable BASIC alias without the leading `@`, e.g. `my_laser`. */
  alias: string;
  name: string;
}
/** Row in the Inventory's "My assets" list. */
export interface UserSoundSummary {
  id: string;
  alias: string;
  name: string;
  kind: SoundKind;
}
export type PreviewFailure = "blocked" | "unavailable" | "failed";
export class SoundAdapterError extends Error {
  constructor(
    readonly code: PreviewFailure | "conflict" | "save-failed" | "unavailable",
  ) {
    super(code);
  }
}
export interface PreviewOptions {
  /** Played note (Hz) for an instrument audition. Ignored for sound effects. */
  noteHz?: number;
}
/**
 * The only thing the Sound Lab knows about the engine. `available` says honestly which parts are
 * connected; the UI never pretends a missing part works.
 */
export interface SoundDraftAdapter {
  readonly available: { preview: boolean; save: boolean };
  /** Must be called from a user gesture. Resolves when the sound has finished or was stopped. */
  preview(draft: SoundDraft, options?: PreviewOptions): Promise<void>;
  /** Idempotent: silences every voice started by `preview`. */
  stop(): void;
  /** Optional device-level mute for the lab's own auditions. */
  setMuted?(muted: boolean): void;
  /** The signed-in creator's sounds for Inventory → My assets. */
  list(): Promise<UserSoundSummary[]>;
  load(id: string): Promise<{
    id: string;
    alias: string;
    version: number;
    name: string;
    draft: SoundDraft;
  }>;
  save(input: {
    draft: SoundDraft;
    name: string;
    /** Present when saving a new version of an existing sound. */
    existing?: { id: string; baseVersion: number };
  }): Promise<SavedSound & { version: number }>;
}

/** Inert adapter used until the canonical engine (#123) is wired: nothing sounds, nothing saves. */
export const disconnectedAdapter: SoundDraftAdapter = {
  available: { preview: false, save: false },
  preview: () => Promise.reject(new SoundAdapterError("unavailable")),
  stop: () => undefined,
  list: () => Promise.resolve([]),
  load: () => Promise.reject(new SoundAdapterError("unavailable")),
  save: () => Promise.reject(new SoundAdapterError("unavailable")),
};

/** Suggested BASIC line for a saved sound; mirrors the `SOUND "name"` grammar of built-ins. */
export const soundSnippet = (alias: string, kind: SoundKind = "sfx") =>
  kind === "instrument"
    ? `NOTE "C4",0.5,"@${alias}"`
    : `SOUND "@${alias}"`;
