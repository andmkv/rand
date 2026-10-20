import { parseArgs } from "node:util";
import { open, unlink } from "node:fs/promises";
import { createInvitation } from "./invitations.js";
import { readConfig } from "./config.js";
import { connectDatabase } from "./db/client.js";
// Operator-only CLI: no public invite creation, no mail sending, no token in stdout.
let email: string | undefined,
  output: string | undefined,
  adult = false;
try {
  const args = parseArgs({
    options: {
      email: { type: "string" },
      out: { type: "string" },
      "adult-tester": { type: "boolean" },
    },
    strict: true,
  });
  email = args.values.email;
  output = args.values.out;
  adult = args.values["adult-tester"] === true;
} catch {
  /* Emit safe fixed usage below, never raw argument values. */
}
if (!email || !output || !adult) {
  console.error(
    "Usage: invite --email <adult tester email> --out <new private JSON file> --adult-tester",
  );
  process.exitCode = 1;
} else {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let pool: ReturnType<typeof connectDatabase>["pool"] | undefined;
  try {
    const base = new URL(process.env.APP_BASE_URL ?? "http://localhost:5173");
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash
    )
      throw new Error();
    file = await open(output, "wx", 0o600);
    const connection = connectDatabase(readConfig().databaseUrl);
    pool = connection.pool;
    const invitation = await createInvitation(connection.db, email);
    const link = new URL("/invite", base);
    link.hash = new URLSearchParams({ token: invitation.token }).toString();
    await file.writeFile(
      JSON.stringify(
        {
          email: email.trim().toLowerCase(),
          url: link.href,
          expiresAt: invitation.expiresAt,
        },
        null,
        2,
      ),
    );
    console.log(
      "Invitation saved to the requested private file. Share only with the invited adult tester.",
    );
  } catch {
    if (file) await unlink(output).catch(() => {});
    console.error(
      "Invitation creation failed; inspect configuration/output path privately. No invitation was printed.",
    );
    process.exitCode = 1;
  } finally {
    await file?.close();
    await pool?.end();
  }
}
