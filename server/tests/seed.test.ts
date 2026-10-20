import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { seedDatabase } from "../db/seed.js";
import { users } from "../db/schema.js";

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
before(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg.db);
  await pg.db.insert(users).values({
    email: "owner@example.invalid",
    displayName: "Verified owner",
    passwordHash: "fixture-only",
    verifiedAt: new Date(),
  });
});
after(async () => pg?.stop());

test("idempotent seed never grants administrator privileges", async () => {
  await seedDatabase(pg.db);
  await seedDatabase(pg.db);
  const [owner] = await pg.db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.invalid"));
  assert.equal(owner.isAdmin, false);
});
