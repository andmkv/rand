# Development

## Requirements

- Node.js 22.12+ and npm.
- Docker Engine + Compose v2 for disposable PostgreSQL 17 API tests.
- Chromium/WebKit browser downloads only for Playwright browser tests.

## Commands

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run api:build
npm run api:test
npm run test:e2e
npm run i18n:export
npm run i18n:check
```

`npm run dev` starts the guest-first Vite client. It needs no network or account for local runtime and examples. Cloud and account flows require the API with PostgreSQL. The API test harness always launches a new named container and does not accept an operator database URL.

## Database workflow

Edit the Drizzle schema in `server/db/schema.ts`, then generate and review a forward SQL migration. Never edit an already released migration. Run schema parity and disposable database tests. Before deploying a new source version, take and test an encrypted backup. Do not use down migrations or delete the DB volume as an application rollback.

## Localization

English copy is the source. Add translations to locale CSVs and import them with `npm run i18n:import -- <locale> path/to/file.csv`; run `npm run i18n:check`. Stable IDs, BASIC keywords, asset identifiers and code snippets are not translated. Missing user-handbook content is not to be invented in UI or developer docs.

## Self-hosting

Use `npm run setup` to configure a new Docker Compose instance. The setup wizard refuses to overwrite existing `.env` or SMTP secret files. Read [deployment](DEPLOYMENT.md), [security](../SECURITY.md) and [operations](OPERATIONS.md) first. Do not point local tests, setup or migration commands at production data.

## Handbook

The account-free public reader is at `/book`. Content is Markdown in `book/en` and `book/ru`; the UI uses the project’s bounded Markdown parser and has no API dependency. See [book authoring notes](../book/README.md).

```sh
npm run book:check
PLAYWRIGHT_BASE_URL=http://localhost:5173 npx playwright test tests/e2e/book.spec.ts
```

The book checks run tagged examples against the real BASIC `Engine` and `World`, verify expected state and bound endless loops. They also validate runtime-reference coverage, localized chapter structure, links, anchors and shipped assets.
