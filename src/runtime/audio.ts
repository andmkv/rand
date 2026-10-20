import {
  assertSoundRecipe,
  type PitchedInstrumentV1,
  type SoundPreviewAdapter,
  type SoundPreviewRequest,
  type SoundRecipeV1,
  type SoundVoiceRecipeV1,
} from "../../shared/assets";
import { SpellError } from "./language";
import { soundAssets } from "./assets";

type AudioOwner = "program" | "preview";
type AudioNodeLike = AudioNode & { disconnect(): void };
interface ActiveVoice {
  id: number;
  owner: AudioOwner;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNodeLike[];
  oscillator?: OscillatorNode;
  remaining: number;
  stopped: boolean;
}

function ramp(param: AudioParam, value: number, at: number) {
  const method = (param as Partial<AudioParam>).linearRampToValueAtTime;
  if (typeof method === "function") method.call(param, value, at);
  else param.setValueAtTime(value, at);
}

/** One bounded WebAudio graph is shared by BASIC and the Sound Lab preview. */
export class SoundEngine {
  private contextValue?: AudioContext;
  private output?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private pulseWaves = new Map<number, PeriodicWave>();
  private voices = new Map<number, ActiveVoice>();
  private nextVoiceId = 1;
  private eventTimes: number[] = [];
  private masterVolumeValue = 0.2;
  private mutedValue = false;
  private stopVersionValue = 0;
  private visibilityHandler?: () => void;
  readonly maxVoices = 8;
  readonly maxEventsPerSecond = 32;
  readonly activeOscillators = new Set<OscillatorNode>();

  constructor(
    private readonly createContext: () => AudioContext = () => {
      if (typeof AudioContext === "undefined") throw new Error("AUDIO_UNAVAILABLE");
      return new AudioContext();
    },
    private readonly now: () => number = () => performance.now(),
  ) {}

  get context() { return this.contextValue; }
  set context(value: AudioContext | undefined) {
    this.contextValue = value;
    this.output = undefined;
    if (value) this.ensureOutput();
  }
  get voiceCount() { return this.voices.size; }
  get stopVersion() { return this.stopVersionValue; }
  get masterVolume() { return this.masterVolumeValue; }
  get muted() { return this.mutedValue; }

  /** Must be called from RUN or an explicit Preview user gesture. */
  unlock(): Promise<boolean> {
    if (!this.contextValue || this.contextValue.state === "closed") {
      this.contextValue = undefined;
      this.output = undefined;
      this.noiseBuffer = undefined;
      this.pulseWaves.clear();
      try { this.contextValue = this.createContext(); } catch { return Promise.resolve(false); }
    }
    this.ensureOutput();
    const context = this.contextValue;
    if (!context) return Promise.resolve(false);
    this.installVisibilityHandler();
    if (context.state === "running") return Promise.resolve(true);
    try {
      return context.resume().then(
        () => context.state === "running",
        () => false,
      );
    } catch {
      // Browsers can reject resume until another explicit user gesture.
      return Promise.resolve(false);
    }
  }

  setMasterVolume(value: number) {
    if (!Number.isFinite(value)) throw new SpellError("range", { value: "volume" });
    this.masterVolumeValue = Math.max(0, Math.min(0.25, value));
    this.applyMasterVolume();
  }

  setMuted(value: boolean) {
    this.mutedValue = Boolean(value);
    this.applyMasterVolume();
  }

  playSfx(recipe: SoundRecipeV1, owner: AudioOwner = "program") {
    try { assertSoundRecipe(recipe); } catch { throw new SpellError("sound"); }
    if (recipe.format !== "randusr.sfx") throw new SpellError("sound");
    return this.startVoice(
      recipe,
      recipe.startFrequencyHz,
      recipe.endFrequencyHz,
      recipe.durationMs / 1000,
      owner,
    );
  }

  playInstrument(
    recipe: PitchedInstrumentV1,
    frequencyHz: number,
    durationMs: number,
    owner: AudioOwner = "program",
  ) {
    try { assertSoundRecipe(recipe); } catch { throw new SpellError("sound"); }
    if (
      recipe.format !== "randusr.pitched-instrument" ||
      !Number.isFinite(frequencyHz) || frequencyHz < 30 || frequencyHz > 4000 ||
      !Number.isFinite(durationMs) || durationMs < 50 || durationMs > 5000
    ) throw new SpellError("range", { value: "sound" });
    const tuned = frequencyHz * 2 ** (recipe.tuningCents / 1200);
    if (tuned < 30 || tuned > 4000) throw new SpellError("range", { value: "sound" });
    return this.startVoice(recipe, tuned, tuned, durationMs / 1000, owner);
  }

  /** Compatibility path for legacy BEEP and NOTE, rendered by the same graph. */
  playTone(
    frequencyHz: number,
    durationSeconds: number,
    waveform: OscillatorType = "square",
    endFrequencyHz?: number,
    owner: AudioOwner = "program",
  ) {
    const end = endFrequencyHz ?? frequencyHz;
    if (
      !Number.isFinite(frequencyHz) || frequencyHz < 30 || frequencyHz > 4000 ||
      !Number.isFinite(end) || end < 30 || end > 4000 ||
      !Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 10
    ) throw new SpellError("range", { value: "sound" });
    const recipe: SoundVoiceRecipeV1 = {
      waveform: waveform === "triangle" || waveform === "sawtooth" || waveform === "sine" || waveform === "square" ? waveform : "square",
      pulseWidth: 0.5,
      noiseAmount: 0,
      volume: 0.8,
      envelope: { attackMs: 2, decayMs: 0, sustainLevel: 1, releaseMs: 12 },
    };
    return this.startVoice(recipe, frequencyHz, end, Math.max(0.01, durationSeconds), owner);
  }

  stopPreview() { this.stopOwner("preview"); }

  stopOwner(owner: AudioOwner) {
    for (const voice of [...this.voices.values()])
      if (voice.owner === owner) this.stopVoice(voice);
  }

  stopAll() {
    this.stopVersionValue++;
    for (const voice of [...this.voices.values()]) this.stopVoice(voice);
    this.eventTimes = [];
  }

  dispose() {
    this.stopAll();
    if (this.visibilityHandler && typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.visibilityHandler = undefined;
    const context = this.contextValue;
    this.contextValue = undefined;
    this.output = undefined;
    this.noiseBuffer = undefined;
    this.pulseWaves.clear();
    if (context) void context.close().catch(() => {});
  }

  private startVoice(
    recipe: SoundVoiceRecipeV1,
    startFrequencyHz: number,
    endFrequencyHz: number,
    durationSeconds: number,
    owner: AudioOwner,
  ) {
    if (this.mutedValue || !this.contextValue || this.contextValue.state === "closed") return null;
    const at = this.now();
    while (this.eventTimes.length && at - this.eventTimes[0] >= 1000)
      this.eventTimes.shift();
    if (this.eventTimes.length >= this.maxEventsPerSecond || this.voices.size >= this.maxVoices)
      return null; // Drop newest event. Never queue sounds or grow node count.
    const context = this.contextValue;
    this.ensureOutput();
    if (!this.output) return null;
    const startAt = context.currentTime + 0.004;
    const endAt = startAt + Math.max(0.01, durationSeconds);
    const volume = (0.12 * recipe.volume) / Math.sqrt(this.voices.size + 1);
    const voiceGain = context.createGain();
    const nodes: AudioNodeLike[] = [voiceGain];
    const sources: AudioScheduledSourceNode[] = [];
    let oscillator: OscillatorNode | undefined;
    voiceGain.gain.setValueAtTime(0, startAt);
    this.scheduleEnvelope(voiceGain.gain, recipe.envelope, volume, startAt, endAt);
    voiceGain.connect(this.output);

    if (recipe.waveform === "noise") {
      const noise = context.createBufferSource();
      noise.buffer = this.getNoiseBuffer(context);
      noise.loop = true;
      const noiseLevel = context.createGain();
      noiseLevel.gain.setValueAtTime(0.4 + recipe.noiseAmount * 0.6, startAt);
      noise.connect(noiseLevel);
      noiseLevel.connect(voiceGain);
      nodes.push(noiseLevel);
      sources.push(noise);
    } else {
      oscillator = context.createOscillator();
      if (recipe.waveform === "pulse") {
        try { oscillator.setPeriodicWave(this.getPulseWave(context, recipe.pulseWidth)); }
        catch { oscillator.type = "square"; }
      } else oscillator.type = recipe.waveform;
      oscillator.frequency.setValueAtTime(startFrequencyHz, startAt);
      if (startFrequencyHz !== endFrequencyHz)
        ramp(oscillator.frequency, endFrequencyHz, endAt);
      oscillator.connect(voiceGain);
      sources.push(oscillator);
      this.activeOscillators.add(oscillator);
      if (recipe.noiseAmount > 0) {
        const noise = context.createBufferSource();
        noise.buffer = this.getNoiseBuffer(context);
        noise.loop = true;
        const noiseLevel = context.createGain();
        noiseLevel.gain.setValueAtTime(recipe.noiseAmount / (1 + recipe.noiseAmount), startAt);
        noise.connect(noiseLevel);
        noiseLevel.connect(voiceGain);
        nodes.push(noiseLevel);
        sources.push(noise);
      }
    }

    const voice: ActiveVoice = {
      id: this.nextVoiceId++, owner, sources, nodes, oscillator,
      remaining: sources.length, stopped: false,
    };
    this.voices.set(voice.id, voice);
    this.eventTimes.push(at);
    for (const source of sources) {
      source.onended = () => {
        if (voice.stopped) return;
        voice.remaining--;
        if (voice.remaining <= 0) this.releaseVoice(voice);
      };
      source.start(startAt);
      source.stop(endAt);
    }
    return voice.id;
  }

  private scheduleEnvelope(
    gain: GainNode["gain"],
    envelope: SoundVoiceRecipeV1["envelope"],
    peak: number,
    startAt: number,
    endAt: number,
  ) {
    const attackEnd = startAt + envelope.attackMs / 1000;
    const decayEnd = attackEnd + envelope.decayMs / 1000;
    const releaseStart = Math.max(decayEnd, endAt - envelope.releaseMs / 1000);
    gain.setValueAtTime(0, startAt);
    if (attackEnd > startAt) ramp(gain, peak, attackEnd);
    else gain.setValueAtTime(peak, attackEnd);
    if (decayEnd > attackEnd)
      ramp(gain, peak * envelope.sustainLevel, decayEnd);
    else gain.setValueAtTime(peak * envelope.sustainLevel, decayEnd);
    if (releaseStart > decayEnd)
      gain.setValueAtTime(peak * envelope.sustainLevel, releaseStart);
    ramp(gain, 0, endAt);
  }

  private stopVoice(voice: ActiveVoice) {
    if (voice.stopped) return;
    voice.stopped = true;
    for (const source of voice.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
    }
    this.releaseVoice(voice);
  }

  private releaseVoice(voice: ActiveVoice) {
    this.voices.delete(voice.id);
    if (voice.oscillator) this.activeOscillators.delete(voice.oscillator);
    for (const source of voice.sources) {
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
  }

  private ensureOutput() {
    const context = this.contextValue;
    if (!context || this.output) return;
    this.output = context.createGain();
    this.output.gain.setValueAtTime(this.mutedValue ? 0 : this.masterVolumeValue, context.currentTime);
    this.output.connect(context.destination);
  }

  private applyMasterVolume() {
    if (!this.contextValue || !this.output) return;
    this.output.gain.setValueAtTime(
      this.mutedValue ? 0 : this.masterVolumeValue,
      this.contextValue.currentTime,
    );
  }

  private getNoiseBuffer(context: AudioContext) {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(2048, Math.floor(context.sampleRate / 4));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x6d2b79f5;
    for (let i = 0; i < data.length; i++) {
      state = Math.imul(state ^ (state >>> 15), state | 1);
      state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
      data[i] = ((state ^ (state >>> 14)) >>> 0) / 2147483648 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private createPulseWave(context: AudioContext, width: number) {
    const harmonics = 32;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) {
      real[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * width));
      imag[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * width);
    }
    return context.createPeriodicWave(real, imag, { disableNormalization: true });
  }

  /** Preview controls and long BASIC runs can vary pulse width; cap cached waves. */
  private getPulseWave(context: AudioContext, width: number) {
    const key = Math.round(width * 1000);
    const existing = this.pulseWaves.get(key);
    if (existing) {
      this.pulseWaves.delete(key);
      this.pulseWaves.set(key, existing);
      return existing;
    }
    const wave = this.createPulseWave(context, key / 1000);
    if (this.pulseWaves.size >= 16)
      this.pulseWaves.delete(this.pulseWaves.keys().next().value!);
    this.pulseWaves.set(key, wave);
    return wave;
  }

  private installVisibilityHandler() {
    if (this.visibilityHandler || typeof document === "undefined") return;
    this.visibilityHandler = () => {
      if (document.visibilityState !== "hidden") return;
      this.stopAll();
      try { void this.contextValue?.suspend().catch(() => {}); } catch { /* no-op */ }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }
}

export const sharedSoundEngine = new SoundEngine();

/** Sound Lab preview adapter. It shares the exact scheduler and synthesis used by BASIC. */
export const soundPreviewAdapter: SoundPreviewAdapter & {
  unlock(): Promise<boolean>;
  setMuted(muted: boolean): void;
  setMasterVolume(volume: number): void;
} = {
  unlock() { return sharedSoundEngine.unlock(); },
  async preview(request: SoundPreviewRequest) {
    const requestId = ++previewRequestId;
    const stopVersion = sharedSoundEngine.stopVersion;
    sharedSoundEngine.stopPreview();
    if (!(await sharedSoundEngine.unlock())) {
      if (requestId === previewRequestId) throw Object.assign(new Error("AUDIO_BLOCKED"), { code: "blocked" });
      return;
    }
    if (requestId !== previewRequestId || stopVersion !== sharedSoundEngine.stopVersion) return;
    let voiceId: number | null;
    if ("frequencyHz" in request)
      voiceId = sharedSoundEngine.playInstrument(
        request.recipe,
        request.frequencyHz,
        request.durationMs,
        "preview",
      );
    else voiceId = sharedSoundEngine.playSfx(request.recipe, "preview");
    if (voiceId === null && !sharedSoundEngine.muted)
      throw Object.assign(new Error("AUDIO_LIMIT"), { code: "failed" });
  },
  stop() { previewRequestId++; sharedSoundEngine.stopPreview(); },
  setMuted(muted) { sharedSoundEngine.setMuted(muted); },
  setMasterVolume(volume) { sharedSoundEngine.setMasterVolume(volume); },
};

let previewRequestId = 0;

export class AudioToy {
  private projectSounds = new Map<string, SoundRecipeV1>();
  constructor(private readonly engine: SoundEngine = sharedSoundEngine) {}
  get context() { return this.engine.context; }
  set context(value: AudioContext | undefined) { this.engine.context = value; }
  get nodes() { return this.engine.activeOscillators; }
  get muted() { return this.engine.muted; }
  set muted(value: boolean) { this.engine.setMuted(value); }
  get voiceCount() { return this.engine.voiceCount; }
  unlock() { return this.engine.unlock(); }
  stop() { this.engine.stopAll(); }

  setProjectSounds(bindings: { alias: string; recipe: SoundRecipeV1 }[] = []) {
    this.projectSounds = new Map(bindings.map((binding) => [binding.alias, binding.recipe]));
  }

  effect(name: string) {
    if (name.startsWith("@")) {
      const recipe = this.projectSounds.get(name);
      if (!recipe) throw new SpellError("sound");
      if (recipe.format === "randusr.sfx") this.engine.playSfx(recipe);
      else this.engine.playInstrument(recipe, 440, 200);
      return;
    }
    const asset = soundAssets.find((item) => item.id === name.toLowerCase());
    if (!asset) throw new SpellError("sound");
    this.engine.playSfx(asset.recipe);
  }

  instrument(alias: string): PitchedInstrumentV1 {
    const recipe = this.projectSounds.get(alias);
    if (!recipe || recipe.format !== "randusr.pitched-instrument")
      throw new SpellError("sound");
    return recipe;
  }

  playInstrument(alias: string, frequencyHz: number, durationSeconds: number) {
    const recipe = this.instrument(alias);
    this.engine.playInstrument(recipe, frequencyHz, durationSeconds * 1000);
  }

  tone(frequency: number, duration: number, type: OscillatorType = "square", end?: number) {
    this.engine.playTone(frequency, duration, type, end);
  }

  note(name: string) {
    const match = name.toUpperCase().match(/^([A-G])([#B]?)([0-8])$/);
    if (!match) throw new SpellError("range", { value: "NOTE" });
    const semitones: Record<string, number> = {
      C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2,
    };
    return (
      440 *
      2 **
        ((semitones[match[1]] +
          (match[2] === "#" ? 1 : match[2] === "B" ? -1 : 0) +
          (Number(match[3]) - 4) * 12) /
          12)
    );
  }
}
