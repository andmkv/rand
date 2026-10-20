import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "./db/client.js";
import { auditLog, users } from "./db/schema.js";

export const adminRoleLockId = 1381323858;

/** Local operator recovery only: requires an existing verified account and no active admin. */
export async function recoverAdmin(db: Database, requestedEmail: string) {
  const email = requestedEmail.trim().toLowerCase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${adminRoleLockId})`);
    const [admin] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.isAdmin, true),
          isNotNull(users.verifiedAt),
          eq(users.state, "active"),
        ),
      )
      .limit(1);
    if (admin) throw new Error("An active administrator already exists.");

    const [candidate] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .for("update");
    if (!candidate || !candidate.verifiedAt || candidate.state !== "active")
      throw new Error("Target must be an existing active, verified account.");
    if (candidate.isAdmin) throw new Error("Target is already an administrator.");

    await tx
      .update(users)
      .set({ isAdmin: true, updatedAt: new Date() })
      .where(eq(users.id, candidate.id));
    await tx.insert(auditLog).values({
      actorId: null,
      action: "admin.recovery",
      targetType: "user",
      targetId: candidate.id,
      metadata: { mechanism: "local_cli" },
    });
    return { id: candidate.id, email: candidate.email };
  });
}
