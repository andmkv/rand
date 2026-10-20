# Third-party notices

`package-lock.json` pins the application dependency tree. `npm run license:check` audits installed package metadata before review/build and currently accepts these SPDX identifiers: MIT, MIT-0, Apache-2.0, BSD-3-Clause and ISC. It audited 155 installed packages on 2026-10-20. The dependency package directories retain their individual license files after `npm ci`; do not strip those notices from a redistributed container or dependency bundle.

Direct production dependencies (the lockfile is the exact version source):

| Package | License |
| --- | --- |
| `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/state`, `@codemirror/view` | MIT |
| `@fastify/cookie`, `@fastify/rate-limit` | MIT |
| `@lezer/highlight` | MIT |
| `argon2` | MIT |
| `drizzle-orm` | Apache-2.0 |
| `fastify` | MIT |
| `nodemailer` | MIT-0 |
| `pg` | MIT |
| `react`, `react-dom` | MIT |

Direct development dependencies are `@playwright/test` and `typescript` (Apache-2.0); the remaining direct development packages (`@types/node`, `@types/nodemailer`, `@types/pg`, `@types/react`, `@types/react-dom`, `drizzle-kit`, `prettier`, `tsx`, `vite` and `vitest`) are MIT. `npm run license:check` reviews the complete installed tree, not only this direct-dependency summary. Two package manifests found by a broader recursive scan were test/benchmark fixtures nested inside dependencies (`pino/test/fixtures/transport` and `secure-json-parse/benchmarks`); they are not installed dependencies or shipped application assets.

## Fonts and pixel font atlas

- `public/fonts/Handjet.ttf` and the derived pixel font atlas include [Handjet](https://github.com/google/fonts/tree/main/ofl/handjet), distributed under the SIL Open Font License 1.1. The full notice is in `public/fonts/Handjet-OFL.txt`.
- `public/fonts/DotGothic16-Regular.ttf` and the derived Japanese atlas include [DotGothic16](https://github.com/google/fonts/tree/main/ofl/dotgothic16), distributed under the SIL Open Font License 1.1. The full notice is in `public/fonts/DotGothic16-OFL.txt`.
- See [asset notes](docs/ASSETS.md) for the atlas-generation provenance.

Built-in pixel sprites, sound recipes and BASIC examples in this source tree are code-defined project content. Additional in-progress game projects are not included. No third-party ROM, Nintendo art, external sound recordings or unlicensed image pack was found in the selected source snapshot.

The Docker image bases (`node:22-alpine`, `caddy:2-alpine`, `postgres:17-alpine`) are referenced, not copied into this source repository. Their upstream license and security notices accompany the images; image maintainers may update tags over time.
