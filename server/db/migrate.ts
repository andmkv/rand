import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readDatabaseUrl } from "../config.js";
import { connectDatabase, type Database } from "./client.js";
export const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
export async function migrateDatabase(db: Database, folder = migrationsFolder) {
  // Explicit command, not automatic on every API start. Drizzle applies pending SQL atomically.
  await migrate(db, { migrationsFolder: folder });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { db, pool } = connectDatabase(readDatabaseUrl());
  try {
    await migrateDatabase(db);
    console.log("Migrations applied");
  } catch {
    console.error(
      "Migration failed; inspect schema/configuration without sharing credentials",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
