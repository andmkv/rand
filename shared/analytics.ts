export const clientEvents = [
  "homepage_viewed",
  "example_opened",
  "example_run",
  "program_run",
  "signup_started",
  "public_project_viewed",
  "public_project_run",
  "file_imported",
  "file_exported",
] as const;
export const productEvents = [
  ...clientEvents,
  "signup_completed",
  "signup_verified",
  "login",
  "cloud_project_created",
  "cloud_project_saved",
  "project_published",
  "project_unpublished",
  "project_remixed",
] as const;
export type ClientEvent = (typeof clientEvents)[number];
export type ProductEvent = (typeof productEvents)[number];
export interface AnalyticsConfiguration {
  enabled: boolean;
  noticeVersion: string | null;
  noticeUrl: string | null;
}
export interface ProductHealth {
  accounts: {
    total: number;
    verified: number;
    admins: number;
    active7d: number;
  };
  projects: { total: number; public: number; remixes: number };
  analytics: {
    enabled: boolean;
    windowDays: number;
    events: { event: ProductEvent; count: number; sessions: number }[];
    funnel: { stage: string; sessions: number }[];
  };
}
