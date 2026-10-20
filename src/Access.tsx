import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { can, type Permission, type Principal } from "../shared/permissions";
import type { Account, SessionResponse } from "../shared/api";
import { api, ApiFailure, isDemoMode, setDemoMode } from "./api";
import { finishDemo } from "./demoSession";
const AccessContext = createContext<{
  principal: Principal | null;
  account: Account | null;
  ready: boolean;
  refresh: () => Promise<void>;
  authRequest: number;
  requestAuthentication: () => void;
}>({
  principal: null,
  account: null,
  ready: false,
  refresh: async () => {},
  authRequest: 0,
  requestAuthentication: () => {},
});
export const useAccess = () => useContext(AccessContext);
export function AccessProvider({ children }: { children: ReactNode }) {
  const [authRequest, setAuthRequest] = useState(0);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const refreshEpoch = useRef(0);
  const refresh = useCallback(async () => {
    const epoch = ++refreshEpoch.current;
    try {
      const data = await api<SessionResponse>("/session");
      if (epoch !== refreshEpoch.current) return;
      const p = data.principal;
      if (
        p &&
        typeof p.id === "string" &&
        [p.active, p.verified, p.isAdmin].every(
          (v) => typeof v === "boolean",
        )
      ) {
        if (p.demo) setDemoMode(true);
        const me = await api<Account>("/auth/me");
        if (epoch !== refreshEpoch.current) return;
        if (me.id !== p.id) throw new Error("Session changed");
        setPrincipal(p);
        setAccount(me);
      } else {
        if (isDemoMode()) finishDemo();
        setPrincipal(null);
        setAccount(null);
      }
    } catch (error) {
      if (epoch !== refreshEpoch.current) return;
      if (
        isDemoMode() &&
        error instanceof ApiFailure &&
        ["AUTH_REQUIRED", "NOT_FOUND", "DEMO_DISABLED"].includes(error.code)
      )
        finishDemo();
      setPrincipal(null);
      setAccount(null);
    } finally {
      if (epoch === refreshEpoch.current) setReady(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) void refresh();
    };
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("pageshow", restored);
    const online = () => void refresh();
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  return (
    <AccessContext.Provider
      value={{
        principal,
        account,
        ready,
        refresh,
        authRequest,
        requestAuthentication: () => setAuthRequest((n) => n + 1),
      }}
    >
      {children}
    </AccessContext.Provider>
  );
}
export function PermissionBoundary({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  return can(useAccess().principal, permission) ? children : null;
}
