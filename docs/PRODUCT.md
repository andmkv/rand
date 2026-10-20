# Product contract

Randomize USR is a guest-first creative coding storybook inspired by 8-bit computers. People can edit and run a BASIC-like language, draw on a 256×192 pixel screen, use sprites and synthesized sounds, and exchange portable `.randusr` projects. User BASIC is interpreted in the browser; the server stores project source as data.

## Access modes

- **Guest:** edit and run locally, use Story, Spellbook, Inventory and built-in Examples, open public or unlisted projects, and import/export `.randusr` files without an account.
- **Registered account:** all guest features, plus private cloud projects, autosave, history, sharing, publishing, remixing and a personal asset library.
- **Administrator:** a protected flag on a verified active registered account. Admin operations are explicit, server-authorized and audited; the flag does not grant project ownership.

There are no teacher/student roles, classes, assignments, join codes or school onboarding flows.

## Authoritative permission matrix

`shared/permissions.ts` and server route guards implement this table. Resource ownership and publication visibility are checked separately.

| Permission | Guest | Registered | Admin |
| --- | --- | --- | --- |
| localEditor | yes | yes | yes |
| browsePublic | yes | yes | yes |
| viewShared | yes | yes | yes |
| cloudProjects | no | yes | yes |
| publish | no | yes | yes |
| remix | no | yes | yes |
| accountSettings | no | yes | yes |
| administer | no | no | yes |

Email verification is required before cloud writes, publishing, remixing or admin actions. Suspended and deleted accounts have no account access.

## Projects and sharing

New cloud projects are private. A publication pins an immutable revision; later edits do not change a shared snapshot. Unlisted projects are available to people with the link and do not appear in gallery/search. Public projects can appear in the gallery. Only available published snapshots are served to viewers. Remix copies the pinned publication into a new private project without granting access to the original.

Project snapshots embed the exact versioned assets needed to run. `.randusr` exports remain portable and anonymous viewers do not fetch private asset-library records. See [asset contracts](ASSETS.md) when working with those formats.

## Creative tools and content

- The BASIC interpreter, graphics, keyboard input, Story/Sandbox, Spellbook, Inventory, Examples and local project recovery work for guests.
- The indexed pixel editor stores versioned `IndexedSpriteV1` and `AnimatedSpriteV1` resources. Animated frame playback uses the runtime's shared render cycle.
- Sound Lab creates versioned declarative SFX and pitched instruments. The editor, Inventory and BASIC share the same Web Audio synthesis engine. Built-in sounds need a user gesture before audio starts.
- The shipped examples are the examples in this source snapshot. Separate unfinished game branches are not part of this distribution.

Personal sound and sprite resources are private by default. Projects pin immutable versions. Individual asset sharing is outside the current product boundary.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Public discovery, built-in Examples and public gallery |
| `/book`, `/book/:chapter`, `/book/print` | Public Handbook and BASIC reference; no account required |
| `/create` | Guest or registered Story/Sandbox editor |
| `/examples/:id` | Built-in read/run example |
| `/p/:shortCode` | Public or unlisted pinned project viewer |
| `/me/projects` | Registered user's private cloud project library |
| `/settings` | Account profile and locale settings |
| `/admin` | Verified administrator console |

## Trust and privacy boundaries

The API derives identity from a hashed server-side session cookie and applies the permission matrix independently of frontend visibility. Bootstrap email is supplied by the operator through `ADMIN_BOOTSTRAP_EMAIL`; there is no built-in administrator identity or password. First-admin onboarding requires mailbox verification and is locked after use. The local recovery CLI only promotes an existing verified account when the database has no active administrator.

Demo is an isolated temporary session, not a real account. Demo projects and links live in API memory, expire, and are not written to PostgreSQL, mail, analytics or the real public gallery. Disable it with `DEMO_MODE_ENABLED=false`.

The application does not execute user source on the server. Input, project size, recipes, concurrent audio voices and event rates are bounded. Migrations are forward-only; operators should back up and verify restore before upgrades.
