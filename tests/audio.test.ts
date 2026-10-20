import { describe, expect, it } from "vitest";
import { assertSoundRecipe, type PitchedInstrumentV1, type SfxRecipeV1 } from "../shared/assets";
import { AudioToy, SoundEngine } from "../src/runtime/audio";
import { soundAssets } from "../src/runtime/assets";
import { Engine } from "../src/runtime/engine";
import { World } from "../src/runtime/world";

class FakeParam {
  events: { kind: string; value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number) { this.events.push({ kind: "set", value, at }); }
  linearRampToValueAtTime(value: number, at: number) { this.events.push({ kind: "linear", value, at }); }
}

class FakeNode {
  connections: unknown[] = [];
  disconnected = 0;
  connect(node: unknown) { this.connections.push(node); }
  disconnect() { this.disconnected++; }
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  startedAt?: number;
  stoppedAt?: number;
  start(at: number) { this.startedAt = at; }
  stop(at?: number) { this.stoppedAt = at ?? 0; }
}

class FakeOscillator extends FakeSource {
  type: OscillatorType = "sine";
  frequency = new FakeParam();
  period?: PeriodicWave;
  setPeriodicWave(wave: PeriodicWave) { this.period = wave; }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeBuffer {
  readonly samples: Float32Array;
  constructor(length: number) { this.samples = new Float32Array(length); }
  getChannelData() { return this.samples; }
}

class FakeBufferSource extends FakeSource {
  buffer?: AudioBuffer;
  loop = false;
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state: AudioContextState = "running";
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  bufferSources: FakeBufferSource[] = [];
  activeSources = new Set<FakeSource>();
  gains: FakeGain[] = [];
  bufferCreations = 0;
  periodicWaves = 0;
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); this.activeSources.add(node); return node; }
  createBufferSource() { const node = new FakeBufferSource(); this.bufferSources.push(node); this.activeSources.add(node); return node; }
  createBuffer(_channels: number, length: number) { this.bufferCreations++; return new FakeBuffer(length); }
  createPeriodicWave() { this.periodicWaves++; return {} as PeriodicWave; }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const source of [...this.activeSources]) {
      if (source.stoppedAt !== undefined && source.stoppedAt <= this.currentTime && source.onended) {
        const ended = source.onended;
        source.onended = null;
        ended();
      }
      if (source.stoppedAt !== undefined && source.stoppedAt <= this.currentTime)
        this.activeSources.delete(source);
    }
  }
}

const instrument: PitchedInstrumentV1 = {
  format: "randusr.pitched-instrument",
  version: 1,
  waveform: "triangle",
  pulseWidth: 0.5,
  noiseAmount: 0,
  volume: 0.8,
  envelope: { attackMs: 10, decayMs: 25, sustainLevel: 0.5, releaseMs: 50 },
  tuningCents: 0,
};

function setup() {
  const context = new FakeAudioContext();
  const time = { ms: 0 };
  const engine = new SoundEngine(
    () => context as unknown as AudioContext,
    () => time.ms,
  );
  engine.unlock();
  return { context, engine, time };
}

describe("shared sound engine", () => {
  it("schedules pitch sweep and ADSR, then disconnects every node on end", () => {
    const { context, engine } = setup();
    const laser = soundAssets.find((asset) => asset.id === "laser")!.recipe;
    engine.playSfx(laser, "program");
    const oscillator = context.oscillators[0];
    expect(oscillator.frequency.events.map((item) => item.value)).toEqual([1600, 80]);
    expect(oscillator.frequency.events[1].kind).toBe("linear");
    expect(context.gains[1].gain.events.some((item) => item.kind === "linear")).toBe(true);
    expect(engine.voiceCount).toBe(1);
    context.advance(0.23);
    expect(engine.voiceCount).toBe(0);
    expect(engine.activeOscillators.size).toBe(0);
    expect(oscillator.disconnected).toBe(1);
  });

  it("uses pulse waves and one cached bounded noise buffer", () => {
    const { context, engine } = setup();
    engine.playSfx(soundAssets.find((asset) => asset.id === "blip")!.recipe);
    expect(context.periodicWaves).toBe(1);
    engine.stopAll();
    const drum = soundAssets.find((asset) => asset.id === "drum")!.recipe;
    engine.playSfx(drum);
    engine.stopAll();
    engine.playSfx(drum);
    expect(context.bufferCreations).toBe(1);
    expect(context.bufferSources.length).toBe(2);
    expect(context.bufferSources.every((node) => node.loop)).toBe(true);
  });

  it("caps voices and events without a growing playback queue", () => {
    const { context, engine } = setup();
    const blip = soundAssets.find((asset) => asset.id === "blip")!.recipe;
    for (let i = 0; i < 8; i++) expect(engine.playSfx(blip)).not.toBeNull();
    expect(engine.playSfx(blip)).toBeNull();
    expect(engine.voiceCount).toBe(8);
    expect(context.oscillators.length).toBe(8);
    engine.stopAll();
    // Audio events are throttled at 32 per injected clock-second, even if voices end immediately.
    const timed = setup();
    for (let i = 0; i < 24; i++) {
      expect(timed.engine.playSfx(blip)).not.toBeNull();
      timed.context.advance(0.13);
    }
    for (let i = 0; i < 8; i++) {
      expect(timed.engine.playSfx(blip)).not.toBeNull();
      timed.context.advance(0.13);
    }
    expect(timed.engine.playSfx(blip)).toBeNull();
    expect(timed.engine.voiceCount).toBe(0);
    timed.engine.stopAll();
    expect(timed.engine.voiceCount).toBe(0);
  });

  it("keeps ten minutes of simulated SFX calls bounded", () => {
    const { context, engine, time } = setup();
    const blip = soundAssets.find((asset) => asset.id === "blip")!.recipe;
    for (let i = 0; i < 30_000; i++) {
      time.ms = i * 20;
      engine.playSfx(blip);
      context.advance(0.02);
      expect(engine.voiceCount).toBeLessThanOrEqual(8);
      expect(engine.activeOscillators.size).toBeLessThanOrEqual(8);
    }
    expect(engine.voiceCount).toBe(0);
    expect(engine.activeOscillators.size).toBe(0);
    expect(context.oscillators.every((node) => node.disconnected === 1)).toBe(true);
    expect(context.periodicWaves).toBeLessThanOrEqual(16);
    expect(engine.maxEventsPerSecond).toBe(32);
  });

  it("recreates a context closed by the app lifecycle", () => {
    const first = new FakeAudioContext();
    const second = new FakeAudioContext();
    let contexts = 0;
    const engine = new SoundEngine(
      () => (++contexts === 1 ? first : second) as unknown as AudioContext,
      () => 0,
    );
    engine.unlock();
    first.close();
    engine.unlock();
    engine.playSfx(soundAssets.find((asset) => asset.id === "laser")!.recipe);
    expect(contexts).toBe(2);
    expect(second.oscillators).toHaveLength(1);
  });

  it("bounds a ten-minute interpreter audio clock to the 32-event rolling window", () => {
    const time = { ms: 0 };
    const engine = new Engine(new World(), undefined, () => time.ms);
    engine.longRunning = true;
    for (let i = 0; i < 30_000; i++) {
      time.ms = i * 20;
      engine.audioEvent();
      expect(engine.audioTimes.length).toBeLessThanOrEqual(32);
    }
    expect(engine.audioTimes.length).toBe(32);
    expect(engine.audioEvents).toBe(19_200);
  });

  it("keeps Preview cancellation scoped and STOP cancels program and preview voices", () => {
    const { context, engine } = setup();
    engine.playSfx(soundAssets[0].recipe, "program");
    engine.playInstrument(instrument, 440, 200, "preview");
    expect(engine.voiceCount).toBe(2);
    engine.stopPreview();
    expect(engine.voiceCount).toBe(1);
    const toy = new AudioToy(engine);
    toy.stop();
    expect(engine.voiceCount).toBe(0);
    expect(context.oscillators.every((node) => node.disconnected === 1)).toBe(true);
  });

  it("retains all eight built-in recipes as bounded serializable data", () => {
    expect(soundAssets.map((asset) => asset.id)).toEqual([
      "explosion", "coin", "laser", "jump", "power-up", "blip", "drum", "wind",
    ]);
    for (const asset of soundAssets) expect(() => assertSoundRecipe(asset.recipe)).not.toThrow();
  });

  it("follows an instrument note frequency through the same scheduler", () => {
    const { context, engine } = setup();
    engine.playInstrument(instrument, 261.63, 500);
    engine.playInstrument(instrument, 523.25, 500);
    expect(context.oscillators.map((node) => node.frequency.events[0].value)).toEqual([261.63, 523.25]);
    expect(engine.voiceCount).toBe(2);
  });

  it("runs aliased SFX and several pitches through one BASIC sound engine", async () => {
    const { context, engine } = setup();
    const world = new World();
    world.audio = new AudioToy(engine);
    world.setProjectAssets({
      version: 1,
      sprites: [],
      sounds: [
        { type: "sfx", alias: "@laser", name: "Laser", recipe: soundAssets.find((asset) => asset.id === "laser")!.recipe },
        { type: "instrument", alias: "@keys", name: "Keys", recipe: instrument },
      ],
    });
    const program = new Engine(world);
    program.wait = async () => {};
    await program.run('SOUND "@laser"\nNOTE "C4",0.5,"@keys"\nPLAY "C4 E4","@keys"');
    expect(context.oscillators.map((oscillator) => oscillator.frequency.events[0].value)).toEqual([
      1600,
      261.6255653005986,
      261.6255653005986,
      329.6275569128699,
    ]);
    expect(engine.voiceCount).toBe(4);
    program.stop();
    expect(engine.voiceCount).toBe(0);
    expect(context.oscillators.every((node) => node.disconnected === 1)).toBe(true);
  });

  it("rejects corrupt or excessive recipes before creating audio nodes", () => {
    const { context, engine } = setup();
    const invalid = { ...soundAssets[0].recipe, durationMs: 6000 } as SfxRecipeV1;
    expect(() => engine.playSfx(invalid)).toThrow();
    expect(context.oscillators).toHaveLength(0);
    expect(() => engine.playInstrument(instrument, 9000, 300)).toThrow();
  });
});
