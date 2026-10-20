import { sql } from "drizzle-orm";
import { productEvents, type ProductEvent } from "../../shared/analytics.js";
// Migration 0007 stored these pre-card-45 names in a CHECK constraint. Keep its
// historical storage allowlist accurate; the current API never emits them.
const persistedProductEvents = [
  ...productEvents,
  "class_created",
  "class_joined",
  "assignment_created",
  "assignment_submitted",
  "assignment_reviewed",
] as const;
import {
  pgTable,
  customType,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
  foreignKey,
  unique,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true });
const created = () => time("created_at").notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();
export const visibility = pgEnum("project_visibility", [
  "private",
  "unlisted",
  "public",
]);
export const mode = pgEnum("project_mode", ["story", "sandbox"]);
export const userState = pgEnum("user_state", [
  "active",
  "suspended",
  "deleted",
]);
export const moderationState = pgEnum("moderation_state", [
  "active",
  "blocked",
]);
export const reportState = pgEnum("report_state", [
  "open",
  "dismissed",
  "resolved",
]);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    locale: varchar("locale", { length: 16 }).notNull().default("en"),
    isAdmin: boolean("is_admin").notNull().default(false),
    verifiedAt: time("verified_at"),
    state: userState("state").notNull().default("active"),
    termsVersion: text("terms_version"),
    privacyVersion: text("privacy_version"),
    acceptedAt: time("accepted_at"),
    testNoticeVersion: text("test_notice_version"),
    testNoticeAcknowledgedAt: time("test_notice_acknowledged_at"),
    createdAt: created(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    deletedAt: time("deleted_at"),
  },
  (t) => [
    uniqueIndex("users_email_ci").on(sql`lower(${t.email})`),
    check(
      "users_email_normalized",
      sql`${t.email} = lower(trim(${t.email})) and length(${t.email}) > 3`,
    ),
    check(
      "users_admin_verified",
      sql`not ${t.isAdmin} or ${t.verifiedAt} is not null`,
    ),
    check("users_display_name", sql`length(trim(${t.displayName})) > 0`),
  ],
);
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    createdAt: created(),
    expiresAt: time("expires_at").notNull(),
    revokedAt: time("revoked_at"),
  },
  (t) => [
    unique("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user").on(t.userId),
    index("sessions_expiry").on(t.expiresAt),
    index("sessions_activity").on(t.createdAt, t.userId),
  ],
);
// Raw bearer tokens never enter the database. Separate tables prevent cross-purpose use.
const tokenColumns = () => ({
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  createdAt: created(),
  expiresAt: time("expires_at").notNull(),
  usedAt: time("used_at"),
});
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  tokenColumns(),
  (t) => [index("verification_user").on(t.userId)],
);
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  tokenColumns(),
  (t) => [index("reset_user").on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 120 }).notNull().default(""),
    description: varchar("description", { length: 2000 }).notNull().default(""),
    snapshotVersion: integer("snapshot_version").notNull().default(2),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    mode: mode("mode").notNull(),
    storyId: text("story_id"),
    sceneId: integer("scene_id"),
    visibility: visibility("visibility").notNull().default("private"),
    shortCode: varchar("short_code", { length: 32 }).notNull().unique(),
    version: integer("version").notNull().default(1),
    featured: boolean("featured").notNull().default(false),
    publishedRevisionId: uuid("published_revision_id"),
    publishedMetadata: jsonb("published_metadata").$type<{
      title: string;
      description: string;
      tags: string[];
      previewKey: string | null;
    }>(),
    publishedAt: time("published_at"),
    previewKey: text("preview_key"),
    moderationState: moderationState("moderation_state")
      .notNull()
      .default("active"),
    remixedFromRevisionId: uuid("remixed_from_revision_id"),
    createdAt: created(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    archivedAt: time("archived_at"),
    deletedAt: time("deleted_at"),
  },
  (t): PgTableExtraConfigValue[] => [
    index("projects_owner_updated").on(t.ownerId, t.updatedAt, t.id),
    index("projects_gallery")
      .on(t.publishedAt, t.id)
      .where(
        sql`${t.visibility} = 'public' and ${t.moderationState} = 'active' and ${t.deletedAt} is null and ${t.archivedAt} is null`,
      ),
    check(
      "projects_version_positive",
      sql`${t.version} > 0 and ${t.snapshotVersion} > 0`,
    ),
    check(
      "projects_snapshot_object",
      sql`jsonb_typeof(${t.snapshot}) = 'object'`,
    ),
    check(
      "projects_publication_pair",
      sql`(${t.publishedRevisionId} is null) = (${t.publishedAt} is null)`,
    ),
    check(
      "projects_shared_snapshot",
      sql`${t.visibility} = 'private' or ${t.publishedRevisionId} is not null`,
    ),
    foreignKey({
      name: "projects_published_own_revision",
      columns: [t.id, t.publishedRevisionId],
      foreignColumns: [projectRevisions.projectId, projectRevisions.id],
    }),
    foreignKey({
      name: "projects_remix_revision",
      columns: [t.remixedFromRevisionId],
      foreignColumns: [projectRevisions.id],
    }),
  ],
);
export const projectRevisions = pgTable(
  "project_revisions",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    number: integer("number").notNull(),
    snapshotVersion: integer("snapshot_version").notNull().default(2),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    reason: varchar("reason", { length: 32 }).notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("revision_project_number").on(t.projectId, t.number),
    unique("revision_project_id").on(t.projectId, t.id),
    index("revisions_activity").on(t.createdAt, t.actorId),
    check(
      "revision_positive",
      sql`${t.number} > 0 and ${t.snapshotVersion} > 0`,
    ),
    check(
      "revision_snapshot_object",
      sql`jsonb_typeof(${t.snapshot}) = 'object'`,
    ),
  ],
);
export const userAssets = pgTable(
  "user_assets",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 16 }).notNull().default("sprite"),
    name: varchar("name", { length: 64 }).notNull(),
    alias: varchar("alias", { length: 32 }).notNull(),
    latestVersion: integer("latest_version").notNull().default(1),
    createdAt: created(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    archivedAt: time("archived_at"),
  },
  (t) => [
    uniqueIndex("user_assets_owner_alias").on(t.ownerId, t.alias),
    index("user_assets_owner_updated").on(t.ownerId, t.updatedAt, t.id),
    check("user_assets_type", sql`${t.type} in ('sprite', 'sfx', 'instrument')`),
    check(
      "user_assets_name",
      sql`length(trim(${t.name})) between 1 and 64 and ${t.name} !~ '[<>]'`,
    ),
    check("user_assets_alias", sql`${t.alias} ~ '^@[a-z][a-z0-9_-]{0,30}$'`),
    check(
      "user_assets_latest_version",
      sql`${t.latestVersion} between 1 and 100`,
    ),
  ],
);
export const userAssetVersions = pgTable(
  "user_asset_versions",
  {
    id: id(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => userAssets.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    sprite: jsonb("sprite").$type<Record<string, unknown>>().notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("user_asset_versions_asset_number_unique").on(t.assetId, t.number),
    index("user_asset_versions_asset_created").on(t.assetId, t.number),
    check(
      "user_asset_versions_number_check",
      sql`${t.number} between 1 and 100`,
    ),
    check(
      "user_asset_versions_sprite",
      sql`jsonb_typeof(${t.sprite}) = 'object'`,
    ),
    check("user_asset_versions_sha256", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
export const productEventRows = pgTable(
  "product_events",
  {
    id: id(),
    sessionHash: varchar("session_hash", { length: 64 }).notNull(),
    event: varchar("event", { length: 40 }).$type<ProductEvent>().notNull(),
    createdAt: created(),
  },
  (t) => [
    index("product_events_time").on(t.createdAt),
    index("product_events_session_time").on(t.sessionHash, t.createdAt),
    check(
      "product_event_session_hash",
      sql`${t.sessionHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "product_event_known",
      sql`${t.event} in (${sql.raw(persistedProductEvents.map((e) => `'${e}'`).join(","))})`,
    ),
  ],
);
const bytes = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const projectPreviews = pgTable(
  "project_previews",
  {
    id: id(),
    projectId: uuid("project_id").notNull(),
    png: bytes("png").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    width: integer("width").notNull().default(256),
    height: integer("height").notNull().default(192),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "project_previews_project_id_fkey",
      columns: [t.projectId],
      foreignColumns: [projects.id],
    }).onDelete("cascade"),
    index("project_previews_project").on(t.projectId),
    check("preview_dimensions", sql`${t.width}=256 AND ${t.height}=192`),
    check(
      "preview_size",
      sql`${t.byteLength}=octet_length(${t.png}) AND ${t.byteLength} BETWEEN 1 AND 60000`,
    ),
    check("preview_checksum", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
export const tags = pgTable("tags", {
  id: id(),
  slug: varchar("slug", { length: 32 }).notNull().unique(),
});
export const projectTags = pgTable(
  "project_tags",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.tagId] }),
    index("project_tags_tag").on(t.tagId),
  ],
);
export const projectReports = pgTable(
  "project_reports",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id),
    reporterId: uuid("reporter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reason: varchar("reason", { length: 32 }).notNull(),
    detail: varchar("detail", { length: 2000 }),
    state: reportState("state").notNull().default("open"),
    createdAt: created(),
    resolvedAt: time("resolved_at"),
  },
  (t) => [
    index("reports_queue").on(t.state, t.createdAt),
    index("reports_project").on(t.projectId),
  ],
);
export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id),
    userId: uuid("user_id").references(() => users.id),
    reportId: uuid("report_id").references(() => projectReports.id),
    action: varchar("action", { length: 64 }).notNull(),
    reason: varchar("reason", { length: 2000 }).notNull(),
    createdAt: created(),
  },
  (t) => [
    index("moderation_project").on(t.projectId),
    check(
      "moderation_has_target",
      sql`${t.projectId} is not null or ${t.userId} is not null`,
    ),
  ],
);
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id"),
    // Only allowlisted scalar metadata; never passwords, bearer tokens or project source.
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    createdAt: created(),
  },
  (t) => [
    index("audit_actor_time").on(t.actorId, t.createdAt),
    index("audit_target_time").on(t.targetType, t.targetId, t.createdAt),
  ],
);

export const registrationInvitations = pgTable(
  "registration_invitations",
  {
    id: id(),
    email: varchar("email", { length: 320 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    createdAt: created(),
    expiresAt: time("expires_at").notNull(),
    usedAt: time("used_at"),
    revokedAt: time("revoked_at"),
  },
  (t) => [
    unique("registration_invitations_token_hash_key").on(t.tokenHash),
    index("registration_invitations_email").on(t.email),
    check(
      "invitation_email_normalized",
      sql`${t.email} = lower(trim(${t.email}))`,
    ),
  ],
);
