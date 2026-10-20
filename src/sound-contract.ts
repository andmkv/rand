/** Bridge the Sound Lab's editing draft to the shared, canonical sound contract. */
import {
  assertSoundRecipe,
  type PitchedInstrumentV1,
  type SfxRecipeV1,
  type SoundAssetAdapter,
  type SoundPreviewAdapter,
  type SoundPreviewRequest,
  type SoundRecipeV1,
  type SoundVoiceRecipeV1,
  type SoundWaveformV1,
  type UserSoundAsset,
  type UserSoundAssetSummary,
} from "../shared/assets";
import {
  normalizeDraft,
  SoundAdapterError,
  type SavedSound,
  type SoundDraft,
  type SoundDraftAdapter,
  type UserSoundSummary,
  type Waveform,
} from "./sound-draft";

export type {
  PitchedInstrumentV1,
  SfxRecipeV1,
  SoundAssetAdapter,
  SoundPreviewAdapter,
  SoundPreviewRequest,
  SoundRecipeV1,
  SoundVoiceRecipeV1,
  SoundWaveformV1,
  UserSoundAsset,
  UserSoundAssetSummary,
};

const ms = (seconds: number) => Math.round(seconds * 1000);
const seconds = (value: number) => value / 1000;

const toWire: Record<Waveform, SoundWaveformV1> = {
  square: "square",
  triangle: "triangle",
  saw: "sawtooth",
  sine: "sine",
  noise: "noise",
};

/** The recipe the engine will play and the library will store for this draft. */
export function draftToRecipe(input: SoundDraft): SoundRecipeV1 {
  const draft = normalizeDraft(input);
  const voice: SoundVoiceRecipeV1 = {
    // A square wave whose width was moved off 50% is the engine's `pulse` waveform.
    waveform:
      draft.waveform === "square" && draft.pulseWidth !== 0.5
        ? "pulse"
        : toWire[draft.waveform],
    pulseWidth: draft.pulseWidth,
    noiseAmount: draft.waveform === "noise" ? 0 : draft.noiseAmount,
    volume: draft.volume,
    envelope: {
      attackMs: ms(draft.attack),
      decayMs: ms(draft.decay),
      sustainLevel: draft.sustain,
      releaseMs: ms(draft.release),
    },
  };
  if (draft.kind === "instrument")
    return {
      format: "randusr.pitched-instrument",
      version: 1,
      ...voice,
      tuningCents: draft.tuning,
    };
  return {
    format: "randusr.sfx",
    version: 1,
    ...voice,
    startFrequencyHz: draft.pitchStart,
    endFrequencyHz: draft.pitchEnd,
    durationMs: ms(draft.duration),
  };
}

const fromWire: Record<SoundWaveformV1, Waveform> = {
  square: "square",
  pulse: "square",
  triangle: "triangle",
  sawtooth: "saw",
  sine: "sine",
  noise: "noise",
};
/** Loads a stored recipe back into an editable draft (audition length is the editor's choice). */
export function recipeToDraft(recipe: SoundRecipeV1): SoundDraft {
  const base = {
    waveform: fromWire[recipe.waveform],
    pulseWidth: recipe.pulseWidth,
    noiseAmount: recipe.noiseAmount,
    volume: recipe.volume,
    attack: seconds(recipe.envelope.attackMs),
    decay: seconds(recipe.envelope.decayMs),
    sustain: recipe.envelope.sustainLevel,
    release: seconds(recipe.envelope.releaseMs),
  };
  if (recipe.format === "randusr.pitched-instrument")
    return normalizeDraft({
      kind: "instrument",
      ...base,
      pitchStart: 262,
      pitchEnd: 262,
      duration: 0.6,
      tuning: recipe.tuningCents,
    });
  return normalizeDraft({
    kind: "sfx",
    ...base,
    pitchStart: recipe.startFrequencyHz,
    pitchEnd: recipe.endFrequencyHz,
    duration: seconds(recipe.durationMs),
    tuning: 0,
  });
}

/** Convenience boolean wrapper over the canonical shared validator. */
export function recipeWithinContract(recipe: SoundRecipeV1): boolean {
  try {
    assertSoundRecipe(recipe);
    return true;
  } catch {
    return false;
  }
}

const versionOf = (asset: UserSoundAsset) => asset.selectedVersion.number;
const bare = (alias: string) => alias.replace(/^@/, "");
const saved = (asset: UserSoundAsset) => ({
  id: asset.id,
  alias: bare(asset.alias),
  name: asset.name,
  version: versionOf(asset),
});
const summary = (item: UserSoundAssetSummary): UserSoundSummary => ({
  id: item.id,
  alias: bare(item.alias),
  name: item.name,
  kind: item.type,
});
const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";

/**
 * The Sound Lab's adapter over the canonical contract. The returned promise settles after the
 * sound's own length or on `stop()` and rejects when AudioContext cannot unlock or start.
 * Pass `assets: null` for guests: Preview works, Save is reported unavailable.
 */
export function createContractAdapter(input: {
  preview: SoundPreviewAdapter;
  assets: SoundAssetAdapter | null;
}): SoundDraftAdapter {
  let settle: (() => void) | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    const done = settle;
    settle = null;
    done?.();
  };
  const { assets } = input;
  return {
    available: { preview: true, save: assets !== null },
    preview(draft, options) {
      cancel();
      const requestId = ++generation;
      input.preview.stop();
      const recipe = draftToRecipe(draft);
      const length =
        recipe.format === "randusr.sfx" ? recipe.durationMs : ms(draft.duration);
      const request: SoundPreviewRequest = recipe.format === "randusr.sfx"
        ? { recipe }
        : {
            recipe,
            frequencyHz: options?.noteHz ?? 262,
            durationMs: ms(draft.duration),
          };
      let promiseResolve!: () => void;
      let promiseReject!: (error: unknown) => void;
      const playback = new Promise<void>((resolve, reject) => {
        promiseResolve = resolve;
        promiseReject = reject;
      });
      settle = promiseResolve;
      let started: Promise<void>;
      try {
        // Do not defer this call: browsers require resume() in the original gesture stack.
        started = input.preview.preview(request);
      } catch (error) {
        settle = null;
        return Promise.reject(new SoundAdapterError(
          errorCode(error) === "blocked" ? "blocked" : "failed",
        ));
      }
      void started.then(() => {
        if (requestId !== generation) return;
        timer = setTimeout(() => {
          if (requestId !== generation) return;
          settle = null;
          promiseResolve();
        }, length + recipe.envelope.releaseMs);
      }, (error) => {
        if (requestId !== generation) return;
        settle = null;
        promiseReject(new SoundAdapterError(
          errorCode(error) === "blocked" ? "blocked" : "failed",
        ));
      });
      return playback;
    },
    stop() {
      generation++;
      input.preview.stop();
      cancel();
    },
    setMuted: (muted) => input.preview.setMuted(muted),
    async list() {
      return assets ? (await assets.list()).map(summary) : [];
    },
    async load(id) {
      if (!assets) throw new SoundAdapterError("unavailable");
      const asset = await assets.load(id);
      return {
        id: asset.id,
        alias: bare(asset.alias),
        version: versionOf(asset),
        name: asset.name,
        draft: recipeToDraft(asset.recipe),
      };
    },
    async save({ draft, name, existing }): Promise<SavedSound & { version: number }> {
      if (!assets) throw new SoundAdapterError("unavailable");
      const recipe = draftToRecipe(draft);
      if (!recipeWithinContract(recipe)) throw new SoundAdapterError("save-failed");
      try {
        let asset = existing
          ? await assets.saveVersion(existing.id, {
              baseVersion: existing.baseVersion,
              recipe,
            })
          : await assets.create({ name, recipe });
        // Versions carry the recipe only; a changed name is a separate rename, as for sprites.
        if (asset.name !== name) {
          await assets.rename(asset.id, name);
          asset = { ...asset, name };
        }
        return saved(asset);
      } catch (error) {
        const code =
          typeof error === "object" && error && "code" in error
            ? String((error as { code: unknown }).code)
            : "";
        throw new SoundAdapterError(
          code === "VERSION_CONFLICT" ? "conflict" : "save-failed",
        );
      }
    },
  };
}
