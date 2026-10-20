import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { connectDatabase } from "./db/client.js";
import { readConfig } from "./config.js";
import { recoverAdmin } from "./admin-recovery.js";

export async function runAdminRecovery(args = process.argv.slice(2)) {
  if (!stdin.isTTY) throw new Error("Run administrator recovery from an interactive local terminal.");
  if (args.length !== 2 || args[0] !== "--email" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args[1]))
    throw new Error("Usage: npm run admin:recover -- --email verified-user@example.org");
  const email = args[1].trim().toLowerCase();
  const rl = createInterface({ input: stdin, output: stdout });
  let confirmation: string;
  try {
    confirmation = await rl.question(`No active administrator may exist. Promote the existing verified account ${email}? Type RECOVER ${email}: `);
  } finally {
    rl.close();
  }
  if (confirmation !== `RECOVER ${email}`) throw new Error("Administrator recovery cancelled.");

  const config = readConfig();
  const { db, pool } = connectDatabase(config.databaseUrl);
  try {
    const user = await recoverAdmin(db, email);
    stdout.write(`Administrator recovery recorded for ${user.email}. Sign in through the normal verified account flow.\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runAdminRecovery().catch((error) => {
    stdout.write(`Administrator recovery failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
