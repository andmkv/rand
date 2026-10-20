import { soundAssetAdapter } from "./assets";
import { soundPreviewAdapter } from "./runtime/audio";
import { createContractAdapter } from "./sound-contract";
import { disconnectedAdapter, type SoundDraftAdapter } from "./sound-draft";

declare global {
  interface Window {
    /** Dev/test only: Playwright injects a recording adapter. Never read in production builds. */
    __soundLabAdapter?: SoundDraftAdapter;
  }
}

/**
 * The one place Sound Lab selects the shared synthesizer and account-scoped asset API.
 * Preview is available to guests; private saving is available to cloud and Demo principals.
 */
let guestAdapter: SoundDraftAdapter | undefined;
let privateAdapter: SoundDraftAdapter | undefined;

export function soundDraftAdapter(canSave = false): SoundDraftAdapter {
  if (import.meta.env.DEV && typeof window !== "undefined" && window.__soundLabAdapter)
    return window.__soundLabAdapter;
  if (canSave)
    return (privateAdapter ??= createContractAdapter({
      preview: soundPreviewAdapter,
      assets: soundAssetAdapter,
    }));
  return (guestAdapter ??= createContractAdapter({
    preview: soundPreviewAdapter,
    assets: null,
  }));
}

/** Fetch and audition one private Inventory asset; callers should unlock synchronously first. */
export async function previewUserSound(assetId: string, canSave: boolean): Promise<void> {
  const adapter = soundDraftAdapter(canSave);
  const saved = await adapter.load(assetId);
  await adapter.preview(saved.draft);
}
