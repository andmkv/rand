import {
  envelopeAt,
  limits,
  pitchAt,
  pitchToStep,
  pitchSteps,
  type SoundDraft,
  type Waveform,
} from "./sound-draft";

/** Pure geometry for the Sound Lab graph; every point derives from the draft, nothing is canned. */
export const graphSize = { width: 600, height: 240 } as const;
const samples = 120;

export interface GraphTrack {
  top: number;
  height: number;
}
/** Three stacked tracks inside the viewBox: pitch, volume, wave. */
export const tracks: Record<"pitch" | "volume" | "wave", GraphTrack> = {
  pitch: { top: 4, height: 70 },
  volume: { top: 84, height: 70 },
  wave: { top: 164, height: 72 },
};

const fixed = (n: number) => Math.round(n * 10) / 10;

/** Pitch glide (log scale, so equal intervals look equal). */
export function pitchPath(draft: SoundDraft, note?: number): string {
  const { top, height } = tracks.pitch;
  const points: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (i / samples) * draft.duration;
    const hz =
      draft.kind === "instrument" && note ? note : pitchAt(draft, t);
    const y = top + height - (pitchToStep(hz) / pitchSteps) * height;
    points.push(
      `${i === 0 ? "M" : "L"}${fixed((i / samples) * graphSize.width)} ${fixed(y)}`,
    );
  }
  return points.join(" ");
}

/** Volume over time: the envelope scaled by the volume control. */
export function volumePath(draft: SoundDraft): { line: string; area: string } {
  const { top, height } = tracks.volume;
  const points: [number, number][] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (i / samples) * draft.duration;
    points.push([
      (i / samples) * graphSize.width,
      top + height - envelopeAt(draft, t) * draft.volume * height,
    ]);
  }
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${fixed(x)} ${fixed(y)}`)
    .join(" ");
  const base = top + height;
  return { line, area: `${line} L${graphSize.width} ${base} L0 ${base} Z` };
}

function waveSample(
  waveform: Waveform,
  phase: number,
  noise: () => number,
  pulseWidth: number,
) {
  const p = phase - Math.floor(phase);
  switch (waveform) {
    case "square":
      return p < pulseWidth ? 1 : -1;
    case "triangle":
      return p < 0.5 ? p * 4 - 1 : 3 - p * 4;
    case "saw":
      return p * 2 - 1;
    case "sine":
      return Math.sin(p * Math.PI * 2);
    case "noise":
      return noise() * 2 - 1;
  }
}
/** Deterministic noise so the picture does not flicker between renders. */
export function seededNoise(seed = 7): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
/**
 * Waveform schematic: cycle density follows the pitch glide (compressed onto 2–12 visible cycles
 * so low and high notes both stay readable), height follows envelope × volume.
 */
export function wavePath(draft: SoundDraft, note?: number): string {
  const { top, height } = tracks.wave;
  const mid = top + height / 2;
  const half = height / 2 - 2;
  const noise = seededNoise();
  const points = 360;
  let phase = 0;
  const parts: string[] = [];
  for (let i = 0; i <= points; i += 1) {
    const t = (i / points) * draft.duration;
    const hz = draft.kind === "instrument" && note ? note : pitchAt(draft, t);
    const cycles = 2 + (pitchToStep(hz) / pitchSteps) * 10;
    phase += cycles / points;
    const amplitude = Math.max(0.04, envelopeAt(draft, t)) * draft.volume;
    const tone = waveSample(draft.waveform, phase, noise, draft.pulseWidth);
    // The noise layer sits under any tone; it is the whole signal for the noise waveform.
    const value =
      draft.waveform === "noise"
        ? tone
        : tone * (1 - draft.noiseAmount * 0.5) +
          (noise() * 2 - 1) * draft.noiseAmount * 0.5;
    const y = mid - value * amplitude * half;
    parts.push(
      `${i === 0 ? "M" : "L"}${fixed((i / points) * graphSize.width)} ${fixed(y)}`,
    );
  }
  return parts.join(" ");
}

/** Envelope stage boundaries as x positions (0..width), for labelled markers. */
export function stageMarkers(draft: SoundDraft) {
  const x = (seconds: number) =>
    fixed((seconds / draft.duration) * graphSize.width);
  const releaseStart = Math.max(
    draft.attack + draft.decay,
    draft.duration - draft.release,
  );
  return {
    attack: x(draft.attack),
    decay: x(draft.attack + draft.decay),
    release: x(releaseStart),
  };
}

export const pitchAxis = [limits.pitchMin, 100, 400, 1600, limits.pitchMax];
export const pitchY = (hz: number) => {
  const { top, height } = tracks.pitch;
  return fixed(top + height - (pitchToStep(hz) / pitchSteps) * height);
};
