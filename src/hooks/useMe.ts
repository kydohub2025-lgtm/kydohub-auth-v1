/**
 * src/hooks/useMe.ts
 * -----------------------------------------------------------------------------
 * Purpose
 *  - Fetch and expose the authenticated user's context from the backend
 *    (GET /api/v1/me/context), with a small in-memory cache and helpers.
 *  - Central place for pages/nav/components to read: user, tenant, roles,
 *    permissions, ui_resources (pages/actions), and meta.ev for versioning.
 *
 * Security
 *  - No tokens are handled here. Auth is cookie-backed (httpOnly) per backend.
 *  - On 401/403 the caller should typically redirect (e.g., via ProtectedRoute).
 *
 * Caching
 *  - Very short-lived in-memory cache to reduce duplicate fetches across
 *    components during a single navigation flow. Hard refresh clears it.
 *
 * Usage
 *  const { me, loading, error, refresh, can } = useMe();
 *  if (loading) return <Spinner/>;
 *  if (me && can("students.create")) { ... }
 *
 * Notes
 *  - We don't shape the contract; we pass through what backend returns.
 *  - `can()` checks a simple flat permission list if present (permset/permissions).
 *  - If you later add a global state (e.g., Zustand), this hook can delegate there.
 * -----------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/http";

// ---- Types (loose to accommodate backend evolution) -------------------------

export type UIPermissionId = string;

export type UIPage = {
  id: string;
  requires?: UIPermissionId[] | null;
};

export type UIAction = {
  id: string;
  requires?: UIPermissionId[] | null;
};

export type MeContext = {
  user?: { id: string; email?: string; name?: string } | null;
  tenantId?: string | null;
  roles?: string[] | null;
  // If backend pre-computes a permission set, expose it:
  permset?: { list?: UIPermissionId[]; map?: Record<string, true> } | null;

  // If backend returns RBAC/ABAC inputs for client gating:
  ui_resources?: {
    pages?: UIPage[];
    actions?: UIAction[];
  } | null;

  // Optional meta with event/version number for cache-busting
  meta?: { ev?: number; [k: string]: unknown } | null;

  // Anything else from backend:
  [k: string]: unknown;
};

// ---- Tiny in-memory cache ---------------------------------------------------

type CacheEntry = { ts: number; data: MeContext | null };
let ME_CACHE: CacheEntry | null = null;

// Keep this short to avoid stale UI when roles change server-side.
const CACHE_TTL_MS = 5_000;

// ---- Public helpers ---------------------------------------------------------

export function clearMeCache() {
  ME_CACHE = null;
}

export function setMeCache(me: MeContext | null) {
  ME_CACHE = { ts: Date.now(), data: me };
}

// ---- Hook -------------------------------------------------------------------

export function useMe(opts?: { force?: boolean }) {
  const force = opts?.force === true;
  const [me, setMe] = useState<MeContext | null>(() => {
    if (force || !ME_CACHE) return null;
    const fresh = Date.now() - ME_CACHE.ts < CACHE_TTL_MS;
    return fresh ? ME_CACHE.data ?? null : null;
  });
  const [loading, setLoading] = useState<boolean>(me == null);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Derived permission checker (flat list or map if provided by backend)
  const can = useMemo(() => {
    const ids: string[] =
      (me?.permset?.list as string[]) ||
      (me?.permset && Object.keys(me.permset.map || {})) ||
      [];
    const table = new Set(ids);
    return (permId: string) => table.has(permId);
  }, [me]);

  // Fetcher
  const fetchMe = async (signal?: AbortSignal) => {
    const payload = await api.get<MeContext>("/me/context", {
      signal: signal as any,
    });
    return payload;
  };

  // Initial load
  useEffect(() => {
    // Serve from cache when possible unless forced
    if (!force && ME_CACHE && Date.now() - ME_CACHE.ts < CACHE_TTL_MS) {
      setMe(ME_CACHE.data ?? null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    fetchMe(ctrl.signal)
      .then((payload) => {
        setMeCache(payload);
        setMe(payload);
      })
      .catch((e) => {
        clearMeCache();
        setError(e instanceof Error ? e : new Error(String(e)));
        setMe(null);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      ctrl.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [force]);

  // Manual refresh (ignores cache)
  const refresh = async () => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {}
    }
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const payload = await fetchMe(ctrl.signal);
      setMeCache(payload);
      setMe(payload);
      return payload;
    } catch (e) {
      clearMeCache();
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      setMe(null);
      throw err;
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  return { me, loading, error, refresh, can };
}

export default useMe;
