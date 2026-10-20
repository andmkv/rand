# Deployment with Docker Compose

This guide covers a self-hosted instance. It does not configure or assume a vendor, DNS provider, host or mail service.

1. Install Docker Engine and the Compose v2 plugin. Install Node.js 22.12+ for the setup wizard.
2. Clone the source and run `npm run setup`. The wizard writes private local configuration and generates the database password. Keep `.env` and `secrets/` on the server with restrictive permissions.
3. Point a domain you control at an HTTPS reverse proxy. Configure `APP_BASE_URL` to exactly that origin. The application container binds its web port to `127.0.0.1` only; use your host's existing proxy or the optional standalone Caddy example in `deploy/Caddyfile.reverse-proxy.example`.
4. Run `docker compose up --build -d`. PostgreSQL 17 becomes healthy, the migration service applies pending forward migrations, then API and web start.
5. Check `https://your-domain.example/api/v1/ready` and request the initial invitation at `/invite`.

Before inviting the first administrator, you can verify SMTP from the host with `npm run mail:test`. It sends a fixed token-free message to the configured bootstrap address; use `npm run mail:test -- --to another-address@example.org` to select a separate test mailbox. Check the mailbox and spam folder after SMTP accepts the message. Do not paste SMTP server reply text or secrets into support reports.

If no administrator can sign in after a recovery event, use the local operator CLI only when the target already has a verified active account and the database has no active administrator:

```sh
docker compose exec api node dist-server/server/admin-recovery-cli.js --email verified-user@example.org
```

It prompts for the exact confirmation phrase, locks against concurrent bootstrap/recovery, refuses when any active administrator exists, and writes an `admin.recovery` audit entry. It does not create an account, reset a password, bypass mailbox verification or expose a web recovery endpoint.

The generated environment disables public registration and analytics. Demo mode is an independent in-memory feature and can be disabled with `DEMO_MODE_ENABLED=false`. Do not change registration/policy settings until you have prepared and reviewed the corresponding privacy, terms and support configuration.

## Capacity and storage

Compose persists PostgreSQL in a named volume but does not provide a portable hard disk quota for that volume. Set storage limits in the host or volume driver where available, monitor free disk space, and keep project/revision/asset quotas at their documented defaults unless you have measured a safe change for your host. The project has no published minimum RAM/CPU recommendation yet; collect resource measurements under your expected user and project load before choosing a host size.

## Networking and proxy

The database has no host port. The API is reachable only by the Compose network and web proxy. Do not add public API/database ports. Compose sets `TRUST_PROXY_HOPS=1` because the API receives requests through its internal web proxy. Preserve that topology. A different proxy chain needs a reviewed hop count and end-to-end check; never enable blanket forwarded-header trust.

The sample Compose port is `127.0.0.1:8080`. When another application already owns ports 80/443, add a virtual host to that proxy and route only this domain to the loopback web port. The sample Caddy file is for a dedicated host where binding 80/443 is appropriate; it is optional and must not replace an existing shared-host proxy.

## Upgrade and rollback

Review the release notes and migration SQL. Make and verify a backup first. Rebuild the app and web image from the chosen source commit and use `docker compose up --build -d`; the migration job runs before API startup. Keep the previous application image/build available for application rollback. Database migrations are forward-only; do not use a destructive down migration or delete the PostgreSQL volume to roll back app code.

See [operations](OPERATIONS.md) for backup and restore verification. For configuration errors, inspect only redacted logs; never paste `.env`, secret files, auth tokens or complete database URLs into support reports.
