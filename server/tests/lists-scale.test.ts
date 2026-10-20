import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import * as schema from "../db/schema.js";
import { buildApp } from "../app.js";
import { hashToken, sessionCookie } from "../access.js";

test(
  "hundreds of gallery/library records paginate without N+1 queries or private payloads",
  { timeout: 150000 },
  async () => {
    const pg = await disposablePostgres();
    let app: ReturnType<typeof buildApp> | undefined;
    try {
      await migrateDatabase(pg.db);
      let queries = 0;
      const db = drizzle(pg.pool, {
        schema,
        logger: {
          logQuery() {
            queries++;
          },
        },
      });
      const [owner] = await db
        .insert(schema.users)
        .values({
          email: "scale@example.invalid",
          displayName: "Scale fixture",
          passwordHash: "fixture-not-for-login",
          verifiedAt: new Date(),
        })
        .returning();
      const token = randomBytes(32).toString("base64url");
      await db.insert(schema.sessions).values({
        userId: owner.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 600000),
      });
      const snapshot = {
        mode: "sandbox",
        sourceCode: 'PRINT "PRIVATE_SCALE_SOURCE"\n'.repeat(100),
      };
      const projects = await db
        .insert(schema.projects)
        .values(
          Array.from({ length: 350 }, (_, i) => ({
            ownerId: owner.id,
            title: `Scale ${i}`,
            snapshot,
            mode: "sandbox" as const,
            shortCode: `scale${String(i).padStart(11, "0")}`,
          })),
        )
        .returning();
      const revisions = await db
        .insert(schema.projectRevisions)
        .values(
          projects.map((p) => ({
            projectId: p.id,
            actorId: owner.id,
            number: 1,
            snapshot,
            reason: "created",
          })),
        )
        .returning();
      // Fixture setup is outside the measured requests; each real list must stay constant-query.
      for (const r of revisions)
        await db
          .update(schema.projects)
          .set({
            visibility: "public",
            publishedRevisionId: r.id,
            publishedAt: new Date("2026-10-18T00:00:00Z"),
            publishedMetadata: {
              title: "Scale art",
              description: "A pixel toy",
              tags: ["art"],
              previewKey: null,
            },
          })
          .where(eq(schema.projects.id, r.projectId));
      app = buildApp(db);
      for (const [path, field, key, count, maxQueries] of [
        ["/gallery", "projects", "shortCode", 350, 1],
        ["/projects", "projects", "id", 350, 3],
      ] as const) {
        let cursor: string | null = null;
        const seen = new Set<string>();
        let pages = 0;
        do {
          queries = 0;
          const response = await app.inject({
            method: "GET",
            url: `/api/v1${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
            headers: { cookie: `${sessionCookie}=${token}` },
          });
          assert.equal(response.statusCode, 200);
          assert.ok(queries <= maxQueries, `${path}: ${queries} queries/page`);
          assert.ok(
            response.rawPayload.length < 40000,
            `${path}: metadata page too large`,
          );
          assert.doesNotMatch(
            response.body,
            /PRIVATE_SCALE_SOURCE|passwordHash|tokenHash/,
          );
          const page = response.json();
          assert.ok(page[field].length > 0 && page[field].length <= 30);
          for (const row of page[field]) {
            assert.ok(!seen.has(row[key]));
            seen.add(row[key]);
          }
          cursor = page.nextCursor;
          assert.ok(++pages < 20, "pagination must terminate");
        } while (cursor);
        assert.equal(seen.size, count, path);
      }
    } finally {
      await app?.close();
      await pg.stop();
    }
  },
);
