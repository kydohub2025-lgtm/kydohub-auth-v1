/**
 * src/routes/ProtectedRoute.tsx
 * -----------------------------------------------------------------------------
 * Route guard for all protected screens.
 *
 * What it enforces
 *  - Requires a valid cookie-backed session (no localStorage tokens).
 *  - Calls GET /api/v1/me/context to verify auth + pull minimal UI state.
 *  - Redirects to /login?next=<current> on 401/403 or network errors.
 *
 * UX
 *  - Shows a lightweight full-page loader while checking.
 *  - Avoids duplicate checks via a short-lived in-memory cache.
 *
 * Security
 *  - Does not read or persist any tokens.
 *  - Relies on httpOnly cookies set by /auth/exchange.
 *
 * Notes
 *  - If you later add tenant switching (HTTP 209), handle it here by routing
 *    to /auth/switch. For now, we keep it out per your instruction.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiHttpError } from "../lib/http";

/** In-memory soft cache for the current page load. Resets on hard reload. */
let ME_CACHE:
  | { ts: number; ok: boolean; payload?: any }
  | null = null;

/** Cache TTL (ms). Keeps UI snappy while navigating between guarded routes. */
const CACHE_TTL = 5_000;

type Props = {
  children: React.ReactNode;
};

export const ProtectedRoute: React.FC<Props> = ({ children }) => {
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">(
    "checking"
  );
  const navigating = useRef(false);
  const nav = useNavigate();
  const loc = useLocation();

  const nextParam = useMemo(() => {
    const next = loc.pathname + (loc.search || "");
    return encodeURIComponent(next);
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    let mounted = true;
    const ctrl = new AbortController();

    const goLogin = (reason?: string) => {
      if (navigating.current) return;
      navigating.current = true;
      const suffix = reason ? `&reason=${encodeURIComponent(reason)}` : "";
      nav(`/login?next=${nextParam}${suffix}`, { replace: true });
    };

    const useCache = () => {
      if (!ME_CACHE) return false;
      const fresh = Date.now() - ME_CACHE.ts < CACHE_TTL;
      if (!fresh) return false;
      return ME_CACHE.ok;
    };

    const run = async () => {
      // Fast-path: soft cache
      if (useCache()) {
        if (!mounted) return;
        setStatus("allowed");
        return;
      }

      try {
        const payload = await api.get("/me/context", {
          signal: ctrl.signal as AbortSignal,
        });

        ME_CACHE = { ts: Date.now(), ok: true, payload };
        if (!mounted) return;
        setStatus("allowed");
      } catch (err) {
        const error = err as ApiHttpError;
        const statusCode = error?.status ?? 0;

        if (statusCode === 401 || statusCode === 403) {
          ME_CACHE = { ts: Date.now(), ok: false };
          if (!mounted) return;
          setStatus("denied");
          goLogin(statusCode === 401 ? "unauthorized" : "forbidden");
          return;
        }

        console.warn("me/context check failed:", err);
        ME_CACHE = { ts: Date.now(), ok: false };
        if (!mounted) return;
        setStatus("denied");
        goLogin("session_check_failed");
      }
    };

    run();

    return () => {
      mounted = false;
      ctrl.abort();
    };
  }, [nav, nextParam]);

  if (status === "checking") {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50">
        <div className="bg-white px-6 py-4 rounded-lg shadow-sm">
          <div className="animate-pulse text-gray-600">Checking session…</div>
        </div>
      </div>
    );
  }

  // If denied, we’re already navigating to /login.
  if (status === "denied") return null;

  // Allowed → render the protected tree.
  return <>{children}</>;
};

export default ProtectedRoute;
