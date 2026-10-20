import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  users,
  registrationInvitations,
  sessions,
  emailVerificationTokens,
  passwordResetTokens,
  projects,
  projectRevisions,
  projectTags,
  moderationActions,
  auditLog,
  userAssets,
} from "./db/schema.js";
import { protectLastAdmin, type AdminTx } from "./admin-access.js";
import { ApiError } from "./errors.js";
/** Shared account-deletion semantics for self-service and explicit audited admin support. */
export async function deleteAccountData(
  tx: AdminTx,
  userId: string,
  actorId: string,
  reason: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('randusr.admin-authority'))`,
  );
  const [u] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .for("no key update");
  if (!u) throw new ApiError(404, "NOT_FOUND");
  if (u.state === "deleted") return;
  await protectLastAdmin(tx, u);
  const now = new Date(),
    date = now.toISOString();
  // Serialize against saves; project identity survives only where historical FK references need it.
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerId, userId))
    .orderBy(projects.id)
    .for("update");
  // Other people's copies stay theirs; provenance must not indefinitely pin erased private source.
  await tx.execute(
    sql`update projects p set remixed_from_revision_id=null where exists(select 1 from project_revisions r join projects original on original.id=r.project_id where r.id=p.remixed_from_revision_id and original.owner_id=${userId})`,
  );
  await tx.execute(
    sql`delete from project_tags pt using projects p where p.id=pt.project_id and p.owner_id=${userId}`,
  );
  await tx.execute(
    sql`delete from project_previews a using projects p where a.project_id=p.id and p.owner_id=${userId}`,
  );
  const erased = {
    format: "randusr",
    version: 2,
    title: "Deleted project",
    sourceCode: "",
    mode: "sandbox",
    createdAt: date,
    updatedAt: date,
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: null,
  };
  await tx
    .update(projects)
    .set({
      title: erased.title,
      description: "",
      snapshot: erased,
      snapshotVersion: 2,
      mode: "sandbox",
      storyId: "tower",
      sceneId: 0,
      visibility: "private",
      featured: false,
      publishedRevisionId: null,
      publishedMetadata: null,
      publishedAt: null,
      previewKey: null,
      remixedFromRevisionId: null,
      moderationState: "blocked",
      deletedAt: now,
      archivedAt: now,
      updatedAt: now,
      version: sql`${projects.version}+1`,
    })
    .where(eq(projects.ownerId, userId));
  await tx
    .update(projectRevisions)
    .set({ actorId: null })
    .where(eq(projectRevisions.actorId, userId));
  await tx
    .update(moderationActions)
    .set({ actorId: null })
    .where(eq(moderationActions.actorId, userId));
  await tx
    .update(auditLog)
    .set({ actorId: null })
    .where(eq(auditLog.actorId, userId));
  // Unreferenced private revisions are erased; published and remix pins keep their snapshots.
  await tx.execute(sql`delete from project_revisions r using projects p where r.project_id=p.id and p.owner_id=${userId}
   and not exists(select 1 from projects other where other.published_revision_id=r.id or other.remixed_from_revision_id=r.id)`);
  await tx
    .delete(registrationInvitations)
    .where(eq(registrationInvitations.email, u.email));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, userId));
  await tx
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, userId));
  const assets = await tx
    .select({ id: userAssets.id })
    .from(userAssets)
    .where(eq(userAssets.ownerId, userId));
  if (assets.length) {
    await tx
      .delete(auditLog)
      .where(
        and(
          eq(auditLog.targetType, "asset"),
          inArray(
            auditLog.targetId,
            assets.map((asset) => asset.id),
          ),
        ),
      );
  }
  await tx.delete(userAssets).where(eq(userAssets.ownerId, userId));
  await tx
    .update(users)
    .set({
      email: `removed-${randomBytes(16).toString("hex")}@removed.invalid`,
      displayName: "Deleted user",
      passwordHash: randomBytes(32).toString("hex"),
      locale: "en",
      isAdmin: false,
      verifiedAt: null,
      state: "deleted",
      termsVersion: null,
      privacyVersion: null,
      acceptedAt: null,
      testNoticeVersion: null,
      testNoticeAcknowledgedAt: null,
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
  await tx.insert(auditLog).values({
    actorId: actorId === userId ? null : actorId,
    action: "account.deleted",
    targetType: "user",
    targetId: userId,
    metadata: { reason },
  });
}
