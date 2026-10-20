# Self-hosted operations

For first install, upgrades and configuration, see [deployment](DEPLOYMENT.md). Keep an encrypted off-host backup, its checksum and the separate recovery identity. Host-local copies alone do not protect against host loss.

The default Compose named volume has no portable disk-size ceiling. Monitor its host filesystem and configure a host or volume-driver quota when supported; do not rely on application payload quotas to cap database growth. No minimum host RAM/CPU sizing has been published because this release has not been benchmarked across self-hosted workloads.

## Encrypted backup

Install `age` from its official distribution. Generate an identity once, store it outside the server (for example in the operator's password manager or offline recovery storage), and keep the public recipient separately:

```sh
umask 077
age-keygen -o "$AGE_IDENTITY_FILE"
chmod 600 "$AGE_IDENTITY_FILE"
AGE_RECIPIENT="$(age-keygen -y "$AGE_IDENTITY_FILE")"
mkdir -p backups
chmod 700 backups
set -o pipefail
docker compose exec -T db pg_dump -U randusr -d randusr -Fc \
  | age -r "$AGE_RECIPIENT" > "backups/randusr-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
chmod 600 backups/*.dump.age
shasum -a 256 backups/*.dump.age
```

The database stream is encrypted before it reaches the backup file. Keep the private age identity separate from the server and encrypted archives. Store the displayed checksum with the copy. Do not print or commit `.env`, SMTP password files, age identity files, raw SQL dumps or database URLs.

## Verify and test restore

First verify the authenticated archive can be decrypted and parsed without writing plaintext to disk:

```sh
set -o pipefail
age -d -i "$AGE_IDENTITY_FILE" "$BACKUP_FILE" \
  | docker compose exec -T db pg_restore --list - > /dev/null
```

For restore drills, use a new disposable PostgreSQL 17 container with a separate volume/database. Restore the stream directly into it, verify the migration journal and representative row counts, then remove only that disposable test container and volume. Never use a production volume for a restore check. Repeat the drill after migration/schema changes.

To restore an actual instance, stop API/web traffic, take a second encrypted backup of the current state, and restore into a fresh database or a deliberately selected empty target. Confirm the target and project/data checks before changing `DATABASE_URL` and bringing up the API. Do not run `pg_restore --clean` against a live database. A database restore is separate from an application rollback; never delete the persistent PostgreSQL volume as an app rollback step.

## Migration and upgrade sequence

1. Review release notes and every pending SQL migration.
2. Make an encrypted backup and confirm the checksum and restore drill.
3. Build the API/web images from a fixed source commit and keep the previous app images available.
4. Start Compose. The one-shot `migrate` service waits for PostgreSQL health, applies pending forward migrations, then the API starts.
5. Check API readiness, sign-in, guest editor and project save. Review redacted logs and confirm no unexpected restart loop.

The migrator keeps an ordered journal and is designed to be rerun. There are no automatic down migrations. For a compatibility issue, roll back application images only after confirming the old API works with the migrated schema; preserve the DB volume and migration journal.

## Stop and uninstall

`docker compose stop` stops services without deleting data. `docker compose down` removes service containers/network but preserves the named database volume. Before uninstall, create and test an encrypted backup, then remove the stack only when the operator intends to stop using it. Never use `docker compose down -v` as routine cleanup.
