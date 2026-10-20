import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  assetLimits,
  canonicalSpriteAsset,
  canonicalSoundRecipe,
  generateSpriteAlias,
  spriteAssetSchema,
  soundRecipeSchema,
  spriteThumbnail,
  type SpriteAssetV1,
  type SoundRecipeV1,
  type UserSoundAsset,
  type UserSoundAssetSummary,
  type UserSpriteAsset,
  type UserSpriteAssetSummary,
} from "../shared/assets.js";
import { userAssets, userAssetVersions, auditLog } from "./db/schema.js";
import type { Database } from "./db/client.js";
import { ApiError } from "./errors.js";
import { cloudUser, lockCloudUser } from "./projects.js";

const assetParams = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;
const versionParams = {
  type: "object",
  additionalProperties: false,
  required: ["id", "number"],
  properties: {
    id: { type: "string", format: "uuid" },
    number: { type: "string", pattern: "^[1-9][0-9]{0,2}$" },
  },
} as const;
const nameSchema = {
  type: "string",
  minLength: 1,
  maxLength: assetLimits.nameCharacters,
  pattern: "^[^<>\\x00-\\x1F]+$",
} as const;
const createBody = {
  type: "object",
  additionalProperties: false,
  required: ["name", "sprite"],
  properties: { name: nameSchema, sprite: spriteAssetSchema },
} as const;
const soundCreateBody = {
  type: "object",
  additionalProperties: false,
  required: ["name", "recipe"],
  properties: { name: nameSchema, recipe: soundRecipeSchema },
} as const;

function cleanName(value: string) {
  const name = value.trim();
  if (!name || name.length > assetLimits.nameCharacters || /[<>\x00-\x1f]/.test(name))
    throw new ApiError(400, "INVALID_INPUT");
  return name;
}

function normalizedSprite(value: unknown): SpriteAssetV1 {
  try {
    return canonicalSpriteAsset(value);
  } catch {
    throw new ApiError(400, "INVALID_INPUT");
  }
}

function normalizedSound(value: unknown): SoundRecipeV1 {
  try { return canonicalSoundRecipe(value); }
  catch { throw new ApiError(400, "INVALID_INPUT"); }
}

function spriteBytes(sprite: unknown) {
  return Buffer.byteLength(JSON.stringify(sprite), "utf8");
}

function digest(sprite: unknown) {
  return createHash("sha256").update(JSON.stringify(sprite)).digest("hex");
}

async function unusedAlias(tx: Tx, ownerId: string, name: string) {
  const [{ alias: rows }] = await tx
    .select({ alias: sql<string[]>`coalesce(array_agg(${userAssets.alias}), '{}')` })
    .from(userAssets)
    .where(eq(userAssets.ownerId, ownerId));
  try {
    return generateSpriteAlias(name, rows ?? []);
  } catch {
    throw new ApiError(409, "QUOTA_EXCEEDED");
  }
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function storedBytes(tx: Database | Tx, ownerId: string) {
  const [result] = await tx
    .select({
      bytes: sql<number>`coalesce(sum(octet_length(${userAssetVersions.sprite}::text)), 0)::int`,
    })
    .from(userAssetVersions)
    .innerJoin(userAssets, eq(userAssets.id, userAssetVersions.assetId))
    .where(eq(userAssets.ownerId, ownerId));
  return result?.bytes ?? 0;
}

async function recordAssetAudit(
  tx: Tx,
  actorId: string,
  action: string,
  targetId: string,
) {
  await tx.insert(auditLog).values({
    actorId,
    action,
    targetType: "asset",
    targetId,
  });
}

function summary(
  asset: typeof userAssets.$inferSelect,
  latest: typeof userAssetVersions.$inferSelect,
): UserSpriteAssetSummary {
  const sprite = latest.sprite as unknown as SpriteAssetV1;
  const version = {
    id: latest.id,
    number: latest.number,
    createdAt: latest.createdAt.toISOString(),
  };
  return {
    id: asset.id,
    type: "sprite",
    name: asset.name,
    alias: asset.alias,
    latestVersion: version,
    thumbnail: spriteThumbnail(sprite),
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

function dto(
  asset: typeof userAssets.$inferSelect,
  latest: typeof userAssetVersions.$inferSelect,
  selected = latest,
): UserSpriteAsset {
  const version = {
    id: selected.id,
    number: selected.number,
    createdAt: selected.createdAt.toISOString(),
  };
  return {
    ...summary(asset, latest),
    thumbnail: spriteThumbnail(selected.sprite as unknown as SpriteAssetV1),
    selectedVersion: version,
    sprite: selected.sprite as unknown as SpriteAssetV1,
  };
}

async function ownedAsset(
  tx: Database | Tx,
  ownerId: string,
  id: string,
  kind: "sprite" | "sound" = "sprite",
) {
  const [asset] = await tx
    .select()
    .from(userAssets)
    .where(
      and(
        eq(userAssets.id, id),
        eq(userAssets.ownerId, ownerId),
        isNull(userAssets.archivedAt),
      ),
    )
    .limit(1);
  if (
    !asset ||
    (kind === "sprite" ? asset.type !== "sprite" : !["sfx", "instrument"].includes(asset.type))
  ) throw new ApiError(404, "NOT_FOUND");
  const [latest] = await tx
    .select()
    .from(userAssetVersions)
    .where(
      and(
        eq(userAssetVersions.assetId, asset.id),
        eq(userAssetVersions.number, asset.latestVersion),
      ),
    )
    .limit(1);
  if (!latest) throw new ApiError(404, "NOT_FOUND");
  return { asset, latest };
}

function soundSummary(
  asset: typeof userAssets.$inferSelect,
  latest: typeof userAssetVersions.$inferSelect,
): UserSoundAssetSummary {
  if (asset.type !== "sfx" && asset.type !== "instrument")
    throw new ApiError(404, "NOT_FOUND");
  return {
    id: asset.id,
    type: asset.type,
    name: asset.name,
    alias: asset.alias,
    latestVersion: {
      id: latest.id,
      number: latest.number,
      createdAt: latest.createdAt.toISOString(),
    },
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

function soundDto(
  asset: typeof userAssets.$inferSelect,
  latest: typeof userAssetVersions.$inferSelect,
  selected = latest,
): UserSoundAsset {
  const recipe = normalizedSound(selected.sprite);
  if ((asset.type === "sfx") !== (recipe.format === "randusr.sfx"))
    throw new ApiError(500, "INTERNAL_ERROR");
  return {
    ...soundSummary(asset, latest),
    selectedVersion: {
      id: selected.id,
      number: selected.number,
      createdAt: selected.createdAt.toISOString(),
    },
    recipe,
  };
}

export function registerAssets(app: FastifyInstance, db: Database) {
  app.get("/api/v1/assets", async (request) => {
    const owner = await cloudUser(db, request);
    const rows = await db
      .select({ asset: userAssets, version: userAssetVersions })
      .from(userAssets)
      .innerJoin(
        userAssetVersions,
        and(
          eq(userAssetVersions.assetId, userAssets.id),
          eq(userAssetVersions.number, userAssets.latestVersion),
        ),
      )
      .where(and(eq(userAssets.ownerId, owner.id), eq(userAssets.type, "sprite"), isNull(userAssets.archivedAt)))
      .orderBy(desc(userAssets.updatedAt), desc(userAssets.id))
      .limit(assetLimits.assetsPerUser);
    return { assets: rows.map((row) => summary(row.asset, row.version)) };
  });

  app.post<{ Body: { name: string; sprite: SpriteAssetV1 } }>(
    "/api/v1/assets",
    {
      schema: { body: createBody },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const owner = await cloudUser(db, request);
      const name = cleanName(request.body.name);
      const sprite = normalizedSprite(request.body.sprite);
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, owner.id);
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(userAssets)
          .where(and(eq(userAssets.ownerId, owner.id), isNull(userAssets.archivedAt)));
        if ((count?.count ?? 0) >= assetLimits.assetsPerUser)
          throw new ApiError(409, "QUOTA_EXCEEDED");
        if ((await storedBytes(tx, owner.id)) + spriteBytes(sprite) > assetLimits.storedBytesPerUser)
          throw new ApiError(409, "QUOTA_EXCEEDED");
        const [asset] = await tx
          .insert(userAssets)
          .values({ ownerId: owner.id, name, alias: await unusedAlias(tx, owner.id, name) })
          .returning();
        const [version] = await tx
          .insert(userAssetVersions)
          .values({ assetId: asset.id, number: 1, sprite: sprite as unknown as Record<string, unknown>, sha256: digest(sprite) })
          .returning();
        await recordAssetAudit(tx, owner.id, "asset.created", asset.id);
        return dto(asset, version);
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/assets/:id",
    { schema: { params: assetParams } },
    async (request) => {
      const owner = await cloudUser(db, request);
      const { asset, latest } = await ownedAsset(db, owner.id, request.params.id);
      return dto(asset, latest);
    },
  );

  app.get<{ Params: { id: string; number: string } }>(
    "/api/v1/assets/:id/versions/:number",
    { schema: { params: versionParams } },
    async (request) => {
      const owner = await cloudUser(db, request);
      const { asset, latest } = await ownedAsset(db, owner.id, request.params.id);
      const number = Number(request.params.number);
      const [selected] = await db
        .select()
        .from(userAssetVersions)
        .where(and(eq(userAssetVersions.assetId, asset.id), eq(userAssetVersions.number, number)))
        .limit(1);
      if (!selected) throw new ApiError(404, "NOT_FOUND");
      return dto(asset, latest, selected);
    },
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/v1/assets/:id",
    {
      schema: {
        params: assetParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: { name: nameSchema },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const owner = await cloudUser(db, request);
      const name = cleanName(request.body.name);
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, owner.id);
        const { asset } = await ownedAsset(tx, owner.id, request.params.id);
        const [updated] = await tx
          .update(userAssets)
          .set({ name, updatedAt: new Date() })
          .where(eq(userAssets.id, asset.id))
          .returning();
        const { latest } = await ownedAsset(tx, owner.id, updated.id);
        await recordAssetAudit(tx, owner.id, "asset.renamed", asset.id);
        return summary(updated, latest);
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { baseVersion: number; sprite: SpriteAssetV1 };
  }>(
    "/api/v1/assets/:id/versions",
    {
      schema: {
        params: assetParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["baseVersion", "sprite"],
          properties: {
            baseVersion: { type: "integer", minimum: 1, maximum: assetLimits.versionsPerAsset },
            sprite: spriteAssetSchema,
          },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const owner = await cloudUser(db, request);
      const sprite = normalizedSprite(request.body.sprite);
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, owner.id);
        const { asset } = await ownedAsset(tx, owner.id, request.params.id);
        if (request.body.baseVersion !== asset.latestVersion)
          throw new ApiError(409, "VERSION_CONFLICT");
        if (asset.latestVersion >= assetLimits.versionsPerAsset)
          throw new ApiError(409, "QUOTA_EXCEEDED");
        if ((await storedBytes(tx, owner.id)) + spriteBytes(sprite) > assetLimits.storedBytesPerUser)
          throw new ApiError(409, "QUOTA_EXCEEDED");
        const number = asset.latestVersion + 1;
        const [version] = await tx
          .insert(userAssetVersions)
          .values({ assetId: asset.id, number, sprite: sprite as unknown as Record<string, unknown>, sha256: digest(sprite) })
          .returning();
        const [updated] = await tx
          .update(userAssets)
          .set({ latestVersion: number, updatedAt: new Date() })
          .where(eq(userAssets.id, asset.id))
          .returning();
        await recordAssetAudit(tx, owner.id, "asset.versioned", asset.id);
        return dto(updated, version);
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/assets/:id",
    {
      schema: { params: assetParams },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const owner = await cloudUser(db, request);
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, owner.id);
        const { asset } = await ownedAsset(tx, owner.id, request.params.id);
        await tx
          .update(userAssets)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(userAssets.id, asset.id));
        await recordAssetAudit(tx, owner.id, "asset.archived", asset.id);
        return { ok: true };
      });
    },
  );

  /* ------------------------------------------------------ private sound recipes */
  app.get("/api/v1/assets/sounds", async (request) => {
    const owner = await cloudUser(db, request);
    const rows = await db
      .select({ asset: userAssets, version: userAssetVersions })
      .from(userAssets)
      .innerJoin(
        userAssetVersions,
        and(
          eq(userAssetVersions.assetId, userAssets.id),
          eq(userAssetVersions.number, userAssets.latestVersion),
        ),
      )
      .where(
        and(
          eq(userAssets.ownerId, owner.id),
          inArray(userAssets.type, ["sfx", "instrument"]),
          isNull(userAssets.archivedAt),
        ),
      )
      .orderBy(desc(userAssets.updatedAt), desc(userAssets.id))
      .limit(assetLimits.assetsPerUser);
    return { assets: rows.map((row) => soundSummary(row.asset, row.version)) };
  });

  app.post<{ Body: { name: string; recipe: SoundRecipeV1 } }>(
    "/api/v1/assets/sounds",
    {
      schema: { body: soundCreateBody },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const owner = await cloudUser(db, request);
      const name = cleanName(request.body.name);
      const recipe = normalizedSound(request.body.recipe);
      const type = recipe.format === "randusr.sfx" ? "sfx" : "instrument";
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, owner.id);
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(userAssets)
          .where(and(eq(userAssets.ownerId, owner.id), isNull(userAssets.archivedAt)));
        if ((count?.count ?? 0) >= assetLimits.assetsPerUser)
          throw new ApiError(409, "QUOTA_EXCEEDED");
        if ((await storedBytes(tx, owner.id)) + spriteBytes(recipe) > assetLimits.storedBytesPerUser)
          throw new ApiError(409, "QUOTA_EXCEEDED");
        const [asset] = await tx
          .insert(userAssets)
          .values({ ownerId: owner.id, type, name, alias: await unusedAlias(tx, owner.id, name) })
          .returning();
        const [version] = await tx
          .insert(userAssetVersions)
          .values({ assetId: asset.id, number: 1, sprite: recipe as unknown as Record<string, unknown>, sha256: digest(recipe) })
          .returning();
        await recordAssetAudit(tx, owner.id, "asset.created", asset.id);
        return soundDto(asset, version);
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/assets/sounds/:id",
    { schema: { params: assetParams } },
    async (request) => {
      const owner = await cloudUser(db, request);
      const { asset, latest } = await ownedAsset(db, owner.id, request.params.id, "sound");
      return soundDto(asset, latest);
    },
  );

  app.get<{ Params: { id: string; number: string } }>(
    "/api/v1/assets/sounds/:id/versions/:number",
    { schema: { params: versionParams } },
    async (request) => {
      const owner = await cloudUser(db, request);
      const { asset, latest } = await ownedAsset(db, owner.id, request.params.id, "sound");
      const [selected] = await db
        .select()
        .from(userAssetVersions)
        .where(and(eq(userAssetVersions.assetId, asset.id), eq(userAssetVersions.number, Number(request.params.number))))
        .limit(1);
      if (!selected) throw new ApiError(404, "NOT_FOUND");
      return soundDto(asset, latest, selected);
    },
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/v1/assets/sounds/:id",
    {
      schema: {
        params: assetParams,
        body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: nameSchema } },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const owner = await cloudUser(db, request);
      const name = cleanName(request.body.name);
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, owner.id);
        const { asset } = await ownedAsset(tx, owner.id, request.params.id, "sound");
        const [updated] = await tx
          .update(userAssets)
          .set({ name, updatedAt: new Date() })
          .where(eq(userAssets.id, asset.id))
          .returning();
        const { latest } = await ownedAsset(tx, owner.id, updated.id, "sound");
        await recordAssetAudit(tx, owner.id, "asset.renamed", asset.id);
        return soundSummary(updated, latest);
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { baseVersion: number; recipe: SoundRecipeV1 };
  }>(
    "/api/v1/assets/sounds/:id/versions",
    {
      schema: {
        params: assetParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["baseVersion", "recipe"],
          properties: {
            baseVersion: { type: "integer", minimum: 1, maximum: assetLimits.versionsPerAsset },
            recipe: soundRecipeSchema,
          },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const owner = await cloudUser(db, request);
      const recipe = normalizedSound(request.body.recipe);
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, owner.id);
        const { asset } = await ownedAsset(tx, owner.id, request.params.id, "sound");
        if ((asset.type === "sfx") !== (recipe.format === "randusr.sfx"))
          throw new ApiError(400, "INVALID_INPUT");
        if (request.body.baseVersion !== asset.latestVersion)
          throw new ApiError(409, "VERSION_CONFLICT");
        if (asset.latestVersion >= assetLimits.versionsPerAsset)
          throw new ApiError(409, "QUOTA_EXCEEDED");
        if ((await storedBytes(tx, owner.id)) + Buffer.byteLength(JSON.stringify(recipe), "utf8") > assetLimits.storedBytesPerUser)
          throw new ApiError(409, "QUOTA_EXCEEDED");
        const number = asset.latestVersion + 1;
        const [version] = await tx
          .insert(userAssetVersions)
          .values({ assetId: asset.id, number, sprite: recipe as unknown as Record<string, unknown>, sha256: digest(recipe) })
          .returning();
        const [updated] = await tx
          .update(userAssets)
          .set({ latestVersion: number, updatedAt: new Date() })
          .where(eq(userAssets.id, asset.id))
          .returning();
        await recordAssetAudit(tx, owner.id, "asset.versioned", asset.id);
        return soundDto(updated, version);
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/assets/sounds/:id",
    {
      schema: { params: assetParams },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const owner = await cloudUser(db, request);
      return db.transaction(async (tx) => {
        await lockCloudUser(tx, owner.id);
        const { asset } = await ownedAsset(tx, owner.id, request.params.id, "sound");
        await tx.update(userAssets).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(userAssets.id, asset.id));
        await recordAssetAudit(tx, owner.id, "asset.archived", asset.id);
        return { ok: true };
      });
    },
  );
}

