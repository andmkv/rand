/** Product contract after card 45: guest + registered account + protected admin flag. */
export interface Principal {
  id: string;
  verified: boolean;
  active: boolean;
  isAdmin: boolean;
  /** Disposable UAT session; never an administrator and never a PostgreSQL user. */
  demo?: boolean;
}
export const permissionRules = {
  localEditor: "anyone",
  browsePublic: "anyone",
  viewShared: "anyone",
  cloudProjects: "verified",
  publish: "verified",
  remix: "verified",
  accountSettings: "signedIn",
  administer: "admin",
} as const;
export type Permission = keyof typeof permissionRules;
export function can(
  principal: Principal | null,
  permission: Permission,
): boolean {
  const rule = permissionRules[permission];
  if (rule === "anyone") return true;
  if (!principal?.active) return false;
  if (rule === "signedIn") return true;
  if (!principal.verified) return false;
  if (rule === "admin") return principal.isAdmin;
  return rule === "verified";
}
export type Visibility = "private" | "unlisted" | "public";
export interface ProjectAccess {
  ownerId: string;
  visibility: Visibility;
  available: boolean;
}
export function canReadProject(
  p: Principal | null,
  project: ProjectAccess,
): boolean {
  if (can(p, "administer")) return true;
  if (p?.active && p.verified && p.id === project.ownerId) return true;
  return project.available && project.visibility !== "private";
}
export function canEditProject(
  p: Principal | null,
  project: ProjectAccess,
): boolean {
  return can(p, "cloudProjects") && p?.id === project.ownerId;
}
// Admin overrides use explicit audited admin APIs, not ordinary owner endpoints.
