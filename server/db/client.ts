import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
export function connectDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 15000,
    query_timeout: 20000,
    idle_in_transaction_session_timeout: 150000,
  });
  // Query parameters / SQL can contain private content. Do not log database errors verbatim.
  pool.on("error", () =>
    console.error(
      JSON.stringify({
        level: 50,
        time: Date.now(),
        msg: "database_pool_error",
      }),
    ),
  );
  return { pool, db: drizzle(pool, { schema }) };
}
export type Database = ReturnType<typeof connectDatabase>["db"];
