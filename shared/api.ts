import type { Principal } from "./permissions.js";
export interface SessionResponse {
  principal: Principal | null;
}
export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "VERSION_CONFLICT"
  | "QUOTA_EXCEEDED"
  | "PROJECT_ARCHIVED"
  | "LAST_ADMIN"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_EXISTS"
  | "INVALID_TOKEN"
  | "CSRF_FAILED"
  | "RATE_LIMITED"
  | "MAIL_UNAVAILABLE"
  | "REGISTRATION_CLOSED"
  | "POLICY_REQUIRED"
  | "EMAIL_UNVERIFIED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "DEMO_EXPIRED"
  | "DEMO_FOREIGN_REMIX"
  | "DEMO_DISABLED"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "PAYLOAD_TOO_LARGE";
export interface ApiErrorEnvelope {
  error: { code: ApiErrorCode; requestId: string };
}

export interface Account {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  verified: boolean;
  createdAt: string;
}
