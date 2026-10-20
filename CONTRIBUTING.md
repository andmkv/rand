# Contributing

Thanks for considering a contribution. Changes should fit the guest-first product and keep BASIC execution client-side. Please open a focused issue or pull request with a short problem statement, the proposed change and the checks you ran. Do not include private project exports, credentials, real user data or production logs.

## Development setup

Use Node.js 22.12+ and npm:

```sh
npm ci
npm run dev
```

The guest editor and local projects work without an API. API integration tests use disposable PostgreSQL 17 containers and require Docker. Never run those tests against a real account database.

## Project conventions

- Preserve parser/interpreter safety: user programs are data interpreted from the typed AST; no `eval`, generated JavaScript or arbitrary browser globals.
- Keep RUN work interruptible and resource limits bounded. STOP and RESET must cancel audio, waits, input and scheduled work.
- Keep APIs server-authorized. UI checks do not replace server-side ownership and publication checks.
- Add visible copy to the English source and all supported locale CSVs; run `npm run i18n:check`.
- Keep `.randusr` serialization canonical and backward-compatible.
- Schema edits require a reviewed forward migration and updated schema tests.
- Preserve bundled font license and attribution files when changing typography.

## Before requesting review

Run the focused test, then the relevant checks:

```sh
npm run typecheck
npm test
npm run build
npm run api:build
npm run api:test
```

Run browser tests for UI, auth or browser-runtime changes. Report any checks that could not run and why. Never claim an unrun check passed.

## Project scope

This repository is prepared for maintenance and focused fixes after release finalization. Do not add new product features without a separately approved scope. No support or service-level commitment is created by a contribution.
