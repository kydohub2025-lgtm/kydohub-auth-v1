// src/context/MeContext.tsx
//
// Purpose
// -------
// Central provider for authenticated UI state:
//   • Current user, tenant, roles, attributes
//   • Flat permission set (RBAC) + ui_resources (page/action gating)
//   • Version (ev) for cache-busting/staleness checks
//   • Helpers to check access: has(), allowPage(), allowAction()
//   • Reload mechanism and auto-refresh listening
//
// How it integrates
// -----------------
// - Uses `api.get("/me/context")` from src/lib/fetch/http.ts
// - Reacts to `window` event `auth:refreshed` (fired after POST /auth/refresh)
// - Consumers wrap the app with <MeProvider> and read via useMe()
//
// Security model
// --------------
// - All decisions here are defensive UI hints only.
// - The backend remains the source of truth and enforces RBAC/ABAC on every API.
// - Pages and actions are allowed only if their `requires` ⊆ permission set.
// - If requires is omitted/empty, treat as allowed (feature toggles can still hide them).
//
// Typical usage
// -------------
//   <MeProvider>
//     <AppRoutes />
//   </MeProvider>
//
//   const { me, loading, has, allowPage, allowAction } = useMe();
//   if (allowAction("students.create")) { /* render "Add Student" button */ }
//
// Notes for non-devs
// ------------------
// - Put this provider high in the tree (e.g., in src/main.tsx around <App/>).
// - If you sign in/out or switch tenants, this will auto-refetch context.
// - Errors (e.g., not signed in) set `me=null` so routes/components can redirect.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  PropsWithChildren,
} from "react";
import { api } from "@/lib/http";

// ---------------------------------------------
// Types aligned with backend /me/context schema
// ---------------------------------------------

export type PermissionCode = string;

export interface UIResourceItem {
  id: string;
  requires?: PermissionCode[] | null; // if omitted/null/[], considered no special permission
}

export interface UIResources {
  pages: UIResourceItem[];
  actions: UIResourceItem[];
}

export interface MeContextDTO {
  user: {
    id: string; // UUID
    email?: string;
    name?: string | null;
  };
  tenant: {
    tenantId: string; // ObjectId or UUID (string)
    name?: string | null;
    code?: string | null;
  };
  membership: {
    roles: string[];
    attrs?: Record<string, unknown>; // ABAC attributes (roomId, grade, etc.)
    status?: "active" | "inactive";
  };
  permissions: PermissionCode[]; // flattened RBAC from roles
  ui_resources: UIResources; // server-defined page/action gating
  meta: {
    ev: number; // auth state version for staleness
  };
}

// Public shape of the React context
export interface MeState {
  me: MeContextDTO | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  // Permission helpers
  has: (perm: PermissionCode) => boolean;
  hasAll: (perms: PermissionCode[]) => boolean;
  hasAny: (perms: PermissionCode[]) => boolean;
  allowPage: (pageId: string) => boolean;
  allowAction: (actionId: string) => boolean;
  ev: number | null;
}

// ---------------------------------------------
// React Context + Hook
// ---------------------------------------------

const Ctx = createContext<MeState | undefined>(undefined);

export function useMe(): MeState {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useMe() must be used within <MeProvider>");
  }
  return ctx;
}

// ---------------------------------------------
// Internal helpers
// ---------------------------------------------

function asSet(arr?: PermissionCode[] | null): Set<PermissionCode> {
  return new Set((arr ?? []).map((s) => s.trim()).filter(Boolean));
}

function requiresAllowed(
  requires: PermissionCode[] | null | undefined,
  granted: Set<PermissionCode>
): boolean {
  // If a page/action has no "requires", treat as allowed.
  if (!requires || requires.length === 0) return true;
  for (const code of requires) {
    if (!granted.has(code)) return false;
  }
  return true;
}

function indexById(items: UIResourceItem[] | undefined): Map<string, UIResourceItem> {
  const map = new Map<string, UIResourceItem>();
  (items ?? []).forEach((it) => {
    if (it?.id) map.set(it.id, it);
  });
  return map;
}

// ---------------------------------------------
// Provider
// ---------------------------------------------

export function MeProvider({ children }: PropsWithChildren<{}>) {
  const [me, setMe] = useState<MeContextDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dto = await api.get<MeContextDTO>("/me/context");
      setMe(dto ?? null);
      evRef.current = dto?.meta?.ev ?? null;
      setLoading(false);
    } catch (e: any) {
      // If unauthenticated or server error, surface neutral state
      setMe(null);
      evRef.current = null;
      setLoading(false);
      setError(e?.message || "Failed to load context");
      // You may redirect on 401 in your router guard if desired.
    }
  }, []);

  // Initial load
  useEffect(() => {
    void reload();
  }, [reload]);

  // Listen for auth refresh → reload context
  useEffect(() => {
    const onRefreshed = () => {
      // Only reload if we had a prior context or if someone is waiting on it.
      void reload();
    };
    window.addEventListener("auth:refreshed", onRefreshed);
    return () => window.removeEventListener("auth:refreshed", onRefreshed);
  }, [reload]);

  // Derived data for permission checks
  const value: MeState = useMemo(() => {
    const granted = asSet(me?.permissions);
    const pagesIdx = indexById(me?.ui_resources?.pages ?? []);
    const actionsIdx = indexById(me?.ui_resources?.actions ?? []);
    const ev = me?.meta?.ev ?? null;

    const has = (perm: PermissionCode) => granted.has(perm);
    const hasAll = (perms: PermissionCode[]) => perms.every((p) => granted.has(p));
    const hasAny = (perms: PermissionCode[]) => perms.some((p) => granted.has(p));

    const allowPage = (pageId: string) => {
      const def = pagesIdx.get(pageId);
      if (!def) return false; // not declared → not visible
      return requiresAllowed(def.requires, granted);
    };

    const allowAction = (actionId: string) => {
      const def = actionsIdx.get(actionId);
      if (!def) return false; // not declared → not allowed
      return requiresAllowed(def.requires, granted);
    };

    return {
      me,
      loading,
      error,
      reload,
      has,
      hasAll,
      hasAny,
      allowPage,
      allowAction,
      ev,
    };
  }, [me, loading, error, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
