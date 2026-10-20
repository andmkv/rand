import { describe, expect, it } from "vitest";
import {
  disconnectedAdapter,
  emptyHistory,
  envelopeAt,
  instrumentDraft,
  limits,
  matchingPreset,
  noteName,
  noteToHz,
  normalizeDraft,
  pitchAt,
  pitchDirection,
  pitchToStep,
  presetDraft,
  presetIds,
  randomizeDraft,
  recordEdit,
  redo,
  soundSnippet,
  stepToPitch,
  swapPitch,
  undo,
  withDirection,
  type SoundDraft,
} from "../src/sound-draft";
import {
  graphSize,
  pitchPath,
  seededNoise,
  stageMarkers,
  volumePath,
  wavePath,
} from "../src/sound-graph";

const laser = () => presetDraft("laser");

describe("sound draft normalization", () => {
  it("clamps every value and keeps the envelope inside the sound", () => {
    const draft = normalizeDraft({
      ...laser(),
      pitchStart: 1,
      pitchEnd: 99999,
      duration: 99,
      volume: 4,
      attack: 3,
      decay: 3,
      sustain: 9,
      release: 3,
    });
    expect(draft.pitchStart).toBe(limits.pitchMin);
    expect(draft.pitchEnd).toBe(limits.pitchMax);
    expect(draft.duration).toBe(limits.durationMax);
    expect(draft.volume).toBe(1);
    expect(draft.sustain).toBe(1);
    expect(draft.attack + draft.decay + draft.release).toBeLessThanOrEqual(
      draft.duration + 0.0001,
    );
  });
  it("rejects NaN and Infinity instead of storing them", () => {
    const draft = normalizeDraft({
      ...laser(),
      pitchStart: NaN,
      duration: Infinity,
      volume: -Infinity,
    });
    for (const value of [draft.pitchStart, draft.duration, draft.volume])
      expect(Number.isFinite(value)).toBe(true);
  });
  it("lets the moved envelope stage win and shrinks the others", () => {
    const base = normalizeDraft({ ...laser(), duration: 1, attack: 0.2, decay: 0.3, release: 0.3 });
    const next = normalizeDraft({ ...base, attack: 0.9 }, "attack");
    expect(next.attack).toBe(0.9);
    expect(next.decay + next.release).toBeLessThanOrEqual(0.1001);
  });
  it("shortening the sound shortens the envelope with it", () => {
    const next = normalizeDraft({ ...laser(), duration: 0.1 }, "duration");
    expect(next.attack + next.decay + next.release).toBeLessThanOrEqual(0.1001);
  });
});

describe("presets", () => {
  it("offers the eight recipes, each valid and distinct", () => {
    expect(presetIds).toEqual(["laser", "coin", "jump", "explosion", "powerup", "blip", "drum", "wind"]);
    const seen = new Set<string>();
    for (const id of presetIds) {
      const draft = presetDraft(id);
      expect(normalizeDraft(draft)).toEqual(draft);
      expect(matchingPreset(draft)).toBe(id);
      seen.add(JSON.stringify(draft));
    }
    expect(seen.size).toBe(8);
  });
  it("starts the laser high and sweeps down, the coin up", () => {
    expect(pitchDirection(presetDraft("laser"))).toBe("falling");
    expect(pitchDirection(presetDraft("coin"))).toBe("rising");
    expect(pitchDirection(presetDraft("blip"))).toBe("flat");
  });
  it("stops matching a preset after any edit", () => {
    expect(matchingPreset({ ...laser(), volume: 0.61 })).toBeNull();
  });
});

describe("pitch helpers", () => {
  it("maps slider steps to pitch on a musical scale and back", () => {
    expect(stepToPitch(0)).toBe(limits.pitchMin);
    expect(stepToPitch(1000)).toBe(limits.pitchMax);
    for (const hz of [60, 262, 440, 1800, 3999])
      expect(Math.abs(stepToPitch(pitchToStep(hz)) - hz) / hz).toBeLessThan(0.01);
  });
  it("names notes against A4 = 440 Hz", () => {
    expect(noteName(440)).toBe("A4");
    expect(noteName(261.63)).toBe("C4");
    expect(Math.round(noteToHz(69))).toBe(440);
    expect(Math.round(noteToHz(60))).toBe(262);
  });
  it("glides exponentially from start to end", () => {
    const draft = { ...laser(), pitchStart: 100, pitchEnd: 400, duration: 1 };
    expect(pitchAt(draft, 0)).toBeCloseTo(100);
    expect(pitchAt(draft, 0.5)).toBeCloseTo(200);
    expect(pitchAt(draft, 1)).toBeCloseTo(400);
    expect(pitchAt(draft, 9)).toBeCloseTo(400);
  });
  it("changes direction while keeping the interval, and swaps", () => {
    const falling = laser();
    const rising = withDirection(falling, "rising");
    expect(pitchDirection(rising)).toBe("rising");
    expect(rising.pitchStart).toBe(falling.pitchStart);
    expect(withDirection(rising, "flat").pitchEnd).toBe(rising.pitchStart);
    const swapped = swapPitch(falling);
    expect(swapped.pitchStart).toBe(falling.pitchEnd);
    expect(swapped.pitchEnd).toBe(falling.pitchStart);
  });
});

describe("envelope", () => {
  const draft: SoundDraft = normalizeDraft({ ...laser(), duration: 1, attack: 0.2, decay: 0.2, sustain: 0.5, release: 0.2 });
  it("rises, decays to sustain, holds, then releases to silence", () => {
    expect(envelopeAt(draft, 0)).toBe(0);
    expect(envelopeAt(draft, 0.1)).toBeCloseTo(0.5);
    expect(envelopeAt(draft, 0.2)).toBeCloseTo(1);
    expect(envelopeAt(draft, 0.4)).toBeCloseTo(0.5);
    expect(envelopeAt(draft, 0.6)).toBeCloseTo(0.5);
    expect(envelopeAt(draft, 0.9)).toBeCloseTo(0.25);
    expect(envelopeAt(draft, 1)).toBe(0);
    for (let t = 0; t <= 1; t += 0.01) {
      const v = envelopeAt(draft, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("randomize", () => {
  it("always produces a valid, bounded, pleasant draft", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i += 1) {
      const next = randomizeDraft(laser(), random);
      expect(normalizeDraft(next)).toEqual(next);
      expect(next.volume).toBeLessThanOrEqual(0.7);
      expect(next.duration).toBeLessThanOrEqual(0.9);
    }
  });
  it("keeps an instrument glide-free", () => {
    const next = randomizeDraft(instrumentDraft(), () => 0.42);
    expect(next.kind).toBe("instrument");
    expect(next.pitchEnd).toBe(next.pitchStart);
  });
});

describe("history", () => {
  const a = laser();
  const b = { ...a, volume: 0.3 };
  const c = { ...a, volume: 0.2 };
  it("undoes and redoes in order and clears redo on a new edit", () => {
    let history = recordEdit(emptyHistory, a, "volume", 0);
    history = recordEdit(history, b, "waveform", 5000);
    const back = undo(history, c)!;
    expect(back.draft).toEqual(b);
    const forward = redo(back.history, back.draft)!;
    expect(forward.draft).toEqual(c);
    expect(undo(emptyHistory, a)).toBeNull();
    expect(redo(emptyHistory, a)).toBeNull();
    expect(recordEdit(back.history, b, "x", 9000).future).toHaveLength(0);
  });
  it("merges a slider drag into one undo step", () => {
    let history = recordEdit(emptyHistory, a, "volume", 0);
    history = recordEdit(history, b, "volume", 100);
    history = recordEdit(history, c, "volume", 200);
    expect(history.past).toEqual([a]);
  });
  it("is bounded", () => {
    let history = emptyHistory;
    for (let i = 0; i < limits.history + 50; i += 1)
      history = recordEdit(history, { ...a, volume: (i % 90) / 100 }, "", i);
    expect(history.past).toHaveLength(limits.history);
  });
});

describe("graph geometry follows the draft", () => {
  it("draws a falling pitch line downward and a rising one upward", () => {
    const y = (path: string) => [...path.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    const falling = y(pitchPath(laser()));
    const rising = y(pitchPath(withDirection(laser(), "rising")));
    expect(falling[falling.length - 1]).toBeGreaterThan(falling[0]);
    expect(rising[rising.length - 1]).toBeLessThan(rising[0]);
  });
  it("scales the volume area with the volume control", () => {
    const top = (area: string) => Math.min(...[...area.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1])));
    expect(top(volumePath({ ...laser(), volume: 1 }).area)).toBeLessThan(
      top(volumePath({ ...laser(), volume: 0.3 }).area),
    );
  });
  it("changes the waveform path with the waveform and is deterministic for noise", () => {
    const square = wavePath(laser());
    expect(wavePath({ ...laser(), waveform: "sine" })).not.toBe(square);
    const noise = { ...laser(), waveform: "noise" as const };
    expect(wavePath(noise)).toBe(wavePath(noise));
    const n = seededNoise(3);
    expect([n(), n()]).toEqual([seededNoise(3)(), (() => { const m = seededNoise(3); m(); return m(); })()]);
  });
  it("places envelope markers inside the graph", () => {
    const m = stageMarkers(laser());
    for (const x of Object.values(m)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(graphSize.width);
    }
  });
  it("uses the played note for an instrument", () => {
    const hz = (path: string) => path;
    expect(hz(pitchPath(instrumentDraft(), 880))).not.toBe(hz(pitchPath(instrumentDraft(), 110)));
  });
});

describe("adapter seam", () => {
  it("the disconnected adapter claims nothing works and never resolves a preview or save", async () => {
    expect(disconnectedAdapter.available).toEqual({ preview: false, save: false });
    await expect(disconnectedAdapter.preview(laser())).rejects.toMatchObject({ code: "unavailable" });
    await expect(disconnectedAdapter.save({ draft: laser(), name: "x" })).rejects.toMatchObject({ code: "unavailable" });
    await expect(disconnectedAdapter.list()).resolves.toEqual([]);
    expect(() => disconnectedAdapter.stop()).not.toThrow();
  });
  it("inserts the same SOUND grammar as built-ins with an alias", () => {
    expect(soundSnippet("my_laser")).toBe('SOUND "@my_laser"');
    expect(soundSnippet("keys", "instrument")).toBe('NOTE "C4",0.5,"@keys"');
  });
});
