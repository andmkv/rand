import type { Page } from "@playwright/test";

/**
 * Recording stand-in for the canonical sound engine (card #123), injected through the DEV-only
 * `window.__soundLabAdapter` hook. It proves the lab's UI behaviour (calls, state, focus); it is
 * NOT audio and must never be described as an audio check.
 */
export type FakeMode = "off" | "ok" | "blocked";
/** The mode lives in sessionStorage so one browser session can switch it between tests. */
export async function installFakeSoundAdapter(page: Page) {
  await page.addInitScript(() => {
    const mode = (sessionStorage.getItem("fakeSound") ?? "ok") as string;
    if (mode === "off") return;
    const opts = { failPreview: mode === "blocked" ? "blocked" : undefined };
    type Call = { type: string; [key: string]: unknown };
    const calls: Call[] = [];
    const library: {
      id: string;
      alias: string;
      name: string;
      kind: string;
      version: number;
      draft: unknown;
    }[] = [];
    const recipeFor = (draft: any) => {
      const waveforms: Record<string, string> = {
        square: draft.pulseWidth === 0.5 ? "square" : "pulse",
        triangle: "triangle",
        saw: "sawtooth",
        sine: "sine",
        noise: "noise",
      };
      const voice = {
        waveform: waveforms[draft.waveform] ?? "square",
        pulseWidth: draft.pulseWidth,
        noiseAmount: draft.waveform === "noise" ? 0 : draft.noiseAmount,
        volume: draft.volume,
        envelope: {
          attackMs: Math.round(draft.attack * 1000),
          decayMs: Math.round(draft.decay * 1000),
          sustainLevel: draft.sustain,
          releaseMs: Math.round(draft.release * 1000),
        },
      };
      return draft.kind === "instrument"
        ? { format: "randusr.pitched-instrument", version: 1, ...voice, tuningCents: draft.tuning }
        : {
            format: "randusr.sfx", version: 1, ...voice,
            startFrequencyHz: draft.pitchStart,
            endFrequencyHz: draft.pitchEnd,
            durationMs: Math.round(draft.duration * 1000),
          };
    };
    const persist = async (input: {
      name: string;
      draft: any;
      existing?: { id: string; baseVersion: number };
    }) => {
      const base = document.cookie.split(";").some((part) => part.trim() === "randusr_demo=1")
        ? "/api/v1/demo"
        : "/api/v1";
      const csrf = await fetch(`${base}/auth/csrf`, { credentials: "same-origin" }).then((r) => r.json());
      const path = input.existing
        ? `${base}/assets/sounds/${input.existing.id}/versions`
        : `${base}/assets/sounds`;
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf.token },
        body: JSON.stringify(input.existing
          ? { baseVersion: input.existing.baseVersion, recipe: recipeFor(input.draft) }
          : { name: input.name, recipe: recipeFor(input.draft) }),
      });
      if (!response.ok) throw error("save-failed");
      let asset = await response.json();
      if (!input.existing && asset.name !== input.name) {
        const renamed = await fetch(`${base}/assets/sounds/${asset.id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": csrf.token },
          body: JSON.stringify({ name: input.name }),
        });
        if (!renamed.ok) throw error("save-failed");
        asset = await renamed.json();
      }
      return asset;
    };
    let timer: number | undefined;
    let finish: (() => void) | undefined;
    const error = (code: string) =>
      Object.assign(new Error(code), { code, name: "SoundAdapterError" });
    (window as unknown as Record<string, unknown>).__soundCalls = calls;
    (window as unknown as Record<string, unknown>).__soundLabAdapter = {
      available: { preview: true, save: true },
      preview(draft: unknown, options?: unknown) {
        calls.push({ type: "preview", draft, options });
        if (opts.failPreview) return Promise.reject(error(opts.failPreview));
        return new Promise<void>((resolve) => {
          finish = resolve;
          timer = window.setTimeout(resolve, 900);
        });
      },
      setMuted(muted: boolean) {
        calls.push({ type: "mute", muted });
      },
      stop() {
        calls.push({ type: "stop" });
        window.clearTimeout(timer);
        finish?.();
      },
      async list() {
        return library.map(({ id, alias, name, kind }) => ({
          id,
          alias,
          name,
          kind,
        }));
      },
      async load(id: string) {
        const found = library.find((item) => item.id === id);
        if (!found) throw error("unavailable");
        return {
          id: found.id,
          alias: found.alias,
          version: found.version,
          name: found.name,
          draft: found.draft,
        };
      },
      async save(input: {
        draft: { kind: string };
        name: string;
        existing?: { id: string; baseVersion: number };
      }) {
        calls.push({ type: "save", input });
        const persisted = await persist(input as { name: string; draft: any; existing?: { id: string; baseVersion: number } });
        const alias = input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
        const existing = library.find((item) => item.id === input.existing?.id);
        if (existing) {
          existing.version += 1;
          existing.draft = input.draft;
          existing.name = input.name;
          existing.alias = persisted.alias;
          return {
            id: persisted.id,
            alias: persisted.alias,
            name: input.name,
            version: existing.version,
          };
        }
        const id = persisted.id;
        const stableAlias = persisted.alias.replace(/^@/, "");
        library.push({
          id,
          alias: stableAlias,
          name: input.name,
          kind: input.draft.kind,
          version: 1,
          draft: input.draft,
        });
        return { id, alias: stableAlias, name: input.name, version: 1 };
      },
    };
  });
}
export async function setFakeMode(page: Page, mode: FakeMode) {
  await page.evaluate((value) => sessionStorage.setItem("fakeSound", value), mode);
  await page.reload({ waitUntil: "networkidle" });
}

export const soundCalls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __soundCalls: { type: string; [k: string]: unknown }[] })
        .__soundCalls,
  );
