/**
 * Canonical user asset contract. The first supported user asset is a single-frame,
 * indexed Spectrum-style sprite. Project bundles carry the pixels so they remain
 * playable without access to the creator's private library.
 */
export const assetLimits = {
  nameCharacters: 64,
  aliasCharacters: 32,
  spriteWidth: 64,
  spriteHeight: 64,
  spritePixels: 4096,
  animationFrames: 32,
  animationFramePixels: 131072,
  paletteEntries: 16,
  assetsPerUser: 64,
  versionsPerAsset: 100,
  storedBytesPerUser: 5 * 1024 * 1024,
  spritesPerProject: 16,
  spritePixelsPerProject: 16 * 1024,
  spriteFramePixelsPerProject: 128 * 1024,
  soundAssetsPerProject: 16,
  soundVoices: 8,
  soundEventsPerSecond: 32,
  minSoundDurationMs: 50,
  maxSoundDurationMs: 5000,
  maxSoundRecipeBytes: 2048,
  projectManifestBytes: 512 * 1024,
  thumbnailSide: 16,
} as const;

export type SpectrumColorIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

/** Pixel values index into palette; transparentIndex is a palette slot, or null. */
export interface IndexedSpriteV1 {
  format: "randusr.indexed-sprite";
  version: 1;
  width: number;
  height: number;
  pixels: number[];
  palette: SpectrumColorIndex[];
  transparentIndex: number | null;
}

/**
 * Versioned animation recipe sharing dimensions, palette and transparency across
 * all row-major frames. Frame pixels index into the shared palette.
 */
export interface AnimatedSpriteV1 {
  format: "randusr.animated-sprite";
  version: 1;
  width: number;
  height: number;
  frames: number[][];
  palette: SpectrumColorIndex[];
  transparentIndex: number | null;
  fps: number;
  loop: boolean;
}

/** A personal sprite version is either the unchanged static format or animation v1. */
export type SpriteAssetV1 = IndexedSpriteV1 | AnimatedSpriteV1;

/** Safe synthesis primitives shared by one-shot effects and pitched instruments. */
export type SoundWaveformV1 =
  | "square"
  | "pulse"
  | "triangle"
  | "sawtooth"
  | "sine"
  | "noise";

export interface SoundEnvelopeV1 {
  attackMs: number;
  decayMs: number;
  sustainLevel: number;
  releaseMs: number;
}

export interface SoundVoiceRecipeV1 {
  waveform: SoundWaveformV1;
  /** 0.1–0.9; used by the pulse waveform, retained by other waveforms. */
  pulseWidth: number;
  /** White-noise layer mixed under the oscillator, 0–1. */
  noiseAmount: number;
  /** Per-recipe scalar, 0–1; engine master output is separately capped. */
  volume: number;
  envelope: SoundEnvelopeV1;
}

/** A bounded, declarative one-shot sound; it contains no executable code or samples. */
export interface SfxRecipeV1 extends SoundVoiceRecipeV1 {
  format: "randusr.sfx";
  version: 1;
  startFrequencyHz: number;
  endFrequencyHz: number;
  durationMs: number;
}

/** A reusable voice whose note frequency is supplied by BASIC or a future tracker. */
export interface PitchedInstrumentV1 extends SoundVoiceRecipeV1 {
  format: "randusr.pitched-instrument";
  version: 1;
  tuningCents: number;
}

export type SoundRecipeV1 = SfxRecipeV1 | PitchedInstrumentV1;

export interface UserSoundAssetSummary {
  id: string;
  type: "sfx" | "instrument";
  name: string;
  alias: string;
  latestVersion: AssetVersionSummary;
  createdAt: string;
  updatedAt: string;
}

export interface UserSoundAsset extends UserSoundAssetSummary {
  selectedVersion: AssetVersionSummary;
  recipe: SoundRecipeV1;
}

export interface CreateSoundAssetRequest {
  name: string;
  recipe: SoundRecipeV1;
}

export interface CreateSoundVersionRequest {
  baseVersion: number;
  recipe: SoundRecipeV1;
}

export type SoundPreviewRequest =
  | { recipe: SfxRecipeV1 }
  | {
      recipe: PitchedInstrumentV1;
      frequencyHz: number;
      durationMs: number;
    };

export interface SoundPreviewAdapter {
  /** Call synchronously from a user gesture before any network request or await. */
  unlock(): Promise<boolean>;
  /** Call directly from a user gesture; rejection means the preview could not start. */
  preview(request: SoundPreviewRequest): Promise<void>;
  /** Stops only the editor audition; RUN/STOP owns and cancels program voices separately. */
  stop(): void;
  setMuted(muted: boolean): void;
  /** Global gain is clamped to the engine's safe ceiling. */
  setMasterVolume(volume: number): void;
}

export interface SoundAssetAdapter {
  list(): Promise<UserSoundAssetSummary[]>;
  load(assetId: string): Promise<UserSoundAsset>;
  loadVersion(assetId: string, number: number): Promise<UserSoundAsset>;
  create(input: CreateSoundAssetRequest): Promise<UserSoundAsset>;
  saveVersion(assetId: string, input: CreateSoundVersionRequest): Promise<UserSoundAsset>;
  rename(assetId: string, name: string): Promise<UserSoundAssetSummary>;
  remove(assetId: string): Promise<void>;
}

export interface SpriteThumbnailV1 {
  width: number;
  height: number;
  pixels: number[];
  palette: SpectrumColorIndex[];
  transparentIndex: number | null;
}

export interface AssetVersionSummary {
  id: string;
  number: number;
  createdAt: string;
}

export interface UserSpriteAssetSummary {
  id: string;
  type: "sprite";
  name: string;
  alias: string;
  latestVersion: AssetVersionSummary;
  thumbnail: SpriteThumbnailV1;
  createdAt: string;
  updatedAt: string;
}

export interface UserSpriteAsset extends UserSpriteAssetSummary {
  selectedVersion: AssetVersionSummary;
  sprite: SpriteAssetV1;
}

/** Optional library identity is private project metadata and is stripped on export/share. */
export interface ProjectSpriteBindingV1 {
  type: "sprite";
  alias: string;
  name: string;
  assetId?: string;
  versionId?: string;
  version?: number;
  sprite: SpriteAssetV1;
}

export interface ProjectAssetManifestV1 {
  version: 1;
  sprites: ProjectSpriteBindingV1[];
  /** Self-contained recipes make project playback work without private library access. */
  sounds?: ProjectSoundBindingV1[];
}

export interface ProjectSoundBindingV1 {
  type: "sfx" | "instrument";
  alias: string;
  name: string;
  assetId?: string;
  versionId?: string;
  version?: number;
  recipe: SoundRecipeV1;
}

export interface CreateSpriteAssetRequest {
  name: string;
  sprite: SpriteAssetV1;
}

export interface CreateSpriteVersionRequest {
  baseVersion: number;
  sprite: SpriteAssetV1;
}

export interface SpriteEditorAdapter {
  list(): Promise<UserSpriteAssetSummary[]>;
  load(assetId: string): Promise<UserSpriteAsset>;
  loadVersion(assetId: string, number: number): Promise<UserSpriteAsset>;
  create(input: CreateSpriteAssetRequest): Promise<UserSpriteAsset>;
  saveVersion(
    assetId: string,
    input: CreateSpriteVersionRequest,
  ): Promise<UserSpriteAsset>;
  rename(assetId: string, name: string): Promise<UserSpriteAssetSummary>;
  remove(assetId: string): Promise<void>;
}

export const spriteAliasPattern = /^@[a-z][a-z0-9_-]{0,30}$/;

export function generateSpriteAlias(
  name: string,
  usedAliases: Iterable<string>,
): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 31) || "sprite";
  const used = new Set(usedAliases);
  for (let suffix = 1; suffix < 10000; suffix++) {
    const candidate =
      suffix === 1
        ? `@${slug}`
        : `@${slug.slice(0, Math.max(1, 30 - String(suffix).length))}-${suffix}`;
    if (spriteAliasPattern.test(candidate) && !used.has(candidate)) return candidate;
  }
  throw new Error("ASSET_ALIAS_QUOTA");
}

export const indexedSpriteSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "format",
    "version",
    "width",
    "height",
    "pixels",
    "palette",
    "transparentIndex",
  ],
  properties: {
    format: { const: "randusr.indexed-sprite" },
    version: { const: 1 },
    width: { type: "integer", minimum: 1, maximum: assetLimits.spriteWidth },
    height: { type: "integer", minimum: 1, maximum: assetLimits.spriteHeight },
    pixels: {
      type: "array",
      minItems: 1,
      maxItems: assetLimits.spritePixels,
      items: { type: "integer", minimum: 0, maximum: 15 },
    },
    palette: {
      type: "array",
      minItems: 1,
      maxItems: assetLimits.paletteEntries,
      uniqueItems: true,
      items: { type: "integer", minimum: 0, maximum: 15 },
    },
    // Use a union type instead of anyOf. Ajv's type coercion can otherwise
    // turn the valid integer 0 into null while trying the null branch first.
    transparentIndex: {
      type: ["integer", "null"],
      minimum: 0,
      maximum: assetLimits.paletteEntries - 1,
    },
  },
} as const;

export const animatedSpriteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["format", "version", "width", "height", "frames", "palette", "transparentIndex", "fps", "loop"],
  properties: {
    format: { const: "randusr.animated-sprite" },
    version: { const: 1 },
    width: { type: "integer", minimum: 1, maximum: assetLimits.spriteWidth },
    height: { type: "integer", minimum: 1, maximum: assetLimits.spriteHeight },
    frames: {
      type: "array",
      minItems: 1,
      maxItems: assetLimits.animationFrames,
      items: {
        type: "array",
        minItems: 1,
        maxItems: assetLimits.spritePixels,
        items: { type: "integer", minimum: 0, maximum: assetLimits.paletteEntries - 1 },
      },
    },
    palette: {
      type: "array",
      minItems: 1,
      maxItems: assetLimits.paletteEntries,
      uniqueItems: true,
      items: { type: "integer", minimum: 0, maximum: 15 },
    },
    transparentIndex: {
      type: ["integer", "null"],
      minimum: 0,
      maximum: assetLimits.paletteEntries - 1,
    },
    fps: { type: "integer", minimum: 1, maximum: 12 },
    loop: { type: "boolean" },
  },
} as const;

export const soundEnvelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attackMs", "decayMs", "sustainLevel", "releaseMs"],
  properties: {
    attackMs: { type: "integer", minimum: 0, maximum: 2000 },
    decayMs: { type: "integer", minimum: 0, maximum: 2000 },
    sustainLevel: { type: "number", minimum: 0, maximum: 1 },
    releaseMs: { type: "integer", minimum: 0, maximum: 2000 },
  },
} as const;

export const sfxRecipeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["format", "version", "waveform", "pulseWidth", "noiseAmount", "volume", "envelope", "startFrequencyHz", "endFrequencyHz", "durationMs"],
  properties: {
    format: { const: "randusr.sfx" },
    version: { const: 1 },
    waveform: { enum: ["square", "pulse", "triangle", "sawtooth", "sine", "noise"] },
    pulseWidth: { type: "number", minimum: 0.1, maximum: 0.9 },
    noiseAmount: { type: "number", minimum: 0, maximum: 1 },
    volume: { type: "number", minimum: 0, maximum: 1 },
    envelope: soundEnvelopeSchema,
    startFrequencyHz: { type: "number", minimum: 30, maximum: 4000 },
    endFrequencyHz: { type: "number", minimum: 30, maximum: 4000 },
    durationMs: { type: "integer", minimum: assetLimits.minSoundDurationMs, maximum: assetLimits.maxSoundDurationMs },
  },
} as const;

export const pitchedInstrumentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["format", "version", "waveform", "pulseWidth", "noiseAmount", "volume", "envelope", "tuningCents"],
  properties: {
    format: { const: "randusr.pitched-instrument" },
    version: { const: 1 },
    waveform: { enum: ["square", "pulse", "triangle", "sawtooth", "sine", "noise"] },
    pulseWidth: { type: "number", minimum: 0.1, maximum: 0.9 },
    noiseAmount: { type: "number", minimum: 0, maximum: 1 },
    volume: { type: "number", minimum: 0, maximum: 1 },
    envelope: soundEnvelopeSchema,
    tuningCents: { type: "number", minimum: -1200, maximum: 1200 },
  },
} as const;

export const soundRecipeSchema = { anyOf: [sfxRecipeSchema, pitchedInstrumentSchema] } as const;

export const spriteAssetSchema = {
  anyOf: [indexedSpriteSchema, animatedSpriteSchema],
} as const;

export const projectAssetManifestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "sprites"],
  properties: {
    version: { const: 1 },
    sprites: {
      type: "array",
      maxItems: assetLimits.spritesPerProject,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "alias", "name", "sprite"],
        properties: {
          type: { const: "sprite" },
          alias: { type: "string", pattern: "^@[a-z][a-z0-9_-]{0,30}$" },
          name: {
            type: "string",
            minLength: 1,
            maxLength: assetLimits.nameCharacters,
            pattern: "^[^<>\\x00-\\x1F]+$",
          },
          assetId: { type: "string", format: "uuid" },
          versionId: { type: "string", format: "uuid" },
          version: { type: "integer", minimum: 1, maximum: assetLimits.versionsPerAsset },
          sprite: spriteAssetSchema,
        },
      },
    },
    sounds: {
      type: "array",
      maxItems: assetLimits.soundAssetsPerProject,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "alias", "name", "recipe"],
        properties: {
          type: { enum: ["sfx", "instrument"] },
          alias: { type: "string", pattern: "^@[a-z][a-z0-9_-]{0,30}$" },
          name: {
            type: "string",
            minLength: 1,
            maxLength: assetLimits.nameCharacters,
            pattern: "^[^<>\\x00-\\x1F]+$",
          },
          assetId: { type: "string", format: "uuid" },
          versionId: { type: "string", format: "uuid" },
          version: { type: "integer", minimum: 1, maximum: assetLimits.versionsPerAsset },
          recipe: soundRecipeSchema,
        },
      },
    },
  },
} as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function assertIndexedSprite(value: unknown): asserts value is IndexedSpriteV1 {
  if (
    !isRecord(value) ||
    value.format !== "randusr.indexed-sprite" ||
    value.version !== 1
  )
    throw new Error("INVALID_ASSET");
  const width = value.width;
  const height = value.height;
  const pixels = value.pixels;
  const palette = value.palette;
  const transparentIndex = value.transparentIndex;
  if (
    Object.keys(value).some(
      (key) =>
        !["format", "version", "width", "height", "pixels", "palette", "transparentIndex"].includes(key),
    ) ||
    typeof width !== "number" ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > assetLimits.spriteWidth ||
    typeof height !== "number" ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > assetLimits.spriteHeight ||
    width * height > assetLimits.spritePixels ||
    !Array.isArray(pixels) || pixels.length !== width * height ||
    !Array.isArray(palette) || palette.length < 1 || palette.length > assetLimits.paletteEntries ||
    Array.from(palette).some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 15) ||
    new Set(palette).size !== palette.length ||
    !(transparentIndex === null || (typeof transparentIndex === "number" && Number.isInteger(transparentIndex) && transparentIndex >= 0 && transparentIndex < palette.length)) ||
    Array.from(pixels).some((entry) => !Number.isInteger(entry) || entry < 0 || entry >= palette.length)
  ) throw new Error("INVALID_ASSET");
}

export function assertAnimatedSprite(value: unknown): asserts value is AnimatedSpriteV1 {
  if (!isRecord(value) || value.format !== "randusr.animated-sprite" || value.version !== 1)
    throw new Error("INVALID_ASSET");
  const width = value.width;
  const height = value.height;
  const frames = value.frames;
  const palette = value.palette;
  const transparentIndex = value.transparentIndex;
  if (
    Object.keys(value).some((key) => !["format", "version", "width", "height", "frames", "palette", "transparentIndex", "fps", "loop"].includes(key)) ||
    typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > assetLimits.spriteWidth ||
    typeof height !== "number" || !Number.isInteger(height) || height < 1 || height > assetLimits.spriteHeight ||
    width * height > assetLimits.spritePixels ||
    !Array.isArray(frames) || frames.length < 1 || frames.length > assetLimits.animationFrames ||
    !Array.isArray(palette) || palette.length < 1 || palette.length > assetLimits.paletteEntries ||
    Array.from(palette).some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 15) ||
    new Set(palette).size !== palette.length ||
    !(transparentIndex === null || (typeof transparentIndex === "number" && Number.isInteger(transparentIndex) && transparentIndex >= 0 && transparentIndex < palette.length)) ||
    typeof value.fps !== "number" || !Number.isInteger(value.fps) || value.fps < 1 || value.fps > 12 ||
    typeof value.loop !== "boolean"
  ) throw new Error("INVALID_ASSET");
  for (const frame of frames) {
    if (
      !Array.isArray(frame) || frame.length !== width * height ||
      Array.from(frame).some((entry) => !Number.isInteger(entry) || entry < 0 || entry >= palette.length)
    ) throw new Error("INVALID_ASSET");
  }
  if (width * height * frames.length > assetLimits.animationFramePixels)
    throw new Error("INVALID_ASSET");
}

export function assertSpriteAsset(value: unknown): asserts value is SpriteAssetV1 {
  if (isRecord(value) && value.format === "randusr.indexed-sprite") {
    assertIndexedSprite(value);
    return;
  }
  assertAnimatedSprite(value);
}

export function assertSoundRecipe(value: unknown): asserts value is SoundRecipeV1 {
  if (!isRecord(value) || value.version !== 1) throw new Error("INVALID_ASSET");
  const common = ["format", "version", "waveform", "pulseWidth", "noiseAmount", "volume", "envelope"];
  const envelope = value.envelope;
  if (!isRecord(envelope)) throw new Error("INVALID_ASSET");
  const attackMs = envelope.attackMs;
  const decayMs = envelope.decayMs;
  const sustainLevel = envelope.sustainLevel;
  const releaseMs = envelope.releaseMs;
  if (
    !["square", "pulse", "triangle", "sawtooth", "sine", "noise"].includes(String(value.waveform)) ||
    typeof value.pulseWidth !== "number" || !Number.isFinite(value.pulseWidth) || value.pulseWidth < 0.1 || value.pulseWidth > 0.9 ||
    typeof value.noiseAmount !== "number" || !Number.isFinite(value.noiseAmount) || value.noiseAmount < 0 || value.noiseAmount > 1 ||
    typeof value.volume !== "number" || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1 ||
    Object.keys(envelope).some((key) => !["attackMs", "decayMs", "sustainLevel", "releaseMs"].includes(key)) ||
    typeof attackMs !== "number" || !Number.isInteger(attackMs) || attackMs < 0 || attackMs > 2000 ||
    typeof decayMs !== "number" || !Number.isInteger(decayMs) || decayMs < 0 || decayMs > 2000 ||
    typeof sustainLevel !== "number" || !Number.isFinite(sustainLevel) || sustainLevel < 0 || sustainLevel > 1 ||
    typeof releaseMs !== "number" || !Number.isInteger(releaseMs) || releaseMs < 0 || releaseMs > 2000
  ) throw new Error("INVALID_ASSET");

  if (value.format === "randusr.sfx") {
    const startFrequencyHz = value.startFrequencyHz;
    const endFrequencyHz = value.endFrequencyHz;
    const durationMs = value.durationMs;
    if (
      Object.keys(value).some((key) => ![...common, "startFrequencyHz", "endFrequencyHz", "durationMs"].includes(key)) ||
      typeof startFrequencyHz !== "number" || !Number.isFinite(startFrequencyHz) || startFrequencyHz < 30 || startFrequencyHz > 4000 ||
      typeof endFrequencyHz !== "number" || !Number.isFinite(endFrequencyHz) || endFrequencyHz < 30 || endFrequencyHz > 4000 ||
      typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < assetLimits.minSoundDurationMs || durationMs > assetLimits.maxSoundDurationMs ||
      attackMs + decayMs + releaseMs > durationMs
    ) throw new Error("INVALID_ASSET");
  } else if (value.format === "randusr.pitched-instrument") {
    if (
      Object.keys(value).some((key) => ![...common, "tuningCents"].includes(key)) ||
      typeof value.tuningCents !== "number" || !Number.isFinite(value.tuningCents) || value.tuningCents < -1200 || value.tuningCents > 1200
    ) throw new Error("INVALID_ASSET");
  } else {
    throw new Error("INVALID_ASSET");
  }

  if (new TextEncoder().encode(JSON.stringify(value)).length > assetLimits.maxSoundRecipeBytes)
    throw new Error("INVALID_ASSET");
}

/** Canonical stable-key clone used for immutable version hashes and exact pins. */
export function canonicalSoundRecipe(value: unknown): SoundRecipeV1 {
  assertSoundRecipe(value);
  const envelope = {
    attackMs: value.envelope.attackMs,
    decayMs: value.envelope.decayMs,
    sustainLevel: value.envelope.sustainLevel,
    releaseMs: value.envelope.releaseMs,
  };
  const voice = {
    waveform: value.waveform,
    pulseWidth: value.pulseWidth,
    noiseAmount: value.noiseAmount,
    volume: value.volume,
    envelope,
  };
  return value.format === "randusr.sfx"
    ? {
        format: "randusr.sfx",
        version: 1,
        ...voice,
        startFrequencyHz: value.startFrequencyHz,
        endFrequencyHz: value.endFrequencyHz,
        durationMs: value.durationMs,
      }
    : {
        format: "randusr.pitched-instrument",
        version: 1,
        ...voice,
        tuningCents: value.tuningCents,
      };
}

/** Clone a validated recipe into stable field order for hashes and JSONB comparisons. */
export function canonicalSpriteAsset(value: unknown): SpriteAssetV1 {
  assertSpriteAsset(value);
  if (value.format === "randusr.indexed-sprite")
    return {
      format: "randusr.indexed-sprite",
      version: 1,
      width: value.width,
      height: value.height,
      pixels: [...value.pixels],
      palette: [...value.palette],
      transparentIndex: value.transparentIndex,
    };
  return {
    format: "randusr.animated-sprite",
    version: 1,
    width: value.width,
    height: value.height,
    frames: value.frames.map((frame) => [...frame]),
    palette: [...value.palette],
    transparentIndex: value.transparentIndex,
    fps: value.fps,
    loop: value.loop,
  };
}

export function indexedSpriteFrame(sprite: SpriteAssetV1, frame = 0): IndexedSpriteV1 {
  if (sprite.format === "randusr.indexed-sprite") return sprite;
  if (!Number.isInteger(frame) || frame < 0 || frame >= sprite.frames.length)
    throw new Error("INVALID_ASSET");
  return {
    format: "randusr.indexed-sprite",
    version: 1,
    width: sprite.width,
    height: sprite.height,
    pixels: sprite.frames[frame],
    palette: sprite.palette,
    transparentIndex: sprite.transparentIndex,
  };
}

export function assertProjectAssetManifest(value: unknown): asserts value is ProjectAssetManifestV1 {
  if (
    !isRecord(value) || value.version !== 1 ||
    Object.keys(value).some((key) => !["version", "sprites", "sounds"].includes(key)) ||
    !Array.isArray(value.sprites) || value.sprites.length > assetLimits.spritesPerProject ||
    (value.sounds !== undefined && (!Array.isArray(value.sounds) || value.sounds.length > assetLimits.soundAssetsPerProject))
  )
    throw new Error("INVALID_ASSET");
  let totalPixels = 0;
  let totalFramePixels = 0;
  const aliases = new Set<string>();
  for (const binding of value.sprites) {
    if (
      !isRecord(binding) ||
      Object.keys(binding).some(
        (key) =>
          !["type", "alias", "name", "assetId", "versionId", "version", "sprite"].includes(key),
      ) ||
      binding.type !== "sprite" ||
      typeof binding.alias !== "string" ||
      !spriteAliasPattern.test(binding.alias) ||
      typeof binding.name !== "string" ||
      !binding.name.trim() ||
      binding.name.length > assetLimits.nameCharacters ||
      /[<>\x00-\x1f]/.test(binding.name)
    )
      throw new Error("INVALID_ASSET");
    if (aliases.has(binding.alias)) throw new Error("INVALID_ASSET");
    aliases.add(binding.alias);
    assertSpriteAsset(binding.sprite);
    totalPixels += binding.sprite.width * binding.sprite.height;
    totalFramePixels += binding.sprite.width * binding.sprite.height * (binding.sprite.format === "randusr.animated-sprite" ? binding.sprite.frames.length : 1);
    if (
      totalPixels > assetLimits.spritePixelsPerProject ||
      totalFramePixels > assetLimits.spriteFramePixelsPerProject
    )
      throw new Error("INVALID_ASSET");
    if (binding.assetId !== undefined && (typeof binding.assetId !== "string" || !isUuid(binding.assetId))) throw new Error("INVALID_ASSET");
    if (binding.versionId !== undefined && (typeof binding.versionId !== "string" || !isUuid(binding.versionId))) throw new Error("INVALID_ASSET");
    if (binding.version !== undefined && (typeof binding.version !== "number" || !Number.isInteger(binding.version) || binding.version < 1 || binding.version > assetLimits.versionsPerAsset)) throw new Error("INVALID_ASSET");
    if (
      (binding.assetId === undefined) !== (binding.versionId === undefined) ||
      (binding.assetId === undefined) !== (binding.version === undefined)
    )
      throw new Error("INVALID_ASSET");
  }
  for (const binding of value.sounds ?? []) {
    if (
      !isRecord(binding) ||
      Object.keys(binding).some((key) => !["type", "alias", "name", "assetId", "versionId", "version", "recipe"].includes(key)) ||
      (binding.type !== "sfx" && binding.type !== "instrument") ||
      typeof binding.alias !== "string" || !spriteAliasPattern.test(binding.alias) ||
      typeof binding.name !== "string" || !binding.name.trim() || binding.name.length > assetLimits.nameCharacters || /[<>\x00-\x1f]/.test(binding.name)
    ) throw new Error("INVALID_ASSET");
    if (aliases.has(binding.alias)) throw new Error("INVALID_ASSET");
    aliases.add(binding.alias);
    assertSoundRecipe(binding.recipe);
    if ((binding.type === "sfx") !== (binding.recipe.format === "randusr.sfx"))
      throw new Error("INVALID_ASSET");
    if (binding.assetId !== undefined && (typeof binding.assetId !== "string" || !isUuid(binding.assetId))) throw new Error("INVALID_ASSET");
    if (binding.versionId !== undefined && (typeof binding.versionId !== "string" || !isUuid(binding.versionId))) throw new Error("INVALID_ASSET");
    if (binding.version !== undefined && (typeof binding.version !== "number" || !Number.isInteger(binding.version) || binding.version < 1 || binding.version > assetLimits.versionsPerAsset)) throw new Error("INVALID_ASSET");
    if (
      (binding.assetId === undefined) !== (binding.versionId === undefined) ||
      (binding.assetId === undefined) !== (binding.version === undefined)
    ) throw new Error("INVALID_ASSET");
  }
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > assetLimits.projectManifestBytes
  )
    throw new Error("INVALID_ASSET");
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function projectSpriteFromAsset(asset: UserSpriteAsset): ProjectSpriteBindingV1 {
  return {
    type: "sprite",
    alias: asset.alias,
    name: asset.name,
    assetId: asset.id,
    versionId: asset.selectedVersion.id,
    version: asset.selectedVersion.number,
    sprite: structuredClone(asset.sprite),
  };
}

export function portableSpriteBinding(binding: ProjectSpriteBindingV1): ProjectSpriteBindingV1 {
  return {
    type: "sprite",
    alias: binding.alias,
    name: binding.name,
    sprite: structuredClone(binding.sprite),
  };
}

export function portableAssetManifest(
  manifest: ProjectAssetManifestV1 | undefined,
): ProjectAssetManifestV1 | undefined {
  return manifest
    ? {
        version: 1,
        sprites: manifest.sprites.map(portableSpriteBinding),
        ...(manifest.sounds?.length
          ? { sounds: manifest.sounds.map(portableSoundBinding) }
          : {}),
      }
    : undefined;
}

export function projectSoundFromAsset(asset: UserSoundAsset): ProjectSoundBindingV1 {
  return {
    type: asset.type,
    alias: asset.alias,
    name: asset.name,
    assetId: asset.id,
    versionId: asset.selectedVersion.id,
    version: asset.selectedVersion.number,
    recipe: canonicalSoundRecipe(asset.recipe),
  };
}

export function portableSoundBinding(binding: ProjectSoundBindingV1): ProjectSoundBindingV1 {
  return {
    type: binding.type,
    alias: binding.alias,
    name: binding.name,
    recipe: canonicalSoundRecipe(binding.recipe),
  };
}

export function soundInsertSnippet(asset: UserSoundAsset): string {
  if (!spriteAliasPattern.test(asset.alias)) throw new Error("INVALID_ASSET");
  return asset.type === "sfx"
    ? `SOUND "${asset.alias}"`
    : `NOTE "C4",0.5,"${asset.alias}"`;
}

export function spriteThumbnail(asset: SpriteAssetV1): SpriteThumbnailV1 {
  const sprite = indexedSpriteFrame(asset);
  const scale = Math.max(1, Math.ceil(Math.max(sprite.width, sprite.height) / assetLimits.thumbnailSide));
  const width = Math.ceil(sprite.width / scale);
  const height = Math.ceil(sprite.height / scale);
  const pixels: number[] = [];
  for (let y = 0; y < sprite.height; y += scale)
    for (let x = 0; x < sprite.width; x += scale)
      pixels.push(sprite.pixels[y * sprite.width + x]);
  return { width, height, pixels, palette: [...sprite.palette], transparentIndex: sprite.transparentIndex };
}

export function spriteSpawnSnippet(alias: string, variable = "SPRITE"): string {
  if (!spriteAliasPattern.test(alias) || !/^[A-Z][A-Z0-9_]{0,15}$/.test(variable)) throw new Error("INVALID_ASSET");
  return `${variable} = SPAWN("${alias}",80,120)`;
}
