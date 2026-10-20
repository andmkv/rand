/**
 * Demo Mode HTTP surface.
 *
 * Two parts:
 *  1. POST /api/v1/auth/demo (production scope) creates an ephemeral session. No password hash,
 *     user row, mail or analytics is involved.
 *  2. /api/v1/demo/* (demo scope) mirrors the real cloud API contracts over the in-memory store.
 *
 * The demo cookie is a distinct cookie name; a demo token cannot authenticate a production route
 * (which only reads randusr_session) and vice versa. No admin route is registered here.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { csrfCookieName } from "./auth.js";
import type { AuthConfig } from "./auth-config.js";
import type { DemoConfig } from "./demo-config.js";
import { DemoStore, type DemoSession } from "./demo-store.js";
import { platformLimits } from "./limits.js";
import {
  projectLimits,
  projectParams,
  snapshotSchema,
  titleSchema,
} from "./projects.js";
import { previewPng } from "./preview-image.js";
import { isBlackFrame, previewPixelsSchema } from "../shared/preview.js";
import { closedTestNoticeVersion } from "../shared/registration.js";
import { projectTagIds } from "../shared/tags.js";
import type { PolicyConfiguration } from "../shared/policy.js";
import type { ProjectSnapshot } from "../shared/project.js";
import { spriteAssetSchema, soundRecipeSchema, assetLimits, type SpriteAssetV1, type SoundRecipeV1 } from "../shared/assets.js";

export const demoCookie = "randusr_demo_session";
export const demoFlagCookie = "randusr_demo";
export const demoLocales = [
  "en",
  "ru",
  "es",
  "fr",
  "de",
  "sr-Latn",
  "ja",
  "uk",
] as const;

type DemoRequest = FastifyRequest & { demoSession: DemoSession };
const sessionOf = (request: FastifyRequest) =>
  (request as DemoRequest).demoSession;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest();
const same = (left: string, right: string) =>
  timingSafeEqual(sha256(left), sha256(right));

const demoCookieOptions = (config: AuthConfig) => ({
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.secureCookies,
});

function setDemoCookies(
  reply: FastifyReply,
  token: string,
  demo: DemoConfig,
  config: AuthConfig,
) {
  const maxAge = Math.floor(demo.absoluteMs / 1000);
  reply.setCookie(demoCookie, token, {
    ...demoCookieOptions(config),
    maxAge,
  });
  // Readable marker only: the SPA needs to select /api/v1/demo before the first fetch.
  reply.setCookie(demoFlagCookie, "1", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    secure: config.secureCookies,
    maxAge,
  });
}

function clearDemoCookies(reply: FastifyReply) {
  reply.clearCookie(demoCookie, { path: "/" });
  reply.clearCookie(demoFlagCookie, { path: "/" });
}

/** POST /api/v1/auth/demo — Try Demo (no body credentials) or demo/demo for automation. */
export function registerDemoLogin(
  app: FastifyInstance,
  store: DemoStore,
  demo: DemoConfig,
  config: AuthConfig,
) {
  app.post<{
    Body: { username?: string; password?: string; locale?: string };
  }>(
    "/api/v1/auth/demo",
    {
      config: {
        rateLimit: {
          max: demo.loginPer15Minutes,
          timeWindow: "15 minutes",
        },
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            username: { type: "string", maxLength: 64 },
            password: { type: "string", maxLength: 128 },
            locale: { enum: [...demoLocales] },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body ?? {};
      if (body.username !== undefined || body.password !== undefined) {
        if (
          !same(String(body.username ?? ""), "demo") ||
          !same(String(body.password ?? ""), "demo")
        )
          throw new ApiError(401, "INVALID_CREDENTIALS");
      }
      // Reuse a live session so a second Try Demo does not silently destroy work.
      const existingToken = request.cookies[demoCookie];
      const existing = store.resolve(existingToken);
      if (existing) {
        setDemoCookies(reply, existingToken!, demo, config);
        return { ok: true, principal: store.principal(existing) };
      }
      const created = store.create(request.ip, body.locale ?? "en");
      setDemoCookies(reply, created.token, demo, config);
      return { ok: true, principal: store.principal(created.session) };
    },
  );
}

export function registerDemoApi(
  app: FastifyInstance,
  store: DemoStore,
  demo: DemoConfig,
  config: AuthConfig,
) {
  app.register(
    async (scope) => {
      scope.addHook("preHandler", async (request) => {
        const session = store.resolve(request.cookies[demoCookie]);
        if (!session) throw new ApiError(401, "AUTH_REQUIRED");
        if (!store.allowRequest(session))
          throw new ApiError(429, "RATE_LIMITED");
        (request as DemoRequest).demoSession = session;
      });
      scope.addHook("onSend", async (_request, reply) => {
        reply.header("X-Robots-Tag", "noindex, nofollow");
      });

      scope.get("/session", async (request) => ({
        principal: store.principal(sessionOf(request)),
      }));

      scope.get("/auth/me", async (request) => {
        const session = sessionOf(request);
        return {
          id: session.ownerId,
          email: "demo@demo.invalid",
          displayName: "Demo tester",
          locale: session.locale,
          verified: true,
          createdAt: new Date(session.createdAt).toISOString(),
        };
      });

      scope.get("/auth/csrf", async (_request, reply) => {
        const value = randomBytes(32).toString("base64url");
        reply.setCookie(csrfCookieName, value, {
          ...demoCookieOptions(config),
          sameSite: "strict",
        });
        return { token: value };
      });

      // The shared client keeps one locale contract on every signed-in surface: the chosen
      // language is written with PATCH /account and the server copy wins on reload. Demo has no
      // user row, so the preference belongs in the ephemeral demo session. Without this route the
      // client stored the choice locally only, and the next `/auth/me` reverted to "en".
      scope.patch<{ Body: { locale?: string } }>(
        "/account",
        {
          schema: {
            body: {
              type: "object",
              minProperties: 1,
              additionalProperties: false,
              properties: { locale: { enum: [...demoLocales] } },
            },
          },
          config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        },
        async (request) => {
          const session = sessionOf(request);
          if (request.body.locale) session.locale = request.body.locale;
          return {
            id: session.ownerId,
            email: "demo@demo.invalid",
            displayName: "Demo tester",
            locale: session.locale,
            verified: true,
            createdAt: new Date(session.createdAt).toISOString(),
          };
        },
      );

      scope.get(
        "/auth/policy",
        async (): Promise<PolicyConfiguration> => ({
          publicRegistrationEnabled:
            config.publicRegistrationEnabled === true,
          demoEnabled: true,
          closedTestNoticeVersion,
          termsVersion: config.termsVersion ?? null,
          privacyVersion: config.privacyVersion ?? null,
          termsUrl: config.termsUrl ?? null,
          privacyUrl: config.privacyUrl ?? null,
          supportEmail: config.supportEmail ?? null,
        }),
      );

      scope.post("/auth/logout", async (request, reply) => {
        store.destroy(sessionOf(request), "logout");
        clearDemoCookies(reply);
        return { ok: true };
      });

      // Analytics is intentionally inert for demo: no event reaches product measurement.
      scope.get("/analytics/config", async () => ({
        enabled: false,
        noticeVersion: null,
        noticeUrl: null,
      }));
      scope.post("/analytics/events", async () => ({ ok: true }));
      scope.delete("/analytics/session", async () => ({ ok: true }));

      /* ---------------------------------------------------------- private sprites */

      const assetParams = {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      } as const;
      const assetVersionParams = {
        type: "object",
        additionalProperties: false,
        required: ["id", "number"],
        properties: {
          id: { type: "string", format: "uuid" },
          number: { type: "string", pattern: "^[1-9][0-9]{0,2}$" },
        },
      } as const;
      scope.get("/assets", async (request) =>
        store.listAssets(sessionOf(request)),
      );
      scope.post<{
        Body: { name: string; sprite: SpriteAssetV1 };
      }>(
        "/assets",
        {
          schema: {
            body: {
              type: "object",
              additionalProperties: false,
              required: ["name", "sprite"],
              properties: {
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: assetLimits.nameCharacters,
                  pattern: "^[^<>\\x00-\\x1F]+$",
                },
                sprite: spriteAssetSchema,
              },
            },
          },
        },
        async (request) =>
          store.createAsset(sessionOf(request), request.body),
      );
      scope.get<{ Params: { id: string } }>(
        "/assets/:id",
        { schema: { params: assetParams } },
        async (request) =>
          store.getAsset(sessionOf(request), request.params.id),
      );
      scope.get<{ Params: { id: string; number: string } }>(
        "/assets/:id/versions/:number",
        { schema: { params: assetVersionParams } },
        async (request) =>
          store.getAsset(
            sessionOf(request),
            request.params.id,
            Number(request.params.number),
          ),
      );
      scope.patch<{ Params: { id: string }; Body: { name: string } }>(
        "/assets/:id",
        {
          schema: {
            params: assetParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["name"],
              properties: {
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: assetLimits.nameCharacters,
                  pattern: "^[^<>\\x00-\\x1F]+$",
                },
              },
            },
          },
        },
        async (request) =>
          store.renameAsset(
            sessionOf(request),
            request.params.id,
            request.body.name,
          ),
      );
      scope.post<{
        Params: { id: string };
        Body: { baseVersion: number; sprite: SpriteAssetV1 };
      }>(
        "/assets/:id/versions",
        {
          schema: {
            params: assetParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["baseVersion", "sprite"],
              properties: {
                baseVersion: {
                  type: "integer",
                  minimum: 1,
                  maximum: assetLimits.versionsPerAsset,
                },
                sprite: spriteAssetSchema,
              },
            },
          },
        },
        async (request) =>
          store.saveAssetVersion(
            sessionOf(request),
            request.params.id,
            request.body.baseVersion,
            request.body.sprite,
          ),
      );
      scope.delete<{ Params: { id: string } }>(
        "/assets/:id",
        { schema: { params: assetParams } },
        async (request) =>
          store.archiveAsset(sessionOf(request), request.params.id),
      );

      /* --------------------------------------------------------- private sounds */
      scope.get("/assets/sounds", async (request) =>
        store.listSoundAssets(sessionOf(request)),
      );
      scope.post<{ Body: { name: string; recipe: SoundRecipeV1 } }>(
        "/assets/sounds",
        {
          schema: {
            body: {
              type: "object",
              additionalProperties: false,
              required: ["name", "recipe"],
              properties: {
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: assetLimits.nameCharacters,
                  pattern: "^[^<>\\x00-\\x1F]+$",
                },
                recipe: soundRecipeSchema,
              },
            },
          },
        },
        async (request) => store.createSoundAsset(sessionOf(request), request.body),
      );
      scope.get<{ Params: { id: string } }>(
        "/assets/sounds/:id",
        { schema: { params: assetParams } },
        async (request) => store.getSoundAsset(sessionOf(request), request.params.id),
      );
      scope.get<{ Params: { id: string; number: string } }>(
        "/assets/sounds/:id/versions/:number",
        { schema: { params: assetVersionParams } },
        async (request) => store.getSoundAsset(sessionOf(request), request.params.id, Number(request.params.number)),
      );
      scope.patch<{ Params: { id: string }; Body: { name: string } }>(
        "/assets/sounds/:id",
        {
          schema: {
            params: assetParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["name"],
              properties: {
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: assetLimits.nameCharacters,
                  pattern: "^[^<>\\x00-\\x1F]+$",
                },
              },
            },
          },
        },
        async (request) => store.renameSoundAsset(sessionOf(request), request.params.id, request.body.name),
      );
      scope.post<{
        Params: { id: string };
        Body: { baseVersion: number; recipe: SoundRecipeV1 };
      }>(
        "/assets/sounds/:id/versions",
        {
          schema: {
            params: assetParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["baseVersion", "recipe"],
              properties: {
                baseVersion: {
                  type: "integer",
                  minimum: 1,
                  maximum: assetLimits.versionsPerAsset,
                },
                recipe: soundRecipeSchema,
              },
            },
          },
        },
        async (request) => store.saveSoundAssetVersion(
          sessionOf(request), request.params.id, request.body.baseVersion, request.body.recipe,
        ),
      );
      scope.delete<{ Params: { id: string } }>(
        "/assets/sounds/:id",
        { schema: { params: assetParams } },
        async (request) => store.archiveSoundAsset(sessionOf(request), request.params.id),
      );

      scope.get("/limits", async () => ({
        ...platformLimits,
        ...projectLimits,
        demo: {
          projects: demo.maxProjects,
          revisions: demo.maxRevisions,
          sessionBytes: demo.maxSessionBytes,
          idleMinutes: demo.idleMs / 60_000,
          absoluteHours: demo.absoluteMs / 3_600_000,
        },
      }));

      /* ------------------------------------------------------------ projects */

      scope.get<{
        Querystring: {
          cursor?: string;
          q?: string;
          mode?: "story" | "sandbox";
          visibility?: "private" | "unlisted" | "public";
          archived?: string;
        };
      }>(
        "/projects",
        {
          schema: {
            querystring: {
              type: "object",
              additionalProperties: false,
              properties: {
                cursor: { type: "string", maxLength: 200 },
                q: { type: "string", maxLength: 120 },
                mode: { enum: ["story", "sandbox"] },
                visibility: { enum: ["private", "unlisted", "public"] },
                archived: { enum: ["true", "false"] },
              },
            },
          },
        },
        async (request) =>
          store.listProjects(sessionOf(request), {
            q: request.query.q,
            mode: request.query.mode,
            visibility: request.query.visibility,
            archived: request.query.archived === "true",
          }),
      );

      scope.post<{
        Body: { snapshot: ProjectSnapshot; description?: string };
      }>(
        "/projects",
        {
          schema: {
            body: {
              type: "object",
              additionalProperties: false,
              required: ["snapshot"],
              properties: {
                snapshot: snapshotSchema,
                description: { type: "string", maxLength: 2000 },
              },
            },
          },
        },
        async (request) => {
          const session = sessionOf(request);
          return store.projectDto(
            store.createProject(
              session,
              request.body.snapshot,
              request.body.description ?? "",
            ),
          );
        },
      );

      scope.get<{ Params: { id: string } }>(
        "/projects/:id",
        { schema: { params: projectParams } },
        async (request) =>
          store.projectDto(
            store.getProject(sessionOf(request), request.params.id),
          ),
      );

      scope.put<{
        Params: { id: string };
        Body: {
          version: number;
          snapshot: ProjectSnapshot;
          description?: string;
        };
      }>(
        "/projects/:id",
        {
          schema: {
            params: projectParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["version", "snapshot"],
              properties: {
                version: { type: "integer", minimum: 1 },
                snapshot: snapshotSchema,
                description: { type: "string", maxLength: 2000 },
              },
            },
          },
        },
        async (request) =>
          store.projectDto(
            store.saveProject(
              sessionOf(request),
              request.params.id,
              request.body.version,
              request.body.snapshot,
              request.body.description,
            ),
          ),
      );

      scope.patch<{
        Params: { id: string };
        Body: { version: number; archived: boolean };
      }>(
        "/projects/:id",
        {
          schema: {
            params: projectParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["version", "archived"],
              properties: {
                version: { type: "integer", minimum: 1 },
                archived: { type: "boolean" },
              },
            },
          },
        },
        async (request) =>
          store.projectDto(
            store.setArchived(
              sessionOf(request),
              request.params.id,
              request.body.version,
              request.body.archived,
            ),
          ),
      );

      scope.delete<{ Params: { id: string }; Body: { version: number } }>(
        "/projects/:id",
        {
          schema: {
            params: projectParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["version"],
              properties: { version: { type: "integer", minimum: 1 } },
            },
          },
        },
        async (request) => {
          store.deleteProject(
            sessionOf(request),
            request.params.id,
            request.body.version,
          );
          return { ok: true };
        },
      );

      scope.post<{
        Params: { id: string };
        Body: { version: number; title?: string };
      }>(
        "/projects/:id/duplicate",
        {
          schema: {
            params: projectParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["version"],
              properties: {
                version: { type: "integer", minimum: 1 },
                title: titleSchema,
              },
            },
          },
        },
        async (request) =>
          store.projectDto(
            store.duplicateProject(
              sessionOf(request),
              request.params.id,
              request.body.version,
              request.body.title,
            ),
          ),
      );

      /* ------------------------------------------------------------ previews */

      scope.post<{
        Params: { id: string };
        Body: { version: number; pixels: string };
      }>(
        "/projects/:id/preview",
        {
          schema: {
            params: projectParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["version", "pixels"],
              properties: {
                version: { type: "integer", minimum: 1 },
                pixels: previewPixelsSchema,
              },
            },
          },
        },
        async (request) => {
          const session = sessionOf(request);
          const png = previewPng(request.body.pixels);
          const key = store.storePreview(session, request.params.id, png);
          return {
            previewUrl: `/api/v1/demo/projects/${request.params.id}/preview/${key}`,
            version: request.body.version,
          };
        },
      );

      scope.get<{ Params: { id: string; key: string } }>(
        "/projects/:id/preview/:key",
        {
          schema: {
            params: {
              ...projectParams,
              required: ["id", "key"],
              properties: {
                id: { type: "string", format: "uuid" },
                key: { type: "string", format: "uuid" },
              },
            },
          },
        },
        async (request, reply) => {
          const png = store.projectPreview(
            sessionOf(request),
            request.params.id,
            request.params.key,
          );
          return reply.type("image/png").send(png);
        },
      );

      scope.get<{ Params: { code: string; key: string } }>(
        "/shared/:code/preview/:key",
        {
          schema: {
            params: {
              type: "object",
              additionalProperties: false,
              required: ["code", "key"],
              properties: {
                code: { type: "string", pattern: "^[A-Za-z0-9_-]{16}$" },
                key: { type: "string", format: "uuid" },
              },
            },
          },
        },
        async (request, reply) =>
          reply
            .type("image/png")
            .send(
              store.sharedPreview(request.params.code, request.params.key),
            ),
      );

      /* ----------------------------------------------------------- revisions */

      scope.get<{ Params: { id: string }; Querystring: { before?: number } }>(
        "/projects/:id/revisions",
        {
          schema: {
            params: projectParams,
            querystring: {
              type: "object",
              additionalProperties: false,
              properties: { before: { type: "integer", minimum: 1 } },
            },
          },
        },
        async (request) =>
          store.revisions(
            sessionOf(request),
            request.params.id,
            request.query.before,
          ),
      );

      scope.get<{ Params: { id: string; revisionId: string } }>(
        "/projects/:id/revisions/:revisionId",
        {
          schema: {
            params: {
              type: "object",
              additionalProperties: false,
              required: ["id", "revisionId"],
              properties: {
                id: { type: "string", format: "uuid" },
                revisionId: { type: "string", format: "uuid" },
              },
            },
          },
        },
        async (request) =>
          store.revision(
            sessionOf(request),
            request.params.id,
            request.params.revisionId,
          ),
      );

      scope.post<{
        Params: { id: string; revisionId: string };
        Body: { version: number };
      }>(
        "/projects/:id/revisions/:revisionId/restore",
        {
          schema: {
            params: {
              type: "object",
              additionalProperties: false,
              required: ["id", "revisionId"],
              properties: {
                id: { type: "string", format: "uuid" },
                revisionId: { type: "string", format: "uuid" },
              },
            },
            body: {
              type: "object",
              additionalProperties: false,
              required: ["version"],
              properties: { version: { type: "integer", minimum: 1 } },
            },
          },
        },
        async (request) =>
          store.projectDto(
            store.restoreRevision(
              sessionOf(request),
              request.params.id,
              request.params.revisionId,
              request.body.version,
            ),
          ),
      );

      scope.post<{ Params: { id: string; revisionId: string } }>(
        "/projects/:id/revisions/:revisionId/copy",
        {
          schema: {
            params: {
              type: "object",
              additionalProperties: false,
              required: ["id", "revisionId"],
              properties: {
                id: { type: "string", format: "uuid" },
                revisionId: { type: "string", format: "uuid" },
              },
            },
            body: {
              type: "object",
              additionalProperties: false,
              maxProperties: 0,
            },
          },
        },
        async (request) =>
          store.projectDto(
            store.copyRevision(
              sessionOf(request),
              request.params.id,
              request.params.revisionId,
            ),
          ),
      );

      /* ------------------------------------------------------------- sharing */

      scope.get<{ Params: { id: string } }>(
        "/projects/:id/share",
        { schema: { params: projectParams } },
        async (request) =>
          store.shareInfo(
            sessionOf(request),
            request.params.id,
            config.baseUrl,
          ),
      );

      scope.post<{
        Params: { id: string };
        Body: {
          version: number;
          visibility: "private" | "unlisted" | "public";
          title?: string;
          description?: string;
          tags?: string[];
          previewPixels?: string;
        };
      }>(
        "/projects/:id/share",
        {
          schema: {
            params: projectParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["version", "visibility"],
              properties: {
                version: { type: "integer", minimum: 1 },
                visibility: { enum: ["private", "unlisted", "public"] },
                previewPixels: previewPixelsSchema,
                title: {
                  type: "string",
                  minLength: 1,
                  maxLength: 120,
                  pattern: "^[^<>\\x00-\\x1F]+$",
                },
                description: {
                  type: "string",
                  maxLength: 2000,
                  pattern: "^[^<>]*$",
                },
                tags: {
                  type: "array",
                  maxItems: 8,
                  uniqueItems: true,
                  items: { enum: projectTagIds },
                },
              },
            },
          },
        },
        async (request) => {
          const body = request.body;
          return store.projectDto(
            store.publish(
              sessionOf(request),
              request.params.id,
              {
                version: body.version,
                visibility: body.visibility,
                title: body.title,
                description: body.description,
                tags: body.tags,
                previewPng:
                  body.previewPixels && !isBlackFrame(body.previewPixels)
                    ? previewPng(body.previewPixels)
                    : undefined,
              },
              config.baseUrl,
            ),
          );
        },
      );

      scope.post<{ Params: { id: string }; Body: { version: number } }>(
        "/projects/:id/share/rotate",
        {
          schema: {
            params: projectParams,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["version"],
              properties: { version: { type: "integer", minimum: 1 } },
            },
          },
        },
        async (request) =>
          store.projectDto(
            store.rotateShareLink(
              sessionOf(request),
              request.params.id,
              request.body.version,
            ),
          ),
      );

      scope.get<{ Params: { code: string } }>(
        "/shared/:code",
        {
          schema: {
            params: {
              type: "object",
              additionalProperties: false,
              required: ["code"],
              properties: {
                code: { type: "string", pattern: "^[A-Za-z0-9_-]{16}$" },
              },
            },
          },
        },
        async (request, reply) => {
          reply.header("X-Robots-Tag", "noindex, nofollow");
          return store.shared(sessionOf(request), request.params.code);
        },
      );

      scope.post<{ Params: { code: string }; Body: { title?: string } }>(
        "/shared/:code/remix",
        {
          schema: {
            params: {
              type: "object",
              additionalProperties: false,
              required: ["code"],
              properties: {
                code: { type: "string", pattern: "^[A-Za-z0-9_-]{16}$" },
              },
            },
            body: {
              type: "object",
              additionalProperties: false,
              properties: { title: titleSchema },
            },
          },
        },
        async (request) =>
          store.projectDto(
            store.remix(
              sessionOf(request),
              request.params.code,
              request.body?.title,
            ),
          ),
      );

      /* ------------------------------------------------------------- gallery */

      scope.get<{
        Querystring: {
          q?: string;
          tag?: string;
          sort?: "recent" | "featured";
          cursor?: string;
        };
      }>(
        "/gallery",
        {
          schema: {
            querystring: {
              type: "object",
              additionalProperties: false,
              properties: {
                q: { type: "string", maxLength: 120 },
                tag: { enum: projectTagIds },
                sort: { enum: ["recent", "featured"] },
                cursor: { type: "string", maxLength: 200 },
              },
            },
          },
        },
        async (request) =>
          store.gallery(sessionOf(request), {
            q: request.query.q,
            tag: request.query.tag,
            sort: request.query.sort,
          }),
      );
    },
    { prefix: "/api/v1/demo" },
  );
}
