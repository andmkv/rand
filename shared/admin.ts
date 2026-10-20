import type { ProjectSnapshot } from "./project.js";
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  verified: boolean;
  verifiedAt: string | null;
  state: "active" | "suspended" | "deleted";
  createdAt: string;
  updatedAt: string;
}
export interface AdminUserDetail extends AdminUser {
  locale: string;
  projectCount: number;
  publicCount: number;
  lastSessionAt: string | null;
  activeSessions: number;
}
export interface AdminUserPage {
  users: AdminUser[];
  nextCursor: string | null;
}
export interface AdminProject {
  id: string;
  title: string;
  owner: { id: string; displayName: string };
  shortCode: string;
  visibility: "private" | "unlisted" | "public";
  moderationState: "active" | "blocked";
  featured: boolean;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}
export interface AdminProjectPage {
  projects: AdminProject[];
  nextCursor: string | null;
}
export interface AdminProjectDetail extends Omit<
  AdminProject,
  "updatedAt" | "deletedAt"
> {
  description: string;
  revisionId: string | null;
  deleted: boolean;
  archived: boolean;
  snapshot: ProjectSnapshot;
  publishedSnapshot: ProjectSnapshot | null;
  publishedMetadata: {
    title: string;
    description: string;
    tags: string[];
    previewKey: string | null;
  } | null;
}
export interface AuditEvent {
  id: string;
  actorId: string | null;
  targetId: string | null;
  targetType: string;
  action: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}
export interface AuditPage {
  events: AuditEvent[];
  nextCursor: string | null;
}
export interface ModerationPage {
  actions: {
    id: string;
    actorId: string | null;
    reason: string;
    action: string;
    createdAt: string;
  }[];
  nextCursor: string | null;
}
export interface AdminReportPage {
  reports: {
    id: string;
    reason: string;
    detail: string | null;
    state: string;
    createdAt: string;
  }[];
  nextCursor?: string | null;
}
export type InvitationStatus = "active" | "expired" | "used" | "revoked";
export interface AdminInvitation {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  status: InvitationStatus;
  mechanism: string | null;
}
export interface InvitationPage {
  invitations: AdminInvitation[];
  nextCursor: string | null;
}
