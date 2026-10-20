import { platformLimits } from "./limits.js";
import { sql } from "drizzle-orm";
import type { Database } from "./db/client.js";
import { projectRevisions } from "./db/schema.js";
import type { ProjectSnapshot } from "../shared/project.js";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export const historyLimits = {
  count: platformLimits.historyCount,
  days: platformLimits.historyDays,
};
export async function pruneHistory(tx: Tx, projectId: string) {
  // Called under the project row lock. Foreign keys independently protect pinned rows.
  await tx.execute(sql`with ordinary as (
    select r.id, r.created_at, row_number() over(order by r.number desc) as position
    from project_revisions r where r.project_id = ${projectId}
      and not exists(select 1 from projects p where p.published_revision_id = r.id or p.remixed_from_revision_id = r.id)
  ) delete from project_revisions r using ordinary o where r.id = o.id and o.position > 1
    and (o.position > ${historyLimits.count} or o.created_at < now() - ${historyLimits.days} * interval '1 day')`);
}
export async function checkpoint(
  tx: Tx,
  projectId: string,
  actorId: string,
  number: number,
  snapshot: ProjectSnapshot,
  reason: string,
) {
  const [revision] = await tx
    .insert(projectRevisions)
    .values({
      projectId,
      actorId,
      number,
      snapshot: { ...snapshot },
      snapshotVersion: snapshot.version,
      reason,
    })
    .returning();
  await pruneHistory(tx, projectId);
  return revision;
}
