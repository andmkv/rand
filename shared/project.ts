import {
  portableAssetManifest,
  type ProjectAssetManifestV1,
} from "./assets.js";

/** Portable v2 snapshot: source is data, never executable server code. */
export interface ProjectSnapshot {
  format: "randusr";
  version: 2;
  title: string;
  /** Optional on the wire for v2 files and snapshots created before this field existed. */
  instructions?: string;
  /** Version-pinned sprite payloads; absent on legacy projects. */
  assetManifest?: ProjectAssetManifestV1;
  sourceCode: string;
  mode: "story" | "sandbox";
  createdAt: string;
  updatedAt: string;
  storyId: "tower";
  sceneId: number;
  unlocked: number;
  exampleId: string | null;
}

/** Normalize snapshots created before instructions became part of the project contract. */
export function normalizeProjectSnapshot(
  snapshot: ProjectSnapshot,
): ProjectSnapshot {
  return { ...snapshot, instructions: snapshot.instructions ?? "" };
}

/** Self-contained snapshot safe for portable files and anonymous published viewers. */
export function portableProjectSnapshot(
  snapshot: ProjectSnapshot,
): ProjectSnapshot {
  const assetManifest = portableAssetManifest(snapshot.assetManifest);
  return {
    ...snapshot,
    ...(assetManifest ? { assetManifest } : {}),
  };
}

/** Where a Remix came from; every field is null once the source is no longer shared. */
export interface RemixCredit {
  title: string | null;
  author: string | null;
  shortCode: string | null;
}
export interface CloudProject {
  previewUrl?: string | null;
  remixedFrom?: RemixCredit | null;
  shortCode?: string;
  id: string;
  version: number;
  title: string;
  description: string;
  mode: "story" | "sandbox";
  visibility: "private" | "unlisted" | "public";
  updatedAt: string;
  archived: boolean;
  snapshot: ProjectSnapshot;
}
export type CloudSummary = Omit<CloudProject, "snapshot">;
export interface ProjectPage {
  projects: CloudSummary[];
  nextCursor: string | null;
}

export interface SharedProject {
  /** Temporary demo publication; never index and show the demo-expired state after TTL. */
  demo?: boolean;
  /** Demo only: false when the publication belongs to another demo session. */
  remixable?: boolean;
  previewUrl?: string | null;
  shortCode: string;
  visibility: "private" | "unlisted" | "public";
  title: string;
  description: string;
  tags: string[];
  author: { id: string; displayName: string };
  publishedAt: string | null;
  snapshot: ProjectSnapshot;
  ownerProjectId?: string;
  revisionId?: string;
}

export interface GalleryProject {
  shortCode: string;
  title: string;
  description: string;
  tags: string[];
  author: string;
  publishedAt: string;
  revisionId: string;
  featured: boolean;
  mode: "story" | "sandbox";
  previewUrl: string | null;
}
export interface GalleryPage {
  projects: GalleryProject[];
  nextCursor: string | null;
}
