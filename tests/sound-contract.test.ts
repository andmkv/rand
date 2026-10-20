import { describe, expect, it } from "vitest";
import {
  createContractAdapter,
  draftToRecipe,
  recipeToDraft,
  recipeWithinContract,
  type SoundAssetAdapter,
  type SoundPreviewAdapter,
  type SoundPreviewRequest,
  type UserSoundAsset,
} from "../src/sound-contract";
import {
  instrumentDraft,
  presetDraft,
  presetIds,
  randomizeDraft,
  sameDraft,
  type SoundDraft,
} from "../src/sound-draft";

function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const version = (n: number) => ({ id: `v${n}`, number: n, createdAt: "2026-10-20T00:00:00Z" });
function asset(over: Partial<UserSoundAsset> & Pick<UserSoundAsset, "recipe">): UserSoundAsset {
  return {
    id: "a1",
    type: over.recipe.format === "randusr.sfx" ? "sfx" : "instrument",
    name: "Zap",
    alias: "@zap",
    latestVersion: version(1),
    selectedVersion: version(1),
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("draft ⇄ canonical recipe", () => {
  it("every preset and 400 random drafts map to a recipe the shared validator rules accept", () => {
    const random = lcg(11);
    const drafts: SoundDraft[] = [
      ...presetIds.map((id) => presetDraft(id)),
      instrumentDraft(),
    ];
    for (let i = 0; i < 400; i += 1) {
      const base = i % 3 === 0 ? instrumentDraft() : presetDraft(presetIds[i % 8]);
      drafts.push(randomizeDraft({ ...base, pulseWidth: 0.1 + random() * 0.8, noiseAmount: random(), tuning: Math.round(random() * 2400 - 1200) }, random));
    }
    for (const draft of drafts) expect(recipeWithinContract(draftToRecipe(draft))).toBe(true);
  });
  it("converts seconds to whole milliseconds and keeps the sum of stages inside the sound", () => {
    const recipe = draftToRecipe({ ...presetDraft("laser"), duration: 0.123, attack: 0.037, decay: 0.05, release: 0.036 });
    if (recipe.format !== "randusr.sfx") throw new Error("expected sfx");
    expect(recipe.durationMs).toBe(120); // the lab works in 10 ms steps
    for (const v of [recipe.envelope.attackMs, recipe.envelope.decayMs, recipe.envelope.releaseMs]) expect(Number.isInteger(v)).toBe(true);
    expect(recipe.envelope.attackMs + recipe.envelope.decayMs + recipe.envelope.releaseMs).toBeLessThanOrEqual(recipe.durationMs);
  });
  it("maps saw to sawtooth and a moved square width to pulse", () => {
    expect(draftToRecipe({ ...presetDraft("laser"), waveform: "saw" }).waveform).toBe("sawtooth");
    expect(draftToRecipe({ ...presetDraft("laser"), pulseWidth: 0.5 }).waveform).toBe("square");
    expect(draftToRecipe({ ...presetDraft("laser"), pulseWidth: 0.25 }).waveform).toBe("pulse");
    expect(draftToRecipe({ ...presetDraft("laser"), waveform: "triangle", pulseWidth: 0.25 }).waveform).toBe("triangle");
  });
  it("round-trips sound effects and instruments through the recipe", () => {
    for (const draft of [...presetIds.map((id) => presetDraft(id)), { ...instrumentDraft(), tuning: -37, pulseWidth: 0.3 }]) {
      const back = recipeToDraft(draftToRecipe(draft));
      // The audition length of an instrument is an editor choice, not stored.
      const expected = draft.kind === "instrument" ? { ...draft, duration: back.duration, pitchStart: back.pitchStart, pitchEnd: back.pitchEnd } : draft;
      expect(sameDraft(back, expected)).toBe(true);
    }
  });
  it("drops the noise layer for the noise waveform and tuning for sound effects", () => {
    const recipe = draftToRecipe({ ...presetDraft("explosion"), noiseAmount: 0.8, tuning: 300 });
    expect(recipe.noiseAmount).toBe(0);
    expect("tuningCents" in recipe).toBe(false);
  });
  it("the validator rules reject out-of-contract recipes", () => {
    const good = draftToRecipe(presetDraft("laser"));
    if (good.format !== "randusr.sfx") throw new Error("expected sfx");
    expect(recipeWithinContract({ ...good, durationMs: 20 })).toBe(false);
    expect(recipeWithinContract({ ...good, startFrequencyHz: 5000 })).toBe(false);
    expect(recipeWithinContract({ ...good, envelope: { ...good.envelope, attackMs: good.durationMs + 1 } })).toBe(false);
    expect(recipeWithinContract({ ...good, volume: 1.5 })).toBe(false);
  });
});

describe("contract adapter", () => {
  function fakes() {
    const requests: SoundPreviewRequest[] = [];
    const log: string[] = [];
    const preview: SoundPreviewAdapter = {
      unlock: async () => true,
      preview: (request) => { requests.push(request); return Promise.resolve(); },
      stop: () => void log.push("stop"),
      setMuted: (muted) => void log.push(`mute:${muted}`),
      setMasterVolume: () => undefined,
    };
    const calls: { create: unknown[]; saveVersion: unknown[]; rename: unknown[] } = { create: [], saveVersion: [], rename: [] };
    const assets: SoundAssetAdapter = {
      list: async () => [asset({ recipe: draftToRecipe(presetDraft("laser")) })],
      load: async () => asset({ recipe: draftToRecipe(presetDraft("coin")), selectedVersion: version(3) }),
      loadVersion: async (_id, number) => asset({ recipe: draftToRecipe(presetDraft("coin")), selectedVersion: version(number) }),
      create: async (input) => {
        calls.create.push(input);
        return asset({ recipe: input.recipe, name: input.name, alias: "@my_zap" });
      },
      saveVersion: async (id, input) => {
        calls.saveVersion.push({ id, ...input });
        return asset({ id, recipe: input.recipe, selectedVersion: version(input.baseVersion + 1) });
      },
      rename: async (id, name) => {
        calls.rename.push({ id, name });
        return { ...asset({ recipe: draftToRecipe(presetDraft("laser")) }), name };
      },
      remove: async () => undefined,
    };
    return { requests, log, assets, preview, calls };
  }
  it("previews a sound effect with {recipe} and an instrument with the played note", async () => {
    const f = fakes();
    const adapter = createContractAdapter({ preview: f.preview, assets: f.assets });
    void adapter.preview(presetDraft("laser"));
    void adapter.preview(instrumentDraft(), { noteHz: 440 });
    expect(f.requests).toHaveLength(2);
    expect(f.requests[0]).toMatchObject({ recipe: { format: "randusr.sfx" } });
    expect(f.requests[1]).toMatchObject({ frequencyHz: 440, durationMs: 600, recipe: { format: "randusr.pitched-instrument" } });
    adapter.stop();
  });
  it("settles a preview on stop and never leaves a timer running", async () => {
    const f = fakes();
    const adapter = createContractAdapter({ preview: f.preview, assets: f.assets });
    let done = false;
    void adapter.preview({ ...presetDraft("wind") }).then(() => (done = true));
    expect(done).toBe(false);
    adapter.stop();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(f.log).toContain("stop");
  });
  it("surfaces a rejected browser unlock as a blocked preview", async () => {
    const f = fakes();
    f.preview.unlock = async () => false;
    f.preview.preview = async () => { throw Object.assign(new Error("blocked"), { code: "blocked" }); };
    const adapter = createContractAdapter({ preview: f.preview, assets: f.assets });
    await expect(adapter.preview(presetDraft("laser"))).rejects.toMatchObject({ code: "blocked" });
  });
  it("creates, versions and renames through the asset adapter and strips the @ from aliases", async () => {
    const f = fakes();
    const adapter = createContractAdapter({ preview: f.preview, assets: f.assets });
    const created = await adapter.save({ draft: presetDraft("laser"), name: "My zap" });
    expect(created).toMatchObject({ alias: "my_zap", version: 1 });
    expect(f.calls.create).toHaveLength(1);
    const next = await adapter.save({ draft: presetDraft("coin"), name: "Zip", existing: { id: "a1", baseVersion: 1 } });
    expect(f.calls.saveVersion).toEqual([expect.objectContaining({ id: "a1", baseVersion: 1 })]);
    expect(next.version).toBe(2);
    expect(f.calls.rename).toEqual([{ id: "a1", name: "Zip" }]);
    expect(await adapter.list()).toEqual([{ id: "a1", alias: "zap", name: "Zap", kind: "sfx" }]);
    const loaded = await adapter.load("a1");
    expect(loaded.version).toBe(3);
    expect(loaded.draft.kind).toBe("sfx");
  });
  it("maps a version conflict and reports a guest (no assets) as save-unavailable", async () => {
    const f = fakes();
    f.assets.saveVersion = async () => Promise.reject(Object.assign(new Error("x"), { code: "VERSION_CONFLICT" }));
    const adapter = createContractAdapter({ preview: f.preview, assets: f.assets });
    await expect(adapter.save({ draft: presetDraft("laser"), name: "a", existing: { id: "a1", baseVersion: 1 } })).rejects.toMatchObject({ code: "conflict" });
    const guest = createContractAdapter({ preview: f.preview, assets: null });
    expect(guest.available).toEqual({ preview: true, save: false });
    await expect(guest.save({ draft: presetDraft("laser"), name: "a" })).rejects.toMatchObject({ code: "unavailable" });
    expect(await guest.list()).toEqual([]);
  });
  it("forwards mute to the engine", () => {
    const f = fakes();
    createContractAdapter({ preview: f.preview, assets: null }).setMuted?.(true);
    expect(f.log).toContain("mute:true");
  });
});
