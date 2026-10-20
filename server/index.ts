import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { connectDatabase } from "./db/client.js";
const config = readConfig();
const { db, pool } = connectDatabase(config.databaseUrl);
const app = buildApp(db, true);
app.addHook("onClose", async () => {
  await pool.end();
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    void app.close();
  });
try {
  await app.listen({ host: config.host, port: config.port });
} catch {
  console.error("API startup failed");
  await app.close();
  process.exitCode = 1;
}
