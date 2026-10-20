# Randomize USR — contributor and agent guide

Randomize USR is a guest-first coding storybook with a browser BASIC interpreter, React/Vite client, Fastify API and PostgreSQL 17. Read this file and the linked docs before changing code. Never assume access to a deployment, private account, production database or secret.

## Source map

- `src/`: React application, locales, content, `.randusr` snapshots and local persistence.
- `src/runtime/language.ts`: lexer/parser and typed BASIC AST.
- `src/runtime/engine.ts`: bounded cooperative interpreter.
- `src/runtime/world.ts`: 256×192 graphics and runtime commands.
- `src/runtime/audio.ts`, `src/sound-contract.ts`: shared Web Audio engine and sound recipes.
- `shared/`: client/server DTOs, permissions and limits.
- `server/`: Fastify routes, auth, persistence and PostgreSQL migrations.
- `server/db/schema.ts`: Drizzle schema; reviewed forward migrations live in `server/migrations/`.
- `tests/`, `server/tests/`, `tests/e2e/`: unit, disposable-PostgreSQL and browser tests.
- `localization/`: source CSVs and translation workflow.
- `docs/`: architecture, development, self-hosting, security and operations.
- `book/`: public Handbook chapters, English/Russian source, table of contents, sample bundles and authoring notes.

## Local development

Node.js 22.12+ is required.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run book:check
npm run build
npm run api:build
npm run api:test
npm run test:e2e
```

`npm run api:test` uses a disposable PostgreSQL 17 container and requires Docker. Never point test or migration commands at a real user's database. `npm run setup` creates first-run self-host configuration and refuses to overwrite existing secrets.

## Invariants

- User BASIC is parsed into an AST and interpreted in the browser. Never add `eval`, `new Function`, generated JavaScript or host-global access.
- RUN owns an abort signal. STOP/RESET cancel loops, waits, input, sprite work and audio. Keep queues, timers, listeners, resource counts and replay history bounded.
- Guest mode works offline for editing, built-in content, local projects and `.randusr` import/export.
- Authorization is enforced by server-side session identity and `shared/permissions.ts`. Never trust request-supplied roles or identity headers.
- Project publication pins a revision. Keep private as the default; viewers never execute source on the server.
- Demo state is ephemeral, isolated in memory and never written to PostgreSQL, mail, analytics or the public gallery.
- User content is data. Bound input and avoid rendering source as HTML.
- Visible UI strings belong in the localization source. Preserve stable IDs, BASIC keywords and asset identifiers.
- Do not introduce classroom/teacher/student roles, Music Tracker or unrelated product work without a newly approved scope.

## Changes and verification

Inspect current implementation, update focused tests and affected docs, then run targeted tests plus `npm run typecheck`, `npm test`, and relevant builds. API tests require disposable PostgreSQL 17. Browser tests use Playwright; account-writing tests must use the local disposable harness only.

Schema changes require a forward SQL migration, schema parity check, and a documented restore path. Never run a production migration or deployment without explicit owner authorization. Do not perform destructive down migrations.

Keep credentials, `.env`, secret files, database dumps, private user data and private deployment details out of Git. For self-host and local test instructions use only values under reserved example domains.

Before a public documentation release, link the verified user handbook and BASIC reference from README. Do not invent commands or examples; validate them against the parser/runtime.

The public Handbook is at `/book` and needs no account or API. `npm run book:check` executes tagged BASIC examples against the real interpreter and validates chapter/link/reference coverage. Update the relevant `book/en/` and `book/ru/` chapters when runtime commands, assets or user flows change; authoring rules are in [book/README.md](book/README.md), evidence in [docs/QA-BOOK.md](docs/QA-BOOK.md).
