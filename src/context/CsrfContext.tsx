// src/context/CsrfContext.tsx
//
// Purpose
// -------
// Centralizes a CSRF token for same-site cookie flows where the server expects
// an anti-CSRF header (e.g., "X-CSRF-Token") on state-changing requests.
// This context keeps the token refreshed and synchronized with auth lifecycle
// events (login, refresh, tenant switch, logout).
//
// What it does
// ------------
// • Exposes the current token via React context: { token, loading, reload() }.
// • Attempts to prime from /me/context.meta.csrf if MeContext has it.
// • Falls back to GET /api/v1/common/csrf (lightweight endpoint) if needed.
// • Subscribes to auth events (auth:login, auth:refreshed, auth:switch, auth:logout):
//     - On login/refresh/switch → reload CSRF
//     - On logout → clear token
// • Leaves actual header attachment to http.ts (already sends X-CSRF-Token if provided).
//
// Security notes
// --------------
// - We do NOT store refresh/access tokens here; only an anti-CSRF nonce.
// - Token lives in memory; if the page reloads, it’s re-fetched.
// - If your backend rotates CSRF on each refresh/exchange, this ensures the UI keeps up.
//
// Non-developer tip
// -----------------
// You rarely interact with this directly. Just wrap <CsrfProvider> near the top
// of your app (e.g., in main.tsx or App.tsx), and http.ts will read it via
// the exported `getCurrentCsrf()` helper.
//

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { http } from "@/lib/http";
import { onAuthEvent } from "@/lib/auth/events";
import { useMe } from "@/context/MeContext";

type CsrfState = {
  token: string | null;
  loading: boolean;
  /** Manually refetch (rarely needed) */
  reload: () => Promise<void>;
  /** Set token from outside if you already have it (e.g., after /me/context) */
  set: (t: string | null) => void;
};

const CsrfContext = createContext<CsrfState | null>(null);

// Internal module-level ref so http.ts can read current token without re-renders.
let CURRENT_CSRF: string | null = null;

/** Used by http.ts to attach the header without importing React hooks */
export function getCurrentCsrf(): string | null {
  return CURRENT_CSRF;
}

async function fetchCsrfFromApi(): Promise<string | null> {
  try {
    // Server returns something like: { token: "..." } or { csrf: "..." }
    const res = await http.get("/api/v1/common/csrf");
    const token = (res?.token ?? res?.csrf ?? null) as string | null;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export const CsrfProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const meApi = useMe();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bootstrapped = useRef(false);

  const apply = useCallback((t: string | null) => {
    CURRENT_CSRF = t;
    setToken(t);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Prefer MeContext meta if present (some backends send CSRF in /me/context)
      const fromMe = (meApi.me as any)?.meta?.csrf ?? null;
      if (typeof fromMe === "string" && fromMe.length > 0) {
        apply(fromMe);
        return;
      }
      // Fallback to a lightweight endpoint
      const t = await fetchCsrfFromApi();
      apply(t);
    } finally {
      setLoading(false);
    }
  }, [apply, meApi.me]);

  const set = useCallback(
    (t: string | null) => {
      apply(t);
    },
    [apply]
  );

  // Bootstrap once after MeContext finishes initial load.
  useEffect(() => {
    if (bootstrapped.current) return;
    if (meApi.loading) return;
    bootstrapped.current = true;
    // If logged in, prime CSRF; if not, ensure it's cleared.
    if (meApi.me) {
      void reload();
    } else {
      apply(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meApi.loading, meApi.me]);

  // Listen to auth events to keep CSRF fresh.
  useEffect(() => {
    const offLogin = onAuthEvent("auth:login", () => void reload());
    const offRefresh = onAuthEvent("auth:refreshed", () => void reload());
    const offSwitch = onAuthEvent("auth:switch", () => void reload());
    const offLogout = onAuthEvent("auth:logout", () => apply(null));
    return () => {
      offLogin();
      offRefresh();
      offSwitch();
      offLogout();
    };
  }, [reload, apply]);

  const value: CsrfState = { token, loading, reload, set };

  return <CsrfContext.Provider value={value}>{children}</CsrfContext.Provider>;
};

export function useCsrf(): CsrfState {
  const ctx = useContext(CsrfContext);
  if (!ctx) {
    throw new Error("useCsrf must be used within a CsrfProvider");
  }
  return ctx;
}
