export const reportReasons = [
  "spam",
  "inappropriate",
  "personal_info",
  "copyright",
  "other",
] as const;
export type ReportReason = (typeof reportReasons)[number];
export interface ReportQueueItem {
  id: string;
  project: { id: string; title: string; shortCode: string };
  owner: { id: string; displayName: string };
  reason: ReportReason;
  detail: string | null;
  state: "open" | "dismissed" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  openCount: number;
}
export interface ReportQueue {
  reports: ReportQueueItem[];
  nextCursor: string | null;
}
