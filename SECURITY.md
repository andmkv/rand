# Security policy

## Supported versions

Security fixes are prepared against the latest tagged release. This project is being prepared for an initial public source release; no support or response-time commitment is implied.

## Reporting a vulnerability

After a public repository is available, use GitHub's **Report a vulnerability** private advisory flow. Do not post credentials, private projects, exploitable details or personal data in a public issue. If private reporting is unavailable, use a maintainer contact explicitly published alongside that repository.

## Security boundaries

- User BASIC is interpreted in the browser and is never evaluated by the API.
- The server derives identity from a hashed database session and applies owner/publication checks at each route.
- Mutating API requests require same-origin CSRF protection. CORS is not enabled by default.
- Production requires a canonical HTTPS `APP_BASE_URL`; proxy trust is limited to the configured hop count.
- The first administrator is created through one-time mail verification and recorded in the audit log. The configured email alone never grants access, and startup/seed never promotes an account.
- SMTP credentials are operator configuration and should be mounted via `SMTP_PASSWORD_FILE`. Mail TLS certificate verification is enabled; credentials are not accepted from application input.
- Guest `.randusr` data and public project content are untrusted bounded input. The server stores program text and does not execute it.
- Demo sessions are disposable in-memory state, isolated from registered accounts and durable storage.

## Operator responsibilities

Use HTTPS at the reverse proxy, restrict PostgreSQL and API networking, protect `.env` and secret files, keep dependencies updated, apply reviewed migrations, and test encrypted backups by restoring them into a separate PostgreSQL 17 instance. Security also depends on SMTP delivery controls and the host's patching, firewall and access policies.

## Source secret scan

Run `npm run security:secrets` before publishing a source snapshot. It scans the checked-out files (not Git history) with the official Gitleaks CLI in a network-disabled, read-only container pinned to version 8.30.1 and platform image digests. CI runs the same script before dependency installation; it receives no application secrets and the checkout does not persist its read-only token in Git config. Public release snapshots must still use a clean root commit and receive a separate history review.
