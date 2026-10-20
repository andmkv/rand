# Changelog

User-facing changes are recorded here. This source snapshot is based on the production release `84bb1e71484861502766501782df82738f81a320`; it is not itself a deployment or a public release.

## 0.1.1 — fonts

- SCREEN (in-game) text now uses the custom 8×8 RandUSR bitmap font from `graphics/RandUSRfont.png`, with an explicit cell→character table covering Latin, digits, punctuation, Russian/Ukrainian/Serbian Cyrillic, Serbian Latin and Western European accents; Japanese and other missing characters fall back to the previous atlas.
- The web interface now uses Victor Mono from Google Fonts; the Caddy CSP allows fonts.googleapis.com and fonts.gstatic.com. Built-in example previews were re-rendered.

## 0.1.0 — open-source preparation

- Added a self-host setup wizard that creates private config, a random database password and a separate SMTP password file without overwriting an existing install.
- Added production SMTP host/port configuration for STARTTLS or implicit TLS with certificate verification.
- Removed built-in personal administrator and official-instance URL defaults.
- Changed database seeding so it only ensures public tags and never promotes an account.
- Made the email-verified first-admin bootstrap one-time and audit-locked.
- Added self-host deployment, backup/restore, architecture and contributor guidance.
- Added the configurable localized Smallhall.net footer to the official build.

## Compatibility notes

- Existing `SMTP_URL` configuration remains supported by the server configuration parser.
- Existing databases are not changed by this source snapshot. Current administrator flags and project records are preserved; the seed process no longer grants new privileges.
- Database migrations are forward-only. Back up and check application/schema compatibility before upgrading.
