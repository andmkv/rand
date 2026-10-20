import { projectTagIds } from "../../shared/tags.js";
import { fileURLToPath } from "node:url";
import { tags } from "./schema.js";
import { connectDatabase, type Database } from "./client.js";
import { readConfig } from "../config.js";
export async function seedDatabase(db: Database) {
  // Seeding is idempotent and only ensures public taxonomy. Admin bootstrap is
  // a one-time verified-mail flow, never a startup side effect.
  return db.transaction(async (tx) => {
    await tx
      .insert(tags)
      .values(projectTagIds.map((slug) => ({ slug })))
      .onConflictDoNothing();
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = readConfig();
  const { db, pool } = connectDatabase(config.databaseUrl);
  try {
    await seedDatabase(db);
    console.log("Seed complete; public tags ensured (no admin changes)");
  } catch {
    console.error("Seed failed");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
