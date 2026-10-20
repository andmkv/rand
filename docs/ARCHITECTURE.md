# Architecture

Randomize USR has a browser client, a JSON API and PostgreSQL persistence. A self-hosted Compose deployment serves a static React/Vite build through Caddy and proxies `/api/*` to Fastify. PostgreSQL remains on the private Compose network. `APP_BASE_URL` is the canonical external HTTPS origin used to build auth links and secure cookies.

## Client and runtime

`src/main.tsx` routes the SPA. `src/App.tsx` composes editor, story, cloud, inventory, Sound Lab and account flows. `src/api.ts` handles same-origin requests, CSRF and response errors. `src/project.ts` validates portable `.randusr` snapshots and local recovery.

The lexer/parser in `src/runtime/language.ts` produce a located typed AST. `src/runtime/engine.ts` interprets it cooperatively in the browser. `src/runtime/world.ts` owns the pixel display and commands. Runtime audio, Sound Lab previews and BASIC sound commands share the bounded Web Audio engine in `src/runtime/audio.ts`. User BASIC is not sent to the server for execution and cannot access JavaScript globals, filesystem, network or DOM APIs.

Built-in BASIC, examples and Spellbook content live in `src/content/`; canonical assets and manifests live in `src/runtime/assets.ts`. Localized UI and content are sourced from `src/locales/` and `localization/`.

## API and data

`server/app.ts` assembles Fastify route modules. `server/index.ts` owns process lifecycle. `server/db/schema.ts` is the Drizzle model, and ordered reviewed SQL migrations in `server/migrations/` advance the database. Project source remains data in PostgreSQL JSONB. Publications point at pinned revisions rather than mutable working state.

Sessions are stored as hashes; server permissions are in `shared/permissions.ts`. The first administrator is created by an operator-configured email invitation and mailbox verification. Promotion and one-time lockout are recorded in the audit log; `db:seed` only inserts public taxonomy and never changes roles.

Demo mode uses an isolated in-memory store and dedicated cookie. It does not access PostgreSQL, normal account sessions, mail, analytics or durable publications.

## Runtime topology

```text
Browser ── HTTPS ── reverse proxy ── loopback web (Caddy/static client)
                                           │ /api/*
                                           ▼
                                      Fastify API
                                           │ private network
                                           ▼
                                      PostgreSQL 17
```

The published Compose file exposes only the web listener on loopback. An operator's existing reverse proxy can terminate HTTPS without claiming shared host ports. Do not expose the API or database directly to the internet.

## Persistence and portable projects

Cloud project snapshots contain BASIC and pinned asset references, with JSONB storage used for validated canonical payloads. Local projects and `.randusr` files are client-side JSON snapshots. Private assets are ownership-checked by the API; shared projects and anonymous viewers resolve only publication-pinned public resources.

Schema updates are forward migrations in `server/migrations`. Startup orchestration runs the one-shot migration service before API health. Back up before upgrading and validate restore in a separate database; see [self-hosted operations](OPERATIONS.md).
