import type { ApiErrorCode } from "../shared/api";
export const usageChoiceKey = "randusr-usage-choice";
let usageNotice: string | null = null;
export const setUsageNotice = (version: string | null) => {
  usageNotice = version;
};
export function usageChoice(): {
  version: string;
  allowed: boolean;
  token?: string;
} | null {
  try {
    return JSON.parse(sessionStorage.getItem(usageChoiceKey) ?? "null");
  } catch {
    return null;
  }
}
export class ApiFailure extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
  }
}

/**
 * Demo Mode selects a separate API base. The readable marker cookie is only a routing hint;
 * authentication still requires the httpOnly demo session cookie.
 */
const demoFlag = "randusr_demo";
let demoMode =
  typeof document !== "undefined" &&
  document.cookie
    .split(";")
    .some((part) => part.trim() === `${demoFlag}=1`);
export const isDemoMode = () => demoMode;
export function setDemoMode(value: boolean) {
  demoMode = value;
  csrf = undefined;
}
export function clearDemoFlag() {
  if (typeof document !== "undefined")
    document.cookie = `${demoFlag}=; Max-Age=0; path=/; SameSite=Lax`;
}
const apiBase = () => (demoMode ? "/api/v1/demo" : "/api/v1");
let csrf: Promise<string> | undefined;
async function csrfToken() {
  return (csrf ??= fetch(`${apiBase()}/auth/csrf`, {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then(async (r) => {
      if (!r.ok || !r.headers.get("content-type")?.includes("application/json"))
        throw new ApiFailure("UNAVAILABLE");
      return (await r.json()).token as string;
    })
    .catch((error) => {
      csrf = undefined;
      throw error;
    }));
}
export async function api<T = { ok: boolean }>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const headers: Record<string, string> = {};
      const choice = usageChoice();
      if (
        usageNotice &&
        choice?.allowed &&
        choice.version === usageNotice &&
        /^[A-Za-z0-9_-]{43}$/.test(choice.token ?? "")
      ) {
        headers["x-product-session"] = choice.token!;
        headers["x-product-notice"] = usageNotice;
      }
      if (method !== "GET") {
        headers["x-csrf-token"] = await csrfToken();
        if (body !== undefined) headers["content-type"] = "application/json";
      }
      const response = await fetch(`${apiBase()}${path}`, {
        method,
        signal,
        credentials: "same-origin",
        cache: "no-store",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new ApiFailure("UNAVAILABLE");
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 && demoMode && typeof window !== "undefined")
          window.dispatchEvent(new Event("randusr-demo-ended"));
        if (data.error?.code === "CSRF_FAILED" && attempt === 0) {
          csrf = undefined;
          continue;
        }
        throw new ApiFailure(data.error?.code ?? "UNAVAILABLE");
      }
      return data;
    } catch (error) {
      throw error instanceof ApiFailure ? error : new ApiFailure("UNAVAILABLE");
    }
  }
  throw new ApiFailure("CSRF_FAILED");
}
