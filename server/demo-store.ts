/**
 * In-memory store for Demo Mode.
 *
 * Privacy/security boundary: this module must never import the PostgreSQL client, the mailer or
 * analytics. Demo projects, revisions, publications and previews exist only in this process and are
 * destroyed with the session or the process. There is no persistence layer to leak into backups.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  CloudProject,
  GalleryProject,
  ProjectPage,
  ProjectSnapshot,
  RemixCredit,
  SharedProject,
} from "../shared/project.js";
import type { Principal } from "../shared/permissions.js";
import {
  canonicalSpriteAsset,
  canonicalSoundRecipe,
  assertProjectAssetManifest,
  assetLimits,
  generateSpriteAlias,
  spriteThumbnail,
  type SpriteAssetV1,
  type SoundRecipeV1,
  type ProjectAssetManifestV1,
  type UserSoundAsset,
  type UserSoundAssetSummary,
  type UserSpriteAsset,
  type UserSpriteAssetSummary,
} from "../shared/assets.js";
import { ApiError } from "./errors.js";
import { isValidProjectInstructions } from "../shared/limits.js";
import {
  normalizeProjectSnapshot,
  portableProjectSnapshot,
} from "../shared/project.js";
import type { DemoConfig } from "./demo-config.js";

export interface DemoProjectRecord {
  id: string;
  ownerId: string;
  version: number;
  title: string;
  description: string;
  mode: "story" | "sandbox";
  visibility: "private" | "unlisted" | "public";
  snapshot: ProjectSnapshot;
  archivedAt: number | null;
  previewKey: string | null;
  publishedRevisionId: string | null;
  publishedMetadata: {
    title: string;
    description: string;
    tags: string[];
    previewKey: string | null;
  } | null;
  publishedAt: number | null;
  featured: boolean;
  moderationState: "active";
  shortCode: string;
  createdAt: number;
  updatedAt: number;
  remixedFromRevisionId: string | null;
}

export interface DemoRevision {
  id: string;
  projectId: string;
  actorId: string;
  number: number;
  snapshot: ProjectSnapshot;
  reason: string;
  createdAt: number;
}

export interface DemoPreview {
  id: string;
  projectId: string;
  png: Buffer;
  createdAt: number;
}

export interface DemoAssetVersion {
  id: string;
  number: number;
  /** The version table's legacy JSONB column stores any validated asset recipe. */
  sprite: SpriteAssetV1 | SoundRecipeV1;
  createdAt: number;
}

export interface DemoAssetRecord {
  id: string;
  ownerId: string;
  type: "sprite" | "sfx" | "instrument";
  name: string;
  alias: string;
  latestVersion: number;
  versions: Map<number, DemoAssetVersion>;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface DemoSession {
  id: string;
  ownerId: string;
  tokenHash: string;
  ip: string;
  locale: string;
  createdAt: number;
  lastSeenAt: number;
  projects: Map<string, DemoProjectRecord>;
  revisions: Map<string, DemoRevision>;
  previews: Map<string, DemoPreview>;
  assets: Map<string, DemoAssetRecord>;
  bytes: number;
  publicationTimes: number[];
  previewTimes: number[];
  requestTimes: number[];
}

export interface DemoLogin {
  token: string;
  session: DemoSession;
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const encodedBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const DEMO_DISPLAY_NAME = "Demo tester";
const MAX_TOMBSTONES = 2000;

export class DemoStore {
  private readonly sessions = new Map<string, DemoSession>();
  private readonly byId = new Map<string, DemoSession>();
  private readonly tombstones = new Map<string, number>();
  private totalBytes = 0;
  private readonly sweeper: NodeJS.Timeout | null;

  constructor(
    readonly config: DemoConfig,
    private readonly now: () => number = Date.now,
    sweepIntervalMs = 60_000,
  ) {
    this.sweeper =
      sweepIntervalMs > 0
        ? setInterval(() => this.sweep(), sweepIntervalMs)
        : null;
    this.sweeper?.unref();
  }

  stop() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  /* ------------------------------------------------------------------ sessions */

  create(ip: string, locale = "en"): DemoLogin {
    this.sweep();
    if (this.sessions.size >= this.config.maxSessions)
      throw new ApiError(429, "RATE_LIMITED");
    let sameIp = 0;
    for (const s of this.sessions.values()) if (s.ip === ip) sameIp++;
    if (sameIp >= this.config.maxSessionsPerIp)
      throw new ApiError(429, "RATE_LIMITED");
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const session: DemoSession = {
      id,
      ownerId: `demo:${id}`,
      tokenHash: sha256(token),
      ip,
      locale,
      createdAt: this.now(),
      lastSeenAt: this.now(),
      projects: new Map(),
      revisions: new Map(),
      previews: new Map(),
      assets: new Map(),
      bytes: 0,
      publicationTimes: [],
      previewTimes: [],
      requestTimes: [],
    };
    this.sessions.set(session.tokenHash, session);
    this.byId.set(session.id, session);
    return { token, session };
  }

  /** Resolve a demo cookie token; expired sessions are destroyed and their links tombstoned. */
  resolve(token: string | undefined): DemoSession | null {
    if (!token || !TOKEN.test(token)) return null;
    const session = this.sessions.get(sha256(token));
    if (!session) return null;
    const at = this.now();
    if (
      at - session.createdAt >= this.config.absoluteMs ||
      at - session.lastSeenAt >= this.config.idleMs
    ) {
      this.destroy(session, "expired");
      return null;
    }
    session.lastSeenAt = at;
    return session;
  }

  /** Sliding one-minute request budget per session. */
  allowRequest(session: DemoSession) {
    const at = this.now();
    session.requestTimes = session.requestTimes.filter((t) => at - t < 60_000);
    if (session.requestTimes.length >= this.config.requestPerMinute)
      return false;
    session.requestTimes.push(at);
    return true;
  }

  principal(session: DemoSession): Principal {
    return {
      id: session.ownerId,
      verified: true,
      active: true,
      isAdmin: false,
      demo: true,
    };
  }

  destroy(session: DemoSession, reason: string) {
    for (const p of session.projects.values()) {
      if (
        p.publishedAt !== null &&
        p.publishedRevisionId !== null &&
        p.visibility !== "private"
      )
        this.tombstone(p.shortCode);
    }
    this.totalBytes -= session.bytes;
    session.bytes = 0;
    this.sessions.delete(session.tokenHash);
    this.byId.delete(session.id);
    session.projects.clear();
    session.revisions.clear();
    session.previews.clear();
    session.assets.clear();
    void reason;
  }

  sweep() {
    const at = this.now();
    for (const session of [...this.sessions.values()]) {
      if (
        at - session.createdAt >= this.config.absoluteMs ||
        at - session.lastSeenAt >= this.config.idleMs
      )
        this.destroy(session, "expired");
    }
    for (const [code, expires] of this.tombstones)
      if (expires <= at) this.tombstones.delete(code);
    while (this.tombstones.size > MAX_TOMBSTONES) {
      const oldest = this.tombstones.keys().next().value;
      if (typeof oldest !== "string") break;
      this.tombstones.delete(oldest);
    }
  }

  /** Test helper: expire every session without waiting for wall-clock time. */
  expireAll() {
    for (const session of [...this.sessions.values()])
      this.destroy(session, "expired");
  }

  stats() {
    return {
      sessions: this.sessions.size,
      projects: [...this.sessions.values()].reduce(
        (n, s) => n + s.projects.size,
        0,
      ),
      bytes: this.totalBytes,
    };
  }

  private tombstone(code: string) {
    this.tombstones.set(code, this.now() + this.config.tombstoneMs);
  }

  isExpiredCode(code: string) {
    const at = this.tombstones.get(code);
    return at !== undefined && at > this.now();
  }

  hasCode(code: string) {
    return this.findByCode(code) !== null || this.isExpiredCode(code);
  }

  private findByCode(code: string) {
    for (const session of this.sessions.values())
      for (const project of session.projects.values())
        if (project.shortCode === code) return { session, project };
    return null;
  }

  private uniqueCode() {
    for (let i = 0; i < 4; i++) {
      const code = randomBytes(12).toString("base64url");
      if (!this.hasCode(code)) return code;
    }
    throw new ApiError(503, "UNAVAILABLE");
  }

  /* ------------------------------------------------------------ byte accounting */

  private reserve(session: DemoSession, delta: number) {
    if (delta <= 0) {
      session.bytes += delta;
      this.totalBytes += delta;
      return;
    }
    if (session.bytes + delta > this.config.maxSessionBytes)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    if (this.totalBytes + delta > this.config.maxStoreBytes)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    session.bytes += delta;
    this.totalBytes += delta;
  }

  private release(session: DemoSession, delta: number) {
    if (delta <= 0) return;
    session.bytes = Math.max(0, session.bytes - delta);
    this.totalBytes = Math.max(0, this.totalBytes - delta);
  }

  /* ------------------------------------------------------------ private sprites */

  private validSprite(value: unknown): SpriteAssetV1 {
    try {
      return canonicalSpriteAsset(value);
    } catch {
      throw new ApiError(400, "INVALID_INPUT");
    }
  }

  private assetOr404(session: DemoSession, id: string, kind: "sprite" | "sound" = "sprite") {
    const asset = session.assets.get(id);
    if (
      !asset || asset.ownerId !== session.ownerId || asset.archivedAt !== null ||
      (kind === "sprite" ? asset.type !== "sprite" : !["sfx", "instrument"].includes(asset.type))
    )
      throw new ApiError(404, "NOT_FOUND");
    return asset;
  }

  private assetPayloadBytes(session: DemoSession) {
    let bytes = 0;
    for (const asset of session.assets.values())
      for (const version of asset.versions.values())
        bytes += encodedBytes(version.sprite);
    return bytes;
  }

  private assetDto(
    asset: DemoAssetRecord,
    selected: DemoAssetVersion,
  ): UserSpriteAsset {
    if (asset.type !== "sprite" || !("format" in selected.sprite && String(selected.sprite.format).includes("sprite")))
      throw new ApiError(404, "NOT_FOUND");
    const sprite = selected.sprite as SpriteAssetV1;
    const latest = asset.versions.get(asset.latestVersion)!;
    const version = (item: DemoAssetVersion) => ({
      id: item.id,
      number: item.number,
      createdAt: new Date(item.createdAt).toISOString(),
    });
    return {
      id: asset.id,
      type: "sprite",
      name: asset.name,
      alias: asset.alias,
      latestVersion: version(latest),
      selectedVersion: version(selected),
      thumbnail: spriteThumbnail(sprite),
      sprite: structuredClone(sprite),
      createdAt: new Date(asset.createdAt).toISOString(),
      updatedAt: new Date(asset.updatedAt).toISOString(),
    };
  }

  private assetSummary(asset: DemoAssetRecord): UserSpriteAssetSummary {
    if (asset.type !== "sprite") throw new ApiError(404, "NOT_FOUND");
    const latest = asset.versions.get(asset.latestVersion)!;
    const item = this.assetDto(asset, latest);
    const { selectedVersion: _selectedVersion, sprite: _sprite, ...summary } = item;
    return summary;
  }

  listAssets(session: DemoSession) {
    const assets = [...session.assets.values()]
      .filter((asset) => asset.archivedAt === null && asset.type === "sprite")
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
      .map((asset) => this.assetSummary(asset));
    return { assets };
  }

  getAsset(session: DemoSession, id: string, number?: number) {
    const asset = this.assetOr404(session, id, "sprite");
    const latest = asset.versions.get(asset.latestVersion);
    const selected = number === undefined ? latest : asset.versions.get(number);
    if (!latest || !selected) throw new ApiError(404, "NOT_FOUND");
    return this.assetDto(asset, selected);
  }

  createAsset(
    session: DemoSession,
    input: { name: string; sprite: SpriteAssetV1 },
  ) {
    const name = input.name.trim();
    if (!name || name.length > assetLimits.nameCharacters || /[<>\x00-\x1f]/.test(name))
      throw new ApiError(400, "INVALID_INPUT");
    const sprite = this.validSprite(input.sprite);
    const activeCount = [...session.assets.values()].filter(
      (asset) => asset.archivedAt === null,
    ).length;
    if (activeCount >= assetLimits.assetsPerUser)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    const payloadBytes = encodedBytes(sprite);
    if (this.assetPayloadBytes(session) + payloadBytes > assetLimits.storedBytesPerUser)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    let alias: string;
    try {
      alias = generateSpriteAlias(
        name,
        [...session.assets.values()].map((asset) => asset.alias),
      );
    } catch {
      throw new ApiError(409, "QUOTA_EXCEEDED");
    }
    const at = this.now();
    const version: DemoAssetVersion = {
      id: randomUUID(),
      number: 1,
      sprite,
      createdAt: at,
    };
    const asset: DemoAssetRecord = {
      id: randomUUID(),
      ownerId: session.ownerId,
      type: "sprite",
      name,
      alias,
      latestVersion: 1,
      versions: new Map([[1, version]]),
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
    };
    this.reserve(session, encodedBytes({ id: asset.id, name, alias, sprite }));
    session.assets.set(asset.id, asset);
    return this.assetDto(asset, version);
  }

  saveAssetVersion(
    session: DemoSession,
    id: string,
    baseVersion: number,
    value: SpriteAssetV1,
  ) {
    const asset = this.assetOr404(session, id, "sprite");
    if (asset.latestVersion !== baseVersion)
      throw new ApiError(409, "VERSION_CONFLICT");
    if (asset.latestVersion >= assetLimits.versionsPerAsset)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    const sprite = this.validSprite(value);
    const payloadBytes = encodedBytes(sprite);
    if (this.assetPayloadBytes(session) + payloadBytes > assetLimits.storedBytesPerUser)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    this.reserve(session, encodedBytes(sprite));
    const number = asset.latestVersion + 1;
    const version: DemoAssetVersion = {
      id: randomUUID(),
      number,
      sprite,
      createdAt: this.now(),
    };
    asset.versions.set(number, version);
    asset.latestVersion = number;
    asset.updatedAt = this.now();
    return this.assetDto(asset, version);
  }

  renameAsset(session: DemoSession, id: string, value: string) {
    const asset = this.assetOr404(session, id, "sprite");
    const name = value.trim();
    if (!name || name.length > assetLimits.nameCharacters || /[<>\x00-\x1f]/.test(name))
      throw new ApiError(400, "INVALID_INPUT");
    asset.name = name;
    asset.updatedAt = this.now();
    return this.assetSummary(asset);
  }

  archiveAsset(session: DemoSession, id: string) {
    const asset = this.assetOr404(session, id, "sprite");
    asset.archivedAt = this.now();
    asset.updatedAt = this.now();
    return { ok: true };
  }

  private soundAssetOr404(session: DemoSession, id: string) {
    return this.assetOr404(session, id, "sound");
  }

  private soundAssetSummary(asset: DemoAssetRecord): UserSoundAssetSummary {
    if (asset.type !== "sfx" && asset.type !== "instrument")
      throw new ApiError(404, "NOT_FOUND");
    const latest = asset.versions.get(asset.latestVersion)!;
    return {
      id: asset.id,
      type: asset.type,
      name: asset.name,
      alias: asset.alias,
      latestVersion: {
        id: latest.id,
        number: latest.number,
        createdAt: new Date(latest.createdAt).toISOString(),
      },
      createdAt: new Date(asset.createdAt).toISOString(),
      updatedAt: new Date(asset.updatedAt).toISOString(),
    };
  }

  private soundAssetDto(asset: DemoAssetRecord, selected: DemoAssetVersion): UserSoundAsset {
    if (asset.type !== "sfx" && asset.type !== "instrument")
      throw new ApiError(404, "NOT_FOUND");
    const recipe = canonicalSoundRecipe(selected.sprite);
    if ((asset.type === "sfx") !== (recipe.format === "randusr.sfx"))
      throw new ApiError(500, "INTERNAL_ERROR");
    return {
      ...this.soundAssetSummary(asset),
      selectedVersion: {
        id: selected.id,
        number: selected.number,
        createdAt: new Date(selected.createdAt).toISOString(),
      },
      recipe,
    };
  }

  listSoundAssets(session: DemoSession) {
    const assets = [...session.assets.values()]
      .filter((asset) => asset.archivedAt === null && asset.type !== "sprite")
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
      .map((asset) => this.soundAssetSummary(asset));
    return { assets };
  }

  getSoundAsset(session: DemoSession, id: string, number?: number) {
    const asset = this.soundAssetOr404(session, id);
    const selected = asset.versions.get(number ?? asset.latestVersion);
    if (!selected) throw new ApiError(404, "NOT_FOUND");
    return this.soundAssetDto(asset, selected);
  }

  createSoundAsset(session: DemoSession, input: { name: string; recipe: SoundRecipeV1 }) {
    const name = input.name.trim();
    if (!name || name.length > assetLimits.nameCharacters || /[<>\x00-\x1f]/.test(name))
      throw new ApiError(400, "INVALID_INPUT");
    let recipe: SoundRecipeV1;
    try { recipe = canonicalSoundRecipe(input.recipe); }
    catch { throw new ApiError(400, "INVALID_INPUT"); }
    const type = recipe.format === "randusr.sfx" ? "sfx" : "instrument";
    const activeCount = [...session.assets.values()].filter((asset) => asset.archivedAt === null).length;
    if (activeCount >= assetLimits.assetsPerUser)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    const payloadBytes = encodedBytes(recipe);
    if (payloadBytes > assetLimits.maxSoundRecipeBytes || this.assetPayloadBytes(session) + payloadBytes > assetLimits.storedBytesPerUser)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    let alias: string;
    try { alias = generateSpriteAlias(name, [...session.assets.values()].map((asset) => asset.alias)); }
    catch { throw new ApiError(409, "QUOTA_EXCEEDED"); }
    const at = this.now();
    const version: DemoAssetVersion = { id: randomUUID(), number: 1, sprite: recipe, createdAt: at };
    const asset: DemoAssetRecord = {
      id: randomUUID(), ownerId: session.ownerId, type, name, alias,
      latestVersion: 1, versions: new Map([[1, version]]),
      createdAt: at, updatedAt: at, archivedAt: null,
    };
    this.reserve(session, encodedBytes({ id: asset.id, type, name, alias, recipe }));
    session.assets.set(asset.id, asset);
    return this.soundAssetDto(asset, version);
  }

  saveSoundAssetVersion(session: DemoSession, id: string, baseVersion: number, value: SoundRecipeV1) {
    const asset = this.soundAssetOr404(session, id);
    if (asset.latestVersion !== baseVersion) throw new ApiError(409, "VERSION_CONFLICT");
    if (asset.latestVersion >= assetLimits.versionsPerAsset) throw new ApiError(409, "QUOTA_EXCEEDED");
    let recipe: SoundRecipeV1;
    try { recipe = canonicalSoundRecipe(value); }
    catch { throw new ApiError(400, "INVALID_INPUT"); }
    if ((asset.type === "sfx") !== (recipe.format === "randusr.sfx"))
      throw new ApiError(400, "INVALID_INPUT");
    const payloadBytes = encodedBytes(recipe);
    if (this.assetPayloadBytes(session) + payloadBytes > assetLimits.storedBytesPerUser)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    this.reserve(session, payloadBytes);
    const number = asset.latestVersion + 1;
    const version: DemoAssetVersion = { id: randomUUID(), number, sprite: recipe, createdAt: this.now() };
    asset.versions.set(number, version);
    asset.latestVersion = number;
    asset.updatedAt = this.now();
    return this.soundAssetDto(asset, version);
  }

  renameSoundAsset(session: DemoSession, id: string, value: string) {
    const asset = this.soundAssetOr404(session, id);
    const name = value.trim();
    if (!name || name.length > assetLimits.nameCharacters || /[<>\x00-\x1f]/.test(name))
      throw new ApiError(400, "INVALID_INPUT");
    asset.name = name;
    asset.updatedAt = this.now();
    return this.soundAssetSummary(asset);
  }

  archiveSoundAsset(session: DemoSession, id: string) {
    const asset = this.soundAssetOr404(session, id);
    asset.archivedAt = this.now();
    asset.updatedAt = this.now();
    return { ok: true };
  }

  /* ------------------------------------------------------------------- projects */

  private projectOr404(session: DemoSession, id: string) {
    const project = session.projects.get(id);
    if (!project || project.ownerId !== session.ownerId)
      throw new ApiError(404, "NOT_FOUND");
    return project;
  }

  getProject(session: DemoSession, id: string) {
    return this.projectOr404(session, id);
  }

  private assertSnapshot(session: DemoSession, snapshot: ProjectSnapshot) {
    if (
      snapshot.sceneId > snapshot.unlocked ||
      (snapshot.instructions !== undefined &&
        !isValidProjectInstructions(snapshot.instructions))
    )
      throw new ApiError(400, "INVALID_INPUT");
    if (snapshot.assetManifest !== undefined) {
      try {
        assertProjectAssetManifest(snapshot.assetManifest);
      } catch {
        throw new ApiError(400, "INVALID_INPUT");
      }
      for (const binding of snapshot.assetManifest.sprites) {
        if (!binding.assetId) continue;
        const asset = session.assets.get(binding.assetId);
        const version = asset?.versions.get(binding.version ?? -1);
        if (
          !asset ||
          asset.ownerId !== session.ownerId ||
          asset.alias !== binding.alias ||
          !version ||
          version.id !== binding.versionId ||
          JSON.stringify(version.sprite) !==
            JSON.stringify(this.validSprite(binding.sprite))
        )
          throw new ApiError(404, "NOT_FOUND");
      }
      for (const binding of snapshot.assetManifest.sounds ?? []) {
        if (!binding.assetId) continue;
        const asset = session.assets.get(binding.assetId);
        const version = asset?.versions.get(binding.version ?? -1);
        let recipe: SoundRecipeV1;
        try { recipe = canonicalSoundRecipe(binding.recipe); }
        catch { throw new ApiError(400, "INVALID_INPUT"); }
        if (
          !asset || asset.ownerId !== session.ownerId || asset.type !== binding.type ||
          asset.alias !== binding.alias || !version || version.id !== binding.versionId ||
          JSON.stringify(version.sprite) !== JSON.stringify(recipe)
        ) throw new ApiError(404, "NOT_FOUND");
      }
    }
  }

  createProject(
    session: DemoSession,
    snapshot: ProjectSnapshot,
    description = "",
  ) {
    this.assertSnapshot(session, snapshot);
    if (session.projects.size >= this.config.maxProjects)
      throw new ApiError(409, "QUOTA_EXCEEDED");
    const capture = normalizeProjectSnapshot(structuredClone(snapshot));
    const cost = encodedBytes(capture) + encodedBytes(capture);
    this.reserve(session, cost);
    const at = this.now();
    const project: DemoProjectRecord = {
      id: randomUUID(),
      ownerId: session.ownerId,
      version: 1,
      title: capture.title,
      description,
      mode: capture.mode,
      visibility: "private",
      snapshot: capture,
      archivedAt: null,
      previewKey: null,
      publishedRevisionId: null,
      publishedMetadata: null,
      publishedAt: null,
      featured: false,
      moderationState: "active",
      shortCode: this.uniqueCode(),
      createdAt: at,
      updatedAt: at,
      remixedFromRevisionId: null,
    };
    const revision: DemoRevision = {
      id: randomUUID(),
      projectId: project.id,
      actorId: session.ownerId,
      number: 1,
      snapshot: structuredClone(capture),
      reason: "create",
      createdAt: at,
    };
    session.projects.set(project.id, project);
    session.revisions.set(revision.id, revision);
    return project;
  }

  listProjects(
    session: DemoSession,
    filters: {
      q?: string;
      mode?: "story" | "sandbox";
      visibility?: "private" | "unlisted" | "public";
      archived?: boolean;
    },
  ): ProjectPage {
    const term = filters.q?.trim().toLowerCase();
    const projects = [...session.projects.values()]
      .filter((p) => (filters.archived ? !!p.archivedAt : !p.archivedAt))
      .filter((p) => (filters.mode ? p.mode === filters.mode : true))
      .filter((p) =>
        filters.visibility ? p.visibility === filters.visibility : true,
      )
      .filter((p) => (term ? p.title.toLowerCase().includes(term) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
    return {
      projects: projects.map((p) => {
        const { snapshot: _snapshot, ...summary } = this.projectDto(p);
        return summary;
      }),
      nextCursor: null,
    };
  }

  saveProject(
    session: DemoSession,
    id: string,
    version: number,
    snapshot: ProjectSnapshot,
    description?: string,
  ) {
    const project = this.projectOr404(session, id);
    if (project.version !== version)
      throw new ApiError(409, "VERSION_CONFLICT");
    if (project.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
    this.assertSnapshot(session, snapshot);
    const capture = normalizeProjectSnapshot({
      ...structuredClone(snapshot),
      // A legacy client save must not clear instructions added by a newer client.
      instructions:
        snapshot.instructions ?? project.snapshot.instructions ?? "",
    });
    const previous = encodedBytes(project.snapshot);
    const added = encodedBytes(capture) * 2;
    this.reserve(session, added - previous);
    project.version += 1;
    this.insertRevision(session, project, capture, "save", project.version);
    project.snapshot = capture;
    project.title = capture.title;
    project.mode = capture.mode;
    if (description !== undefined) project.description = description;
    project.updatedAt = this.now();
    return project;
  }

  duplicateProject(
    session: DemoSession,
    id: string,
    version: number,
    title?: string,
  ) {
    const project = this.projectOr404(session, id);
    if (project.version !== version)
      throw new ApiError(409, "VERSION_CONFLICT");
    return this.createProject(
      session,
      title ? { ...project.snapshot, title: title.trim() } : project.snapshot,
      project.description,
    );
  }

  setArchived(
    session: DemoSession,
    id: string,
    version: number,
    archived: boolean,
  ) {
    const project = this.projectOr404(session, id);
    if (project.version !== version)
      throw new ApiError(409, "VERSION_CONFLICT");
    project.archivedAt = archived ? this.now() : null;
    if (archived) {
      project.visibility = "private";
      project.publishedRevisionId = null;
      project.publishedMetadata = null;
      project.publishedAt = null;
    }
    project.version += 1;
    project.updatedAt = this.now();
    return project;
  }

  deleteProject(session: DemoSession, id: string, version: number) {
    const project = this.projectOr404(session, id);
    if (project.version !== version)
      throw new ApiError(409, "VERSION_CONFLICT");
    if (project.publishedAt !== null && project.visibility !== "private")
      this.tombstone(project.shortCode);
    this.release(session, encodedBytes(project.snapshot));
    session.projects.delete(project.id);
    for (const revision of [...session.revisions.values()]) {
      if (revision.projectId !== project.id) continue;
      this.release(session, encodedBytes(revision.snapshot));
      session.revisions.delete(revision.id);
    }
    for (const preview of [...session.previews.values()]) {
      if (preview.projectId !== project.id) continue;
      this.release(session, preview.png.byteLength);
      session.previews.delete(preview.id);
    }
  }

  /* ------------------------------------------------------------------ revisions */

  private insertRevision(
    session: DemoSession,
    project: DemoProjectRecord,
    snapshot: ProjectSnapshot,
    reason: string,
    number: number,
  ) {
    const revision: DemoRevision = {
      id: randomUUID(),
      projectId: project.id,
      actorId: session.ownerId,
      number,
      snapshot: structuredClone(snapshot),
      reason,
      createdAt: this.now(),
    };
    session.revisions.set(revision.id, revision);
    this.pruneRevisions(session, project);
    return revision;
  }

  private pruneRevisions(session: DemoSession, project: DemoProjectRecord) {
    const pinned = new Set(
      [project.publishedRevisionId, project.remixedFromRevisionId].filter(
        (id): id is string => typeof id === "string",
      ),
    );
    const revisions = [...session.revisions.values()]
      .filter((r) => r.projectId === project.id)
      .sort((a, b) => b.number - a.number);
    for (const [index, revision] of revisions.entries()) {
      if (index < this.config.maxRevisions) continue;
      if (pinned.has(revision.id)) continue;
      this.release(session, encodedBytes(revision.snapshot));
      session.revisions.delete(revision.id);
    }
  }

  revisions(session: DemoSession, projectId: string, before?: number) {
    this.projectOr404(session, projectId);
    const rows = [...session.revisions.values()]
      .filter(
        (r) =>
          r.projectId === projectId &&
          (before === undefined || r.number < before),
      )
      .sort((a, b) => b.number - a.number);
    const page = rows.slice(0, 30);
    return {
      revisions: page.map((r) => ({
        id: r.id,
        number: r.number,
        createdAt: new Date(r.createdAt).toISOString(),
        actorName: DEMO_DISPLAY_NAME,
        summary: r.snapshot.sourceCode.slice(0, 80),
      })),
      nextBefore: rows.length > 30 ? page.at(-1)!.number : null,
    };
  }

  revision(session: DemoSession, projectId: string, revisionId: string) {
    this.projectOr404(session, projectId);
    const revision = session.revisions.get(revisionId);
    if (!revision || revision.projectId !== projectId)
      throw new ApiError(404, "NOT_FOUND");
    return {
      id: revision.id,
      number: revision.number,
      snapshot: normalizeProjectSnapshot(structuredClone(revision.snapshot)),
      createdAt: new Date(revision.createdAt).toISOString(),
    };
  }

  restoreRevision(
    session: DemoSession,
    projectId: string,
    revisionId: string,
    version: number,
  ) {
    const project = this.projectOr404(session, projectId);
    if (project.version !== version)
      throw new ApiError(409, "VERSION_CONFLICT");
    if (project.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
    const revision = session.revisions.get(revisionId);
    if (!revision || revision.projectId !== projectId)
      throw new ApiError(404, "NOT_FOUND");
    const capture = normalizeProjectSnapshot({
      ...structuredClone(revision.snapshot),
      // A pre-feature revision has no instructions to restore; keep current project metadata.
      instructions:
        revision.snapshot.instructions ?? project.snapshot.instructions ?? "",
      title: project.title,
      updatedAt: new Date(this.now()).toISOString(),
    });
    this.assertSnapshot(session, capture);
    const previous = encodedBytes(project.snapshot);
    const added = encodedBytes(capture) * 2;
    this.reserve(session, added - previous);
    project.version += 1;
    this.insertRevision(session, project, capture, "restore", project.version);
    project.snapshot = capture;
    project.title = capture.title;
    project.mode = capture.mode;
    project.updatedAt = this.now();
    return project;
  }

  copyRevision(session: DemoSession, projectId: string, revisionId: string) {
    this.projectOr404(session, projectId);
    const revision = session.revisions.get(revisionId);
    if (!revision || revision.projectId !== projectId)
      throw new ApiError(404, "NOT_FOUND");
    const at = new Date(this.now()).toISOString();
    return this.createProject(
      session,
      { ...structuredClone(revision.snapshot), createdAt: at, updatedAt: at },
      "",
    );
  }

  /* ------------------------------------------------------------------ publishing */

  shareInfo(session: DemoSession, projectId: string, baseUrl: string) {
    const project = this.projectOr404(session, projectId);
    return {
      version: project.version,
      title: project.title,
      description: project.description,
      tags: project.publishedMetadata?.tags ?? [],
      visibility: project.visibility,
      url: this.shareUrl(baseUrl, project.shortCode),
      shortCode: project.shortCode,
      previewUrl: project.previewKey
        ? `/api/v1/demo/projects/${project.id}/preview/${project.previewKey}`
        : null,
      remixedFrom: this.remixCredit(project),
    };
  }

  remixCredit(project: DemoProjectRecord): RemixCredit | null {
    if (!project.remixedFromRevisionId) return null;
    const gone = { title: null, author: null, shortCode: null };
    for (const owner of this.sessions.values()) {
      const revision = owner.revisions.get(project.remixedFromRevisionId);
      if (!revision) continue;
      const source = owner.projects.get(revision.projectId);
      if (
        !source ||
        source.visibility === "private" ||
        source.archivedAt ||
        !source.publishedMetadata
      )
        return gone;
      return {
        title: source.publishedMetadata.title,
        author: DEMO_DISPLAY_NAME,
        shortCode: source.shortCode,
      };
    }
    return gone;
  }

  publish(
    session: DemoSession,
    projectId: string,
    body: {
      version: number;
      visibility: "private" | "unlisted" | "public";
      title?: string;
      description?: string;
      tags?: string[];
      previewPng?: Buffer;
    },
    _baseUrl?: string,
  ) {
    const project = this.projectOr404(session, projectId);
    if (project.version !== body.version)
      throw new ApiError(409, "VERSION_CONFLICT");
    if (project.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
    if (body.visibility !== "private") {
      const at = this.now();
      session.publicationTimes = session.publicationTimes.filter(
        (t) => at - t < 15 * 60_000,
      );
      if (
        session.publicationTimes.length >= this.config.publicationsPer15Minutes
      )
        throw new ApiError(429, "RATE_LIMITED");
    }
    if (body.visibility === "private") {
      project.visibility = "private";
      project.publishedRevisionId = null;
      project.publishedMetadata = null;
      project.publishedAt = null;
      project.version += 1;
      project.updatedAt = this.now();
      return project;
    }
    const title = body.title?.trim();
    if (!title) throw new ApiError(400, "INVALID_INPUT");
    const capture = normalizeProjectSnapshot({
      ...structuredClone(project.snapshot),
      title,
      updatedAt: new Date(this.now()).toISOString(),
    });
    const previous = encodedBytes(project.snapshot);
    this.reserve(session, encodedBytes(capture) * 2 - previous);
    const revision = this.insertRevision(
      session,
      project,
      capture,
      "publish",
      project.version + 1,
    );
    const previewKey = body.previewPng
      ? this.storePreview(session, project.id, body.previewPng)
      : project.previewKey;
    project.visibility = body.visibility;
    project.publishedRevisionId = revision.id;
    project.publishedMetadata = {
      title,
      description: body.description ?? "",
      tags: body.tags ?? [],
      previewKey,
    };
    project.publishedAt = this.now();
    project.snapshot = capture;
    project.title = title;
    project.description = body.description ?? "";
    project.previewKey = previewKey;
    project.version += 1;
    project.updatedAt = this.now();
    session.publicationTimes.push(this.now());
    return project;
  }

  rotateShareLink(session: DemoSession, projectId: string, version: number) {
    const project = this.projectOr404(session, projectId);
    if (project.version !== version)
      throw new ApiError(409, "VERSION_CONFLICT");
    if (project.visibility !== "unlisted")
      throw new ApiError(400, "INVALID_INPUT");
    project.shortCode = this.uniqueCode();
    project.version += 1;
    project.updatedAt = this.now();
    return project;
  }

  shared(session: DemoSession | null, code: string): SharedProject {
    const found = this.findByCode(code);
    if (!found) {
      // A tombstoned link is "expired" for everybody, including other demo sessions.
      if (this.isExpiredCode(code)) throw new ApiError(410, "DEMO_EXPIRED");
      throw new ApiError(404, "NOT_FOUND");
    }
    const { session: owner, project } = found;
    const isOwner = session?.ownerId === owner.ownerId;
    const previewBase = session
      ? `/api/v1/demo/shared/${code}/preview`
      : `/api/v1/shared/${code}/preview`;
    const author = { id: project.ownerId, displayName: DEMO_DISPLAY_NAME };
    if (project.visibility === "private") {
      if (!isOwner) throw new ApiError(404, "NOT_FOUND");
      return {
        demo: true,
        shortCode: project.shortCode,
        visibility: "private",
        title: project.title,
        description: project.description,
        tags: [],
        author,
        publishedAt: null,
        snapshot: normalizeProjectSnapshot(structuredClone(project.snapshot)),
        ownerProjectId: project.id,
        previewUrl: project.previewKey
          ? `${previewBase}/${project.previewKey}`
          : null,
      };
    }
    if (!project.publishedRevisionId || !project.publishedMetadata)
      throw new ApiError(404, "NOT_FOUND");
    const revision = owner.revisions.get(project.publishedRevisionId);
    if (!revision) throw new ApiError(404, "NOT_FOUND");
    return {
      demo: true,
      remixable: found.session.id === session?.id,
      shortCode: project.shortCode,
      visibility: project.visibility,
      title: project.publishedMetadata.title,
      description: project.publishedMetadata.description,
      tags: project.publishedMetadata.tags,
      author,
      publishedAt: new Date(
        project.publishedAt ?? project.updatedAt,
      ).toISOString(),
      revisionId: revision.id,
      snapshot: portableProjectSnapshot(
        normalizeProjectSnapshot(structuredClone(revision.snapshot)),
      ),
      previewUrl: project.publishedMetadata.previewKey
        ? `${previewBase}/${project.publishedMetadata.previewKey}`
        : null,
      ...(isOwner ? { ownerProjectId: project.id } : {}),
    };
  }

  /** Anonymous/incognito access from the production share route. */
  publicShared(code: string): SharedProject {
    if (this.isExpiredCode(code)) throw new ApiError(410, "DEMO_EXPIRED");
    const found = this.findByCode(code);
    if (!found || found.project.visibility === "private")
      throw new ApiError(404, "NOT_FOUND");
    const { project, session } = found;
    if (!project.publishedRevisionId || !project.publishedMetadata)
      throw new ApiError(404, "NOT_FOUND");
    const revision = session.revisions.get(project.publishedRevisionId);
    if (!revision) throw new ApiError(404, "NOT_FOUND");
    return {
      demo: true,
      shortCode: project.shortCode,
      visibility: project.visibility,
      title: project.publishedMetadata.title,
      description: project.publishedMetadata.description,
      tags: project.publishedMetadata.tags,
      author: { id: project.ownerId, displayName: DEMO_DISPLAY_NAME },
      publishedAt: new Date(
        project.publishedAt ?? project.updatedAt,
      ).toISOString(),
      revisionId: revision.id,
      snapshot: portableProjectSnapshot(
        normalizeProjectSnapshot(structuredClone(revision.snapshot)),
      ),
      previewUrl: project.publishedMetadata.previewKey
        ? `/api/v1/shared/${code}/preview/${project.publishedMetadata.previewKey}`
        : null,
    };
  }

  gallery(
    session: DemoSession,
    filters: { q?: string; tag?: string; sort?: "recent" | "featured" },
  ): { projects: GalleryProject[]; nextCursor: null } {
    const term = filters.q?.trim().toLowerCase();
    const rows = [...session.projects.values()]
      .filter(
        (p) =>
          p.visibility === "public" &&
          p.publishedAt !== null &&
          p.publishedMetadata !== null &&
          !p.archivedAt,
      )
      .filter((p) =>
        filters.tag ? p.publishedMetadata!.tags.includes(filters.tag) : true,
      )
      .filter((p) =>
        term
          ? p.publishedMetadata!.title.toLowerCase().includes(term) ||
            p.publishedMetadata!.description.toLowerCase().includes(term) ||
            p.publishedMetadata!.tags.join(" ").includes(term)
          : true,
      )
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    return {
      projects: rows.map((p) => ({
        shortCode: p.shortCode,
        title: p.publishedMetadata!.title,
        description: p.publishedMetadata!.description,
        tags: p.publishedMetadata!.tags,
        author: DEMO_DISPLAY_NAME,
        publishedAt: new Date(p.publishedAt!).toISOString(),
        revisionId: p.publishedRevisionId!,
        featured: false,
        mode: p.snapshot.mode,
        previewUrl: p.publishedMetadata!.previewKey
          ? `/api/v1/demo/shared/${p.shortCode}/preview/${p.publishedMetadata!.previewKey}`
          : null,
      })),
      nextCursor: null,
    };
  }

  remix(session: DemoSession, code: string, title?: string) {
    const found = this.findByCode(code);
    if (found && found.session.id !== session.id) {
      // The link is visible and runnable, but copies stay inside the session that made it.
      if (found.project.visibility === "private")
        throw new ApiError(404, "NOT_FOUND");
      throw new ApiError(403, "DEMO_FOREIGN_REMIX");
    }
    if (
      !found ||
      found.project.visibility === "private" ||
      !found.project.publishedRevisionId ||
      !found.project.publishedMetadata
    )
      throw new ApiError(404, "NOT_FOUND");
    const revision = found.session.revisions.get(
      found.project.publishedRevisionId,
    );
    if (!revision) throw new ApiError(404, "NOT_FOUND");
    const at = new Date(this.now()).toISOString();
    const copy = this.createProject(
      session,
      {
        ...structuredClone(revision.snapshot),
        ...(title ? { title: title.trim() } : {}),
        createdAt: at,
        updatedAt: at,
      },
      found.project.publishedMetadata.description,
    );
    copy.remixedFromRevisionId = revision.id;
    const sourcePreview = found.project.publishedMetadata.previewKey
      ? found.session.previews.get(found.project.publishedMetadata.previewKey)
      : undefined;
    if (sourcePreview) {
      try {
        this.storePreview(session, copy.id, Buffer.from(sourcePreview.png));
      } catch {
        /* a copy without a picture is still a valid copy */
      }
    }
    return copy;
  }

  /* -------------------------------------------------------------------- previews */

  storePreview(session: DemoSession, projectId: string, png: Buffer): string {
    const project = this.projectOr404(session, projectId);
    const at = this.now();
    session.previewTimes = session.previewTimes.filter(
      (t) => at - t < 15 * 60_000,
    );
    if (session.previewTimes.length >= this.config.previewsPer15Minutes)
      throw new ApiError(429, "RATE_LIMITED");
    this.reserve(session, png.byteLength);
    const preview: DemoPreview = {
      id: randomUUID(),
      projectId,
      png,
      createdAt: at,
    };
    session.previews.set(preview.id, preview);
    project.previewKey = preview.id;
    session.previewTimes.push(at);
    this.prunePreviews(session, project);
    return preview.id;
  }

  private prunePreviews(session: DemoSession, project: DemoProjectRecord) {
    const keep = new Set(
      [project.previewKey, project.publishedMetadata?.previewKey].filter(
        (id): id is string => typeof id === "string",
      ),
    );
    for (const preview of [...session.previews.values()]) {
      if (preview.projectId !== project.id || keep.has(preview.id)) continue;
      this.release(session, preview.png.byteLength);
      session.previews.delete(preview.id);
    }
  }

  projectPreview(session: DemoSession, projectId: string, key: string) {
    const project = this.projectOr404(session, projectId);
    const preview = session.previews.get(key);
    if (!preview || preview.projectId !== project.id)
      throw new ApiError(404, "NOT_FOUND");
    if (
      project.previewKey !== key &&
      project.publishedMetadata?.previewKey !== key
    )
      throw new ApiError(404, "NOT_FOUND");
    return preview.png;
  }

  sharedPreview(code: string, key: string) {
    if (this.isExpiredCode(code)) throw new ApiError(410, "DEMO_EXPIRED");
    const found = this.findByCode(code);
    if (!found || found.project.visibility === "private")
      throw new ApiError(404, "NOT_FOUND");
    if (found.project.publishedMetadata?.previewKey !== key)
      throw new ApiError(404, "NOT_FOUND");
    const preview = found.session.previews.get(key);
    if (!preview) throw new ApiError(404, "NOT_FOUND");
    return preview.png;
  }

  /* ----------------------------------------------------------------------- DTOs */

  projectDto(project: DemoProjectRecord): CloudProject {
    return {
      id: project.id,
      shortCode: project.shortCode,
      version: project.version,
      title: project.title,
      description: project.description,
      mode: project.mode,
      visibility: project.visibility,
      updatedAt: new Date(project.updatedAt).toISOString(),
      archived: !!project.archivedAt,
      previewUrl: project.previewKey
        ? `/api/v1/demo/projects/${project.id}/preview/${project.previewKey}`
        : null,
      snapshot: normalizeProjectSnapshot(structuredClone(project.snapshot)),
      ...(project.remixedFromRevisionId
        ? { remixedFrom: this.remixCredit(project) }
        : {}),
    };
  }

  shareUrl(baseUrl: string, code: string) {
    return new URL(`/p/${code}`, baseUrl).href;
  }
}
