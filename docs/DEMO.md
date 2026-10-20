# Demo Mode (UAT)

Demo Mode gives independent testers a disposable, registered-user-like session so they can exercise
cloud projects, autosave, revision history, publication, temporary share links, the demo gallery and
Remix without an invitation, without an email address and without touching production accounts.

Login: `demo` / `demo` (or the **Try Demo** button, which needs no credentials).

Demo is not a real account. It is an in-process ephemeral session inside the API. Nothing about a
demo session is written to PostgreSQL, to backups, to mail, to analytics or to the public gallery.

## Why an ephemeral store instead of a production account

A shared `demo` account with a published password would have been a backdoor into real user data:
projects, gallery, moderation and admin checks all key off `users.id`. Instead:

- Demo sessions live in an in-memory `Map` in the API process (`server/demo-store.ts`).
- Projects, revisions, previews and publications are plain objects in that store, scoped to one
  session id.
- Demo requests are served by a dedicated router under `/api/v1/demo/*`; the production routes are
  untouched and only ever query PostgreSQL.
- A demo principal is `{ id: "demo:<session>", verified: true, active: true, isAdmin: false,
  demo: true }`. `can()` allows cloud projects/publish/remix and refuses `administer`.
- A separate httpOnly cookie (`randusr_demo_session`) carries the demo token. A demo cookie cannot
  authenticate a production route and a production cookie cannot authenticate a demo route.

The consequence is explicit: **a demo share link outlives neither the session nor the API process**.
Restarting the API destroys every demo session. That is acceptable for UAT and is the strongest
guarantee that demo data never reaches a PostgreSQL backup.

## Session lifecycle

| Setting | Default | Env |
| --- | --- | --- |
| Enabled | `true` (set `false` to disable) | `DEMO_MODE_ENABLED` |
| Idle timeout | 60 min | `DEMO_IDLE_MINUTES` |
| Absolute lifetime | 24 h | `DEMO_ABSOLUTE_HOURS` |
| Max concurrent sessions | 50 | `DEMO_MAX_SESSIONS` |
| Sessions per IP | 10 | `DEMO_MAX_SESSIONS_PER_IP` |
| Max projects per session | 10 | `DEMO_MAX_PROJECTS` |
| Max revisions per project | 20 | `DEMO_MAX_REVISIONS` |
| Max bytes per session | 4 MiB | `DEMO_MAX_SESSION_BYTES` |
| Max bytes for all sessions | 64 MiB | `DEMO_MAX_STORE_BYTES` |
| Demo logins per 15 min / IP | 10 | `DEMO_LOGIN_PER_15_MINUTES` |
| Expired-link tombstone | 7 days (memory only) | `DEMO_TOMBSTONE_HOURS` |

- Last-seen is refreshed on every demo API request (sliding idle window).
- A one-minute sweeper removes expired sessions and their projects/previews. `.unref()` keeps it from
  holding the process open.
- Logout deletes the session immediately and tombstones its public/unlisted share codes so old links
  stop working. Expiry does the same. A tombstone answers `410 DEMO_EXPIRED` for a few days, which the
  viewer turns into a calm "Demo project expired" page. After an API restart tombstones are gone too,
  so the same link returns the generic "not found" page.
- Closing a tab does not delete anything: the cookie survives (24 h) and a reload resumes the same
  session.
- A readable companion cookie (`randusr_demo=1`) lets the SPA choose the `/api/v1/demo` base before
  the first request. It is not an authentication token; the server still requires the httpOnly
  session cookie.

## What is stored where

| Data | Location | Lifetime |
| --- | --- | --- |
| Session id, token hash, timestamps, IP | API process memory | idle/absolute TTL |
| Project snapshot (including title and optional instructions), version, visibility, short code | API process memory | session TTL |
| Revisions (bounded) | API process memory | session TTL |
| Private sprite, SFX and Instrument assets and immutable versions | Per-session API memory; projects bundle exact pixel and recipe versions | session TTL |
| Publication snapshot + metadata + tags | API process memory | session TTL |
| 256×192 preview PNG | API process memory (`Buffer`) | session TTL |
| Audit trail | **not stored** (only in-memory publication counters) | — |
| Email, analytics events, invitations | **never** | — |

No demo row is inserted into `users`, `sessions`, `projects`, `project_revisions`,
`project_previews`, `audit_log`, `tags`, `project_tags` or analytics tables. The demo code does not
even receive the PostgreSQL `Database` handle.

## Temporary sharing

- Publishing creates an in-memory publication revision and a 16-character `shortCode`
  (`randomBytes(12).toString("base64url")`), exactly the same shape as a real share code.
- While the owner session is alive:
  - `GET /api/v1/demo/shared/:code` serves the pinned publication to the owner (including private).
  - `GET /api/v1/shared/:code` (production route) falls back to the demo store **only when the code
    does not exist in PostgreSQL**. Anonymous/incognito visitors can therefore open
    `https://<host>/p/<code>`. Only `public` and `unlisted` demo projects are exposed; `private`
    returns 404.
  - `GET /api/v1/shared/:code/preview/:key` likewise serves the in-memory PNG for public/unlisted
    demo publications.
- After logout/expiry the tombstone makes the same URL `410 DEMO_EXPIRED` for *every* requester —
  anonymous visitors (`/api/v1/shared/:code`) and other demo sessions (`/api/v1/demo/shared/:code`) —
  and the viewer shows the same friendly "Demo project expired" page. A code that never existed
  stays a generic not-found page.
- Demo `GET /api/v1/demo/gallery` lists only the *current session's* published public projects. The
  production `/api/v1/gallery` never sees demo data. Two demo sessions never see each other's
  projects, revisions or gallery.
- Every demo shared response carries `X-Robots-Tag: noindex, nofollow`; the viewer also sets a
  `robots` meta tag for demo pages.
- Remix is allowed only for a publication that belongs to the current demo session. A link opened by
  another demo session is view-and-run only: the shared DTO carries `remixable: false`, the viewer
  hides Remix and explains why, and `POST /api/v1/demo/shared/:code/remix` answers
  `403 DEMO_FOREIGN_REMIX` without creating anything. This keeps the "no access to another demo
  session's data" rule strict. A same-session Remix and Duplicate accept an optional localized
  `title` ("Remix of …", "Copy of …"); the Remix keeps a `remixedFrom` credit (title, author, link
  only while the source is still shared) and starts with the source's picture.
- The chosen language lives in the demo session: `PATCH /api/v1/demo/account` stores `locale` in the
  in-memory session, `Try Demo` seeds it from the current device language, and `/auth/me` reports it back,
  so Home, the editor, My Projects, shared links and a reload keep RU/DE/JA instead of falling back to EN.
  Nothing is written to PostgreSQL.
- The DEMO bar, the Try Demo block and the account dialog are localized in all eight locales. In a
  demo session the account dialog shows only the demo explanation and **Exit demo**; it never offers
  Log in / Forgot password, which have no demo routes.
- The Home gallery says "DEMO GALLERY (only you can see it)" during a demo session and marks each
  card with a Demo badge.

## API surface

Production-scope (available with no demo session):

- `POST /api/v1/auth/demo` — body optional; no body = Try Demo, `{username:"demo",password:"demo"}`
  = automated tests. Rate-limited per IP. Returns the demo principal and sets both cookies.
- `GET /api/v1/auth/policy` — adds `demoEnabled`, so the login UI can hide Try Demo when disabled.

Demo-scope (requires `randusr_demo_session`; all responses use the real DTO shapes):

```
GET    /api/v1/demo/session
GET    /api/v1/demo/auth/me
GET    /api/v1/demo/auth/csrf
GET    /api/v1/demo/auth/policy
POST   /api/v1/demo/auth/logout
GET    /api/v1/demo/limits
GET    /api/v1/demo/analytics/config      (always disabled)
POST   /api/v1/demo/analytics/events      (always accepted, never recorded)
GET    /api/v1/demo/projects
POST   /api/v1/demo/projects
GET    /api/v1/demo/projects/:id
PUT    /api/v1/demo/projects/:id
PATCH  /api/v1/demo/projects/:id
DELETE /api/v1/demo/projects/:id
POST   /api/v1/demo/projects/:id/duplicate
POST   /api/v1/demo/projects/:id/preview
GET    /api/v1/demo/projects/:id/preview/:key
GET    /api/v1/demo/projects/:id/revisions
GET    /api/v1/demo/projects/:id/revisions/:revisionId
POST   /api/v1/demo/projects/:id/revisions/:revisionId/restore
POST   /api/v1/demo/projects/:id/revisions/:revisionId/copy
GET    /api/v1/demo/projects/:id/share
POST   /api/v1/demo/projects/:id/share
POST   /api/v1/demo/projects/:id/share/rotate
GET    /api/v1/demo/shared/:code
GET    /api/v1/demo/shared/:code/preview/:key
POST   /api/v1/demo/shared/:code/remix
GET    /api/v1/demo/gallery
```

The SPA keeps using the same components and DTOs; only the API base switches to `/api/v1/demo`
when the readable demo cookie is present. There is no second set of screens.

## Limits and abuse resistance

- Max sessions, per-IP sessions, projects, revisions, session bytes and total bytes are hard caps;
  exceeding them returns `QUOTA_EXCEEDED` (409) or `RATE_LIMITED` (429), never a silent success.
- Login is rate-limited per IP; each demo request is counted per session (300/min) and publications
  are limited to 20 per 15 minutes, mirroring the real publication limit.
- Bodies remain under the global 512 KiB `bodyLimit`; `sourceCode` uses the same
  `MAX_SOURCE_CHARACTERS` schema; preview frames must be exactly 65 536 palette-index characters.
- The store has no unbounded timers, listeners or queues: one sweeper, one map per data type.
- Demo principals are never administrators, never receive mail, never call the mailer and never write
  analytics. Admin routes resolve only the production cookie, so a demo cookie cannot reach them.
- `DEMO_MODE_ENABLED=false` removes the login endpoint and the demo router; the Try Demo button
  disappears because `/auth/policy` reports `demoEnabled:false`.

## Operational notes

- Memory is bounded by `DEMO_MAX_STORE_BYTES` (64 MiB default) plus small per-session bookkeeping.
  The default is intentionally far below the Lightsail instance's headroom and no disk is used.
- Demo data disappears on API restart; no migration, backup or volume change is involved.
- The demo feature adds no PostgreSQL migrations.
- `compose.production.yaml` sets `DEMO_MODE_ENABLED` explicitly so the closed test can choose.
- To disable instantly: set `DEMO_MODE_ENABLED=false` and recreate only the API container. Existing
  demo sessions become unusable because the router is not registered.
