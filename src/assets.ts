import {
  api,
} from "./api";
import {
  assertProjectAssetManifest,
  projectSpriteFromAsset,
  spriteSpawnSnippet,
  spriteThumbnail,
  projectSoundFromAsset,
  soundInsertSnippet,
  type CreateSpriteAssetRequest,
  type CreateSpriteVersionRequest,
  type CreateSoundAssetRequest,
  type CreateSoundVersionRequest,
  type ProjectAssetManifestV1,
  type SpriteEditorAdapter,
  type SoundAssetAdapter,
  type UserSoundAsset,
  type UserSoundAssetSummary,
  type UserSpriteAsset,
  type UserSpriteAssetSummary,
} from "../shared/assets";
import type { Project } from "./project";

export const spriteAssetAdapter: SpriteEditorAdapter = {
  async list(): Promise<UserSpriteAssetSummary[]> {
    return (await api<{ assets: UserSpriteAssetSummary[] }>("/assets")).assets;
  },
  async load(assetId: string): Promise<UserSpriteAsset> {
    return api<UserSpriteAsset>(`/assets/${assetId}`);
  },
  async loadVersion(assetId: string, number: number): Promise<UserSpriteAsset> {
    return api<UserSpriteAsset>(`/assets/${assetId}/versions/${number}`);
  },
  async create(input: CreateSpriteAssetRequest): Promise<UserSpriteAsset> {
    return api<UserSpriteAsset>("/assets", "POST", input);
  },
  async saveVersion(
    assetId: string,
    input: CreateSpriteVersionRequest,
  ): Promise<UserSpriteAsset> {
    return api<UserSpriteAsset>(`/assets/${assetId}/versions`, "POST", input);
  },
  async rename(assetId: string, name: string): Promise<UserSpriteAssetSummary> {
    return api<UserSpriteAssetSummary>(`/assets/${assetId}`, "PATCH", { name });
  },
  async remove(assetId: string): Promise<void> {
    await api(`/assets/${assetId}`, "DELETE");
  },
};

/** Personal sounds use the same private asset/version store as sprites. */
export const soundAssetAdapter: SoundAssetAdapter = {
  async list(): Promise<UserSoundAssetSummary[]> {
    return (await api<{ assets: UserSoundAssetSummary[] }>("/assets/sounds")).assets;
  },
  async load(assetId: string): Promise<UserSoundAsset> {
    return api<UserSoundAsset>(`/assets/sounds/${assetId}`);
  },
  async loadVersion(assetId: string, number: number): Promise<UserSoundAsset> {
    return api<UserSoundAsset>(`/assets/sounds/${assetId}/versions/${number}`);
  },
  async create(input: CreateSoundAssetRequest): Promise<UserSoundAsset> {
    return api<UserSoundAsset>("/assets/sounds", "POST", input);
  },
  async saveVersion(assetId: string, input: CreateSoundVersionRequest): Promise<UserSoundAsset> {
    return api<UserSoundAsset>(`/assets/sounds/${assetId}/versions`, "POST", input);
  },
  async rename(assetId: string, name: string): Promise<UserSoundAssetSummary> {
    return api<UserSoundAssetSummary>(`/assets/sounds/${assetId}`, "PATCH", { name });
  },
  async remove(assetId: string): Promise<void> {
    await api(`/assets/sounds/${assetId}`, "DELETE");
  },
};

/** Pin the exact loaded library version into a project before saving or publishing. */
export function bindSpriteToProject(
  project: Project,
  asset: UserSpriteAsset,
): Project {
  const sprites = project.assetManifest?.sprites ?? [];
  const binding = projectSpriteFromAsset(asset);
  const next: ProjectAssetManifestV1 = {
    version: 1,
    sprites: [...sprites.filter((item) => item.alias !== binding.alias), binding],
    ...(project.assetManifest?.sounds?.length
      ? { sounds: project.assetManifest.sounds }
      : {}),
  };
  assertProjectAssetManifest(next);
  return { ...project, assetManifest: next };
}

/** Embed and pin a sound version so local, public and exported runs need no library lookup. */
export function bindSoundToProject(project: Project, asset: UserSoundAsset): Project {
  const manifest = project.assetManifest;
  const binding = projectSoundFromAsset(asset);
  const sounds = manifest?.sounds ?? [];
  const next: ProjectAssetManifestV1 = {
    version: 1,
    sprites: manifest?.sprites ?? [],
    sounds: [...sounds.filter((item) => item.alias !== binding.alias), binding],
  };
  assertProjectAssetManifest(next);
  return { ...project, assetManifest: next };
}

export { soundInsertSnippet, spriteSpawnSnippet, spriteThumbnail };
