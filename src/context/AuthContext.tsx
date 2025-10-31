import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiHttpError } from "@/lib/http";

/**
 * AuthContext
 * -----------------------------------------------------------------------------
 * Purpose (non-developer friendly):
 * After you sign in and the backend sets secure cookies, the frontend must ask
 * the API “who am I and what can I see/do?” exactly once (and whenever tenant
 * switches or a refresh happens). This context loads that `/me/context` answer
 * and exposes simple helpers:
 *   - me:        current tenant + user + roles + permissions + ui_resources + abac
 *   - loading:   whether we’re still fetching context
 *   - error:     last fatal error message (if any)
 *   - hasPerm:   quick check for permissions (RBAC)
 *   - isPageEnabled: build menus from server-owned `ui_resources.pages`
 *   - refreshContext: re-fetch context (e.g., after auth.exchange or switch)
 *   - logout:    call backend logout and clear state
 *   - switchTenant: move to another tenant (server re-mints cookies), then reload context
 *
 * Security notes:
 * - We NEVER touch or store tokens in JS; cookies are HttpOnly.
 * - All calls go through the HTTP wrapper which:
 *     * includes credentials
 *     * carries CSRF on non-GET
 *     * attempts one silent refresh on 401, then fails (no loops)
 *
 * Contract alignment:
 * - Mirrors `/me/context` response described in the backend DTO.
 *   See: MeContextDTO fields (tenant, user, roles, permissions, ui_resources, abac, meta.ev).
 */

/** Typed slices from `/me/context` (kept minimal and stable) */
export type TenantDTO = {
  tenantId: string;
  name?: string | null;
  timezone?: string | null;
};

export type UserDTO = {
  userId: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

export type UIResourcesDTO = {
  /** Pages allowed for this tenant/user (server-owned list; FE must not hardcode) */
  pages: string[];
  /** Action keys (feature flags for UI affordances; still validated via permissions) */
  actions: string[];
};

export type ABACDTO = {
  /** Staff room scope */
  rooms: string[];
  /** Parent-scoped students */
  guardianOf: string[];
};

export type MetaDTO = {
  /** Authorization epoch/version — used by server to force refresh on drift */
  ev: number;
};

export type MeContextDTO = {
  tenant: TenantDTO;
  user: UserDTO;
  roles: string[];
  permissions: string[];
  ui_resources: UIResourcesDTO;
  abac: ABACDTO;
  meta: MetaDTO;
};

type AuthContextState = {
  me: MeContextDTO | null;
  loading: boolean;
  error?: string;
  /** RBAC gate — returns true only if ALL required permissions are present */
  hasPerm: (requires: string | string[]) => boolean;
  /** UI flag — whether a server-declared page is enabled for this principal */
  isPageEnabled: (pageId: string) => boolean;
  /** Manually re-fetch `/me/context` (useful after auth.exchange or explicit refresh) */
  refreshContext: () => Promise<void>;
  /** POST /auth/logout → clears cookies server-side; also clears local state */
  logout: () => Promise<void>;
  /** POST /auth/switch { tenantId } → then reload context */
  switchTenant: (tenantId: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextState | undefined>(undefined);

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [me, setMe] = useState<MeContextDTO | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const hasPerm = useCallback(
    (requires: string | string[]) => {
      if (!me) return false;
      const req = Array.isArray(requires) ? requires : [requires];
      if (req.length === 0) return true; // no requirement → allow
      // Permissions are server-flattened and normalized to strings
      const set = new Set(me.permissions || []);
      return req.every((p) => set.has(p));
    },
    [me]
  );

  const isPageEnabled = useCallback(
    (pageId: string) => {
      if (!me) return false;
      return (me.ui_resources?.pages || []).includes(pageId);
    },
    [me]
  );

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      // The wrapper handles credentials, CSRF and one refresh-retry on 401.
      const ctx = await api.get<MeContextDTO>("/me/context");
      setMe(ctx);
    } catch (e: any) {
      const err = e as ApiHttpError;
      // Map common failure shapes into a concise user-safe message.
      // If wrapper already retried and still got 401, user needs to sign in again.
      const code = err?.code;
      if (code === "EXPIRED" || code === "EV_OUTDATED") {
        setMe(null);
        setError("Your session has expired. Please sign in again.");
      } else if (code === "RATE_LIMITED") {
        setError("Too many requests. Please try again shortly.");
      } else if (code === "CSRF_FAILED") {
        setError("Security check failed. Please refresh the page and try again.");
      } else {
        setError("Could not load your workspace. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshContext = useCallback(async () => {
    await loadContext();
  }, [loadContext]);

  const logout = useCallback(async () => {
    try {
      // Server clears cookies (HttpOnly). We just reset in-memory state.
      await api.post("/auth/logout", {});
    } catch {
      /* ignore — UX treats logout as best-effort */
    } finally {
      setMe(null);
      setError(undefined);
      setLoading(false);
    }
  }, []);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      // Backend re-mints cookies for the new tenant; then we must reload `/me/context`.
      await api.post("/auth/switch", { tenantId });
      await loadContext();
    },
    [loadContext]
  );

  // Initial boot: try to load context (if cookies are present, it will succeed)
  useEffect(() => {
    loadContext();
  }, [loadContext]);

  const value = useMemo<AuthContextState>(
    () => ({
      me,
      loading,
      error,
      hasPerm,
      isPageEnabled,
      refreshContext,
      logout,
      switchTenant,
    }),
    [me, loading, error, hasPerm, isPageEnabled, refreshContext, logout, switchTenant]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/** Hook to consume auth state anywhere in the app */
export const useAuth = (): AuthContextState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
