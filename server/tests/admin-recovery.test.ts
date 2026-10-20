import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { disposablePostgres } from "./database.js";
import { migrateDatabase } from "../db/migrate.js";
import { recoverAdmin } from "../admin-recovery.js";
import { auditLog, users } from "../db/schema.js";

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
before(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg.db);
  await pg.db.insert(users).values([
    { email: "owner@example.invalid", displayName: "Verified owner", passwordHash: "fixture-only", verifiedAt: new Date() },
    { email: "other@example.invalid", displayName: "Other user", passwordHash: "fixture-only", verifiedAt: new Date() },
  ]);
});
after(async () => pg?.stop());

test("local recovery grants an existing verified account only when no active admin exists", async () => {
  const recovered = await recoverAdmin(pg.db, " OWNER@example.invalid ");
  assert.equal(recovered.email, "owner@example.invalid");
  const [owner] = await pg.db.select().from(users).where(eq(users.email, recovered.email));
  assert.equal(owner.isAdmin, true);
  const audit = await pg.db.select().from(auditLog).where(eq(auditLog.action, "admin.recovery"));
  assert.equal(audit.length, 1);
  await assert.rejects(recoverAdmin(pg.db, "other@example.invalid"), /active administrator/);
});
