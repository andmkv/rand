import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { buildApp } from "../app.js";
import { users, sessions, projectRevisions, userAssets, userAssetVersions } from "../db/schema.js";
import { hashToken, sessionCookie } from "../access.js";
import { Mailer, MemoryMail } from "../mail.js";
import { DemoStore } from "../demo-store.js";
import type { DemoConfig } from "../demo-config.js";
import type { ProjectSnapshot } from "../../shared/project.js";
import type {
  AnimatedSpriteV1,
  IndexedSpriteV1,
  ProjectSpriteBindingV1,
  ProjectSoundBindingV1,
  PitchedInstrumentV1,
  SfxRecipeV1,
} from "../../shared/assets.js";

let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  app: ReturnType<typeof buildApp>,
  csrf: string,
  csrfCookie: string,
  demo: DemoStore;
const tokens: Record<string, string> = {};
const origin = "http://localhost:5173";
const sprite: IndexedSpriteV1 = {
  format: "randusr.indexed-sprite",
  version: 1,
  width: 2,
  height: 2,
  pixels: [0, 1, 1, 0],
  palette: [15, 4],
  transparentIndex: 0,
};
const animation: AnimatedSpriteV1 = {
  format: "randusr.animated-sprite",
  version: 1,
  width: 2,
  height: 2,
  frames: [
    [0, 1, 1, 0],
    [1, 0, 0, 1],
    [0, 1, 0, 1],
    [1, 0, 1, 0],
  ],
  palette: [15, 4],
  transparentIndex: 0,
  fps: 6,
  loop: true,
};
const laserRecipe: SfxRecipeV1 = {
  format: "randusr.sfx",
  version: 1,
  waveform: "sawtooth",
  pulseWidth: 0.5,
  noiseAmount: 0.2,
  volume: 0.72,
  envelope: { attackMs: 3, decayMs: 40, sustainLevel: 0.16, releaseMs: 100 },
  startFrequencyHz: 1500,
  endFrequencyHz: 90,
  durationMs: 220,
};
const instrumentRecipe: PitchedInstrumentV1 = {
  format: "randusr.pitched-instrument",
  version: 1,
  waveform: "triangle",
  pulseWidth: 0.5,
  noiseAmount: 0,
  volume: 0.8,
  envelope: { attackMs: 20, decayMs: 60, sustainLevel: 0.65, releaseMs: 180 },
  tuningCents: 12,
};
const baseSnapshot = (): ProjectSnapshot => ({
  format: "randusr",
  version: 2,
  title: "Pinned sprite",
  instructions: "",
  sourceCode: 'HERO = SPAWN("@hero",12,20)',
  mode: "sandbox",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  storyId: "tower",
  sceneId: 0,
  unlocked: 0,
  exampleId: null,
});

async function request(
  role: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  payload?: unknown,
  demoToken?: string,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    payload,
    headers: {
      origin,
      "x-csrf-token": csrf,
      cookie: [
        csrfCookie,
        tokens[role] ? `${sessionCookie}=${tokens[role]}` : "",
        demoToken ? `randusr_demo_session=${demoToken}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    },
  });
}

before(
  async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg.db);
    for (const [name, verified] of [
      ["owner", true],
      ["other", true],
      ["unverified", false],
      ["quota", true],
    ] as const) {
      const [user] = await pg.db
        .insert(users)
        .values({
          email: `assets-${name}@example.invalid`,
          displayName: name,
          passwordHash: "not-used-by-test",
          verifiedAt: verified ? new Date() : null,
        })
        .returning();
      tokens[name] = randomBytes(32).toString("base64url");
      await pg.db.insert(sessions).values({
        userId: user.id,
        tokenHash: hashToken(tokens[name]),
        expiresAt: new Date(Date.now() + 600000),
      });
    }
    const config = {
      baseUrl: origin,
      secureCookies: false,
      adminEmail: "admin@example.invalid",
      sessionDays: 14,
      publicRegistrationEnabled: false,
      mailer: new Mailer(new MemoryMail(), origin),
    };
    const demoConfig = {
      enabled: true,
      idleMs: 60 * 60_000,
      absoluteMs: 24 * 60 * 60_000,
      maxSessions: 20,
      maxSessionsPerIp: 10,
      maxProjects: 20,
      maxRevisions: 50,
      maxSessionBytes: 4 * 1024 * 1024,
      maxStoreBytes: 32 * 1024 * 1024,
      tombstoneMs: 7 * 24 * 60 * 60_000,
      requestPerMinute: 100,
      loginPer15Minutes: 100,
      publicationsPer15Minutes: 20,
      previewPer15Minutes: 20,
    } satisfies DemoConfig;
    demo = new DemoStore(demoConfig, Date.now, 0);
    app = buildApp(pg.db, false, config, undefined, demo);
    const response = await app.inject("/api/v1/auth/csrf");
    csrf = response.json().token;
    const cookie = response.cookies.find((item) => item.name === "randusr_csrf")!;
    csrfCookie = `${cookie.name}=${cookie.value}`;
  },
  { timeout: 150000 },
);

after(async () => {
  await app?.close();
  await pg?.stop();
});

test("private sprite API, pinned project revisions, public portability, and quotas", async () => {
  assert.equal((await request("guest", "GET", "/assets")).statusCode, 401);
  assert.equal(
    (
      await request("unverified", "POST", "/assets", {
        name: "Hero",
        sprite,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request("owner", "POST", "/assets", {
        name: "Broken",
        sprite: { ...sprite, pixels: [0] },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("owner", "POST", "/assets", {
        name: "Too large",
        sprite: { ...sprite, width: 65 },
      })
    ).statusCode,
    400,
  );

  const created = await request("owner", "POST", "/assets", {
    name: "Hero",
    sprite,
  });
  assert.equal(created.statusCode, 200, created.body);
  const original = created.json();
  assert.equal(original.alias, "@hero");
  assert.equal(original.selectedVersion.number, 1);
  assert.deepEqual(original.sprite, sprite);
  assert.equal(original.thumbnail.width, 2);
  assert.equal(
    (await request("other", "GET", `/assets/${original.id}`)).statusCode,
    404,
  );
  assert.deepEqual((await request("other", "GET", "/assets")).json().assets, []);

  const bindingV1: ProjectSpriteBindingV1 = {
    type: "sprite",
    alias: original.alias,
    name: original.name,
    assetId: original.id,
    versionId: original.selectedVersion.id,
    version: 1,
    sprite: original.sprite,
  };
  const snapshotV1 = {
    ...baseSnapshot(),
    assetManifest: { version: 1 as const, sprites: [bindingV1] },
  };
  const foreignProject = await request("other", "POST", "/projects", {
    snapshot: snapshotV1,
  });
  assert.equal(foreignProject.statusCode, 404);

  const projectResponse = await request("owner", "POST", "/projects", {
    snapshot: snapshotV1,
  });
  assert.equal(projectResponse.statusCode, 200, projectResponse.body);
  const project = projectResponse.json();
  assert.deepEqual(project.snapshot.assetManifest.sprites[0].sprite, sprite);
  const createdHistory = await pg.db
    .select()
    .from(projectRevisions)
    .where(eq(projectRevisions.projectId, project.id));
  assert.equal(createdHistory.length, 1);
  assert.deepEqual(
    (createdHistory[0].snapshot as unknown as ProjectSnapshot).assetManifest,
    snapshotV1.assetManifest,
  );

  const publishedResponse = await request(
    "owner",
    "POST",
    `/projects/${project.id}/share`,
    { version: project.version, visibility: "public", title: project.title },
  );
  assert.equal(publishedResponse.statusCode, 200, publishedResponse.body);
  const published = publishedResponse.json();

  const editedSprite = { ...sprite, pixels: [1, 1, 1, 1] };
  const nextVersionResponse = await request(
    "owner",
    "POST",
    `/assets/${original.id}/versions`,
    { baseVersion: 1, sprite: editedSprite },
  );
  assert.equal(nextVersionResponse.statusCode, 200, nextVersionResponse.body);
  assert.equal(nextVersionResponse.json().selectedVersion.number, 2);
  assert.equal(
    (
      await request("owner", "POST", `/assets/${original.id}/versions`, {
        baseVersion: 1,
        sprite: editedSprite,
      })
    ).json().error.code,
    "VERSION_CONFLICT",
  );
  const exactOldVersion = await request(
    "owner",
    "GET",
    `/assets/${original.id}/versions/1`,
  );
  assert.deepEqual(exactOldVersion.json().sprite, sprite);
  const versions = await pg.db
    .select()
    .from(userAssetVersions)
    .where(eq(userAssetVersions.assetId, original.id));
  versions.sort((a, b) => a.number - b.number);
  assert.equal(versions.length, 2);
  assert.deepEqual(versions[0].sprite, sprite);
  await assert.rejects(
    pg.db
      .update(userAssetVersions)
      .set({ sprite: editedSprite })
      .where(eq(userAssetVersions.id, versions[0].id)),
  );

  const renamed = await request("owner", "PATCH", `/assets/${original.id}`, {
    name: "Champion",
  });
  assert.equal(renamed.json().alias, "@hero");
  assert.equal(renamed.json().name, "Champion");

  const bindingV2: ProjectSpriteBindingV1 = {
    ...bindingV1,
    versionId: nextVersionResponse.json().selectedVersion.id,
    version: 2,
    sprite: editedSprite,
  };
  const updatedProject = await request(
    "owner",
    "PUT",
    `/projects/${project.id}`,
    {
      version: published.version,
      snapshot: {
        ...snapshotV1,
        assetManifest: { version: 1, sprites: [bindingV2] },
      },
    },
  );
  assert.equal(updatedProject.statusCode, 200, updatedProject.body);
  assert.deepEqual(updatedProject.json().snapshot.assetManifest.sprites[0].sprite, editedSprite);

  const visitor = await app.inject(`/api/v1/shared/${published.shortCode}`);
  assert.equal(visitor.statusCode, 200, visitor.body);
  const publicBinding = visitor.json().snapshot.assetManifest.sprites[0];
  assert.deepEqual(publicBinding.sprite, sprite);
  assert.equal(publicBinding.alias, "@hero");
  assert.equal(Object.hasOwn(publicBinding, "assetId"), false);
  assert.equal(Object.hasOwn(publicBinding, "versionId"), false);
  assert.equal(Object.hasOwn(publicBinding, "version"), false);

  const history = await request("owner", "GET", `/projects/${project.id}/revisions`);
  assert.equal(history.statusCode, 200, history.body);
  assert.ok(history.json().revisions.length >= 3);
  const createRevision = createdHistory[0];
  const restored = await request(
    "owner",
    "POST",
    `/projects/${project.id}/revisions/${createRevision.id}/restore`,
    { version: updatedProject.json().version },
  );
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(restored.json().snapshot.assetManifest.sprites[0].sprite, sprite);

  const legacy = await request("owner", "POST", "/projects", {
    snapshot: baseSnapshot(),
  });
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(legacy.json().snapshot.assetManifest, undefined);

  const [quotaOwner] = await pg.db
    .select({ ownerId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(tokens.quota)));
  const quotaAssets = await pg.db
    .insert(userAssets)
    .values(
      Array.from({ length: 64 }, (_, index) => ({
        ownerId: quotaOwner.ownerId,
        name: `Sprite ${index}`,
        alias: `@quota-${index}`,
      })),
    )
    .returning({ id: userAssets.id });
  const tinySprite = {
    format: "randusr.indexed-sprite" as const,
    version: 1 as const,
    width: 1,
    height: 1,
    pixels: [0],
    palette: [0],
    transparentIndex: null,
  };
  await pg.db.insert(userAssetVersions).values(
    quotaAssets.map(({ id }) => ({
      assetId: id,
      number: 1,
      sprite: tinySprite,
      sha256: "0".repeat(64),
    })),
  );
  const overflow = await request("quota", "POST", "/assets", {
    name: "Sprite 64",
    sprite: tinySprite,
  });
  assert.equal(overflow.statusCode, 409);
  assert.equal(overflow.json().error.code, "QUOTA_EXCEEDED");

  await pg.db.insert(userAssetVersions).values(
    Array.from({ length: 98 }, (_, index) => ({
      assetId: original.id,
      number: index + 3,
      sprite: editedSprite,
      sha256: "1".repeat(64),
    })),
  );
  await pg.db
    .update(userAssets)
    .set({ latestVersion: 100 })
    .where(eq(userAssets.id, original.id));
  const tooManyVersions = await request("owner", "POST", `/assets/${original.id}/versions`, {
    baseVersion: 100,
    sprite: editedSprite,
  });
  assert.equal(tooManyVersions.statusCode, 409);
  assert.equal(tooManyVersions.json().error.code, "QUOTA_EXCEEDED");

  const [storageOwner] = await pg.db
    .select({ ownerId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(tokens.other)));
  const largeAssets = await pg.db
    .insert(userAssets)
    .values(
      Array.from({ length: 8 }, (_, index) => ({
        ownerId: storageOwner.ownerId,
        name: `Large ${index}`,
        alias: `@large-${index}`,
        latestVersion: 60,
      })),
    )
    .returning({ id: userAssets.id });
  const largeSprite = {
    format: "randusr.indexed-sprite" as const,
    version: 1 as const,
    width: 64,
    height: 64,
    pixels: Array.from({ length: 4096 }, () => 0),
    palette: [0],
    transparentIndex: null,
  };
  const largeVersions = largeAssets.flatMap(({ id }) =>
    Array.from({ length: 60 }, (_, index) => ({
      assetId: id,
      number: index + 1,
      sprite: largeSprite,
      sha256: "2".repeat(64),
    })),
  );
  // Keep each bind payload small enough for constrained disposable PostgreSQL containers.
  for (let offset = 0; offset < largeVersions.length; offset += 16) {
    await pg.db
      .insert(userAssetVersions)
      .values(largeVersions.slice(offset, offset + 16));
  }
  const storageOverflow = await request("other", "POST", "/assets", {
    name: "Storage overflow",
    sprite: tinySprite,
  });
  assert.equal(storageOverflow.statusCode, 409);
  assert.equal(storageOverflow.json().error.code, "QUOTA_EXCEEDED");

  const archived = await request("owner", "DELETE", `/assets/${original.id}`);
  assert.equal(archived.statusCode, 200, archived.body);
  assert.equal(
    (await request("owner", "GET", `/assets/${original.id}`)).statusCode,
    404,
  );
  assert.equal(
    (await app.inject(`/api/v1/shared/${published.shortCode}`)).statusCode,
    200,
  );
  const exportResponse = await request("owner", "GET", "/account/export");
  assert.equal(exportResponse.statusCode, 200, exportResponse.body);
  const exported = exportResponse.body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(exported.some((record) => record.recordType === "asset" && record.data.id === original.id));
  assert.ok(exported.some((record) => record.recordType === "assetVersion" && record.data.id === versions[0].id));
});

test("animated payloads use immutable cloud versions and pinned public snapshots", async () => {
  const created = await request("owner", "POST", "/assets", {
    name: "Walker",
    sprite: animation,
  });
  assert.equal(created.statusCode, 200, created.body);
  const asset = created.json();
  assert.deepEqual(asset.sprite, animation);
  assert.equal(
    (await request("other", "GET", `/assets/${asset.id}`)).statusCode,
    404,
  );

  const binding: ProjectSpriteBindingV1 = {
    type: "sprite",
    alias: asset.alias,
    name: asset.name,
    assetId: asset.id,
    versionId: asset.selectedVersion.id,
    version: 1,
    sprite: asset.sprite,
  };
  const snapshot = {
    ...baseSnapshot(),
    assetManifest: { version: 1 as const, sprites: [binding] },
  };
  const projectResponse = await request("owner", "POST", "/projects", { snapshot });
  assert.equal(projectResponse.statusCode, 200, projectResponse.body);
  const project = projectResponse.json();
  const sharedResponse = await request("owner", "POST", `/projects/${project.id}/share`, {
    version: project.version,
    visibility: "public",
    title: project.title,
  });
  assert.equal(sharedResponse.statusCode, 200, sharedResponse.body);
  const shared = sharedResponse.json();

  const edited: AnimatedSpriteV1 = {
    ...animation,
    frames: [...animation.frames].reverse(),
    fps: 12,
  };
  const next = await request("owner", "POST", `/assets/${asset.id}/versions`, {
    baseVersion: 1,
    sprite: edited,
  });
  assert.equal(next.statusCode, 200, next.body);
  assert.deepEqual(next.json().sprite, edited);
  assert.deepEqual(
    (await request("owner", "GET", `/assets/${asset.id}/versions/1`)).json().sprite,
    animation,
  );
  const anonymous = await app.inject(`/api/v1/shared/${shared.shortCode}`);
  assert.equal(anonymous.statusCode, 200, anonymous.body);
  const publishedBinding = anonymous.json().snapshot.assetManifest.sprites[0];
  assert.deepEqual(publishedBinding.sprite, animation);
  assert.equal(Object.hasOwn(publishedBinding, "assetId"), false);
  assert.equal(Object.hasOwn(publishedBinding, "versionId"), false);
});

test("sound recipes stay private, immutable, and bundled at the pinned project version", async () => {
  assert.equal((await request("owner", "GET", "/assets/sounds")).statusCode, 200);
  assert.equal((await request("owner", "POST", "/assets/sounds", {
    name: "Bad recipe",
    recipe: { ...laserRecipe, durationMs: 5 },
  })).statusCode, 400);

  const created = await request("owner", "POST", "/assets/sounds", {
    name: "Laser",
    recipe: laserRecipe,
  });
  assert.equal(created.statusCode, 200, created.body);
  const asset = created.json();
  assert.equal(asset.type, "sfx");
  assert.equal(asset.alias, "@laser");
  assert.deepEqual(asset.recipe, laserRecipe);
  assert.deepEqual((await request("owner", "GET", "/assets/sounds")).json().assets[0].latestVersion, asset.latestVersion);
  const spriteLibrary = (await request("owner", "GET", "/assets")).json().assets;
  assert.ok(spriteLibrary.length > 0);
  assert.ok(spriteLibrary.every((item: { type: string }) => item.type === "sprite"));
  assert.deepEqual((await request("other", "GET", "/assets/sounds")).json().assets, []);
  assert.equal((await request("other", "GET", `/assets/sounds/${asset.id}`)).statusCode, 404);

  const instrument = await request("owner", "POST", "/assets/sounds", {
    name: "Soft lead",
    recipe: instrumentRecipe,
  });
  assert.equal(instrument.statusCode, 200, instrument.body);
  assert.equal(instrument.json().type, "instrument");
  assert.deepEqual(instrument.json().recipe, instrumentRecipe);

  const editedRecipe: SfxRecipeV1 = {
    ...laserRecipe,
    endFrequencyHz: 55,
    durationMs: 260,
    envelope: { ...laserRecipe.envelope, releaseMs: 120 },
  };
  const version2 = await request("owner", "POST", `/assets/sounds/${asset.id}/versions`, {
    baseVersion: 1,
    recipe: editedRecipe,
  });
  assert.equal(version2.statusCode, 200, version2.body);
  assert.equal(version2.json().selectedVersion.number, 2);
  assert.deepEqual(version2.json().recipe, editedRecipe);
  assert.deepEqual(
    (await request("owner", "GET", `/assets/sounds/${asset.id}/versions/1`)).json().recipe,
    laserRecipe,
  );
  assert.equal((await request("owner", "POST", `/assets/sounds/${asset.id}/versions`, {
    baseVersion: 1,
    recipe: editedRecipe,
  })).json().error.code, "VERSION_CONFLICT");
  assert.equal((await request("owner", "POST", `/assets/sounds/${asset.id}/versions`, {
    baseVersion: 2,
    recipe: instrumentRecipe,
  })).statusCode, 400);

  const binding: ProjectSoundBindingV1 = {
    type: "sfx",
    alias: asset.alias,
    name: asset.name,
    assetId: asset.id,
    versionId: asset.selectedVersion.id,
    version: 1,
    recipe: laserRecipe,
  };
  const snapshot: ProjectSnapshot = {
    ...baseSnapshot(),
    sourceCode: 'SOUND "@laser"',
    assetManifest: { version: 1, sprites: [], sounds: [binding] },
  };
  assert.equal((await request("other", "POST", "/projects", { snapshot })).statusCode, 404);
  const projectResponse = await request("owner", "POST", "/projects", { snapshot });
  assert.equal(projectResponse.statusCode, 200, projectResponse.body);
  const project = projectResponse.json();
  const publication = await request("owner", "POST", `/projects/${project.id}/share`, {
    version: project.version,
    visibility: "public",
    title: project.title,
  });
  assert.equal(publication.statusCode, 200, publication.body);

  const anonymous = await app.inject(`/api/v1/shared/${publication.json().shortCode}`);
  assert.equal(anonymous.statusCode, 200, anonymous.body);
  const publicBinding = anonymous.json().snapshot.assetManifest.sounds[0];
  assert.deepEqual(publicBinding.recipe, laserRecipe);
  assert.equal(publicBinding.alias, "@laser");
  assert.equal(Object.hasOwn(publicBinding, "assetId"), false);
  assert.equal(Object.hasOwn(publicBinding, "versionId"), false);
  assert.equal(Object.hasOwn(publicBinding, "version"), false);

  await request("owner", "POST", `/assets/sounds/${asset.id}/versions`, {
    baseVersion: 2,
    recipe: { ...editedRecipe, endFrequencyHz: 120 },
  });
  const stillPinned = await app.inject(`/api/v1/shared/${publication.json().shortCode}`);
  assert.deepEqual(stillPinned.json().snapshot.assetManifest.sounds[0].recipe, laserRecipe);

  const versions = await pg.db.select().from(userAssetVersions).where(eq(userAssetVersions.assetId, asset.id));
  assert.equal(versions.length, 3);
  await assert.rejects(pg.db.update(userAssetVersions).set({ sprite: editedRecipe }).where(eq(userAssetVersions.id, versions[0].id)));
});

test("Demo asset library is session-isolated, project-portable, and ephemeral", async () => {
  const persistentAssetsBefore = await pg.db.select().from(userAssets);
  const login1 = await request("guest", "POST", "/auth/demo", {});
  assert.equal(login1.statusCode, 200, login1.body);
  const demo1 = login1.cookies.find((cookie) => cookie.name === "randusr_demo_session")!.value;
  const login2 = await request("guest", "POST", "/auth/demo", {});
  assert.equal(login2.statusCode, 200, login2.body);
  const demo2 = login2.cookies.find((cookie) => cookie.name === "randusr_demo_session")!.value;

  const created = await request("guest", "POST", "/demo/assets", {
    name: "Demo hero",
    sprite: animation,
  }, demo1);
  assert.equal(created.statusCode, 200, created.body);
  const asset = created.json();
  assert.equal(asset.alias, "@demo-hero");
  assert.equal(
    (await request("guest", "GET", `/demo/assets/${asset.id}`, undefined, demo2)).statusCode,
    404,
  );
  const snapshot: ProjectSnapshot = {
    ...baseSnapshot(),
    assetManifest: {
      version: 1,
      sprites: [{
        type: "sprite",
        alias: asset.alias,
        name: asset.name,
        assetId: asset.id,
        versionId: asset.selectedVersion.id,
        version: 1,
        sprite: asset.sprite,
      }],
    },
  };
  const createdProject = await request("guest", "POST", "/demo/projects", { snapshot }, demo1);
  assert.equal(createdProject.statusCode, 200, createdProject.body);
  const project = createdProject.json();
  const shared = await request(
    "guest",
    "POST",
    `/demo/projects/${project.id}/share`,
    { version: project.version, visibility: "unlisted", title: project.title },
    demo1,
  );
  assert.equal(shared.statusCode, 200, shared.body);
  const anonymous = await app.inject(`/api/v1/shared/${shared.json().shortCode}`);
  assert.equal(anonymous.statusCode, 200, anonymous.body);
  assert.deepEqual(anonymous.json().snapshot.assetManifest.sprites[0].sprite, animation);
  assert.equal(Object.hasOwn(anonymous.json().snapshot.assetManifest.sprites[0], "assetId"), false);

  const demoSound = await request("guest", "POST", "/demo/assets/sounds", {
    name: "Demo laser",
    recipe: laserRecipe,
  }, demo1);
  assert.equal(demoSound.statusCode, 200, demoSound.body);
  assert.deepEqual(demoSound.json().recipe, laserRecipe);
  assert.equal((await request("guest", "GET", `/demo/assets/sounds/${demoSound.json().id}`, undefined, demo2)).statusCode, 404);
  const demoSnapshot: ProjectSnapshot = {
    ...baseSnapshot(),
    sourceCode: 'SOUND "@demo-laser"',
    assetManifest: {
      version: 1,
      sprites: [],
      sounds: [{
        type: "sfx",
        alias: demoSound.json().alias,
        name: demoSound.json().name,
        assetId: demoSound.json().id,
        versionId: demoSound.json().selectedVersion.id,
        version: 1,
        recipe: laserRecipe,
      }],
    },
  };
  const demoSoundProject = await request("guest", "POST", "/demo/projects", { snapshot: demoSnapshot }, demo1);
  assert.equal(demoSoundProject.statusCode, 200, demoSoundProject.body);
  const demoSoundShared = await request("guest", "POST", `/demo/projects/${demoSoundProject.json().id}/share`, {
    version: demoSoundProject.json().version,
    visibility: "unlisted",
    title: "Demo Sound Project",
  }, demo1);
  assert.equal(demoSoundShared.statusCode, 200, demoSoundShared.body);
  const demoSoundPublic = await app.inject(`/api/v1/shared/${demoSoundShared.json().shortCode}`);
  assert.deepEqual(demoSoundPublic.json().snapshot.assetManifest.sounds[0].recipe, laserRecipe);
  assert.equal(Object.hasOwn(demoSoundPublic.json().snapshot.assetManifest.sounds[0], "assetId"), false);

  assert.equal(demo.stats().sessions, 2);
  demo.expireAll();
  assert.equal(demo.stats().sessions, 0);
  assert.equal(demo.stats().bytes, 0);
  assert.equal((await pg.db.select().from(userAssets)).length, persistentAssetsBefore.length);
});
