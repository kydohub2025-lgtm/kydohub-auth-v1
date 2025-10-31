// src/lib/auth/actions.ts
//
// Purpose
// -------
// Thin, typed wrappers for KydoHub auth endpoints. These helpers centralize:
//   • Correct HTTP options (method, credentials, JSON handling)
//   • Emitting auth lifecycle events so the UI (MeContext, route guards) stays in sync
//   • Minimal response typing + consistent error shaping
//
// Security notes
// --------------
// - All calls are same-site cookie based (HttpOnly) per our CSRF/Session design.
// - We never store access/refresh tokens in JS. The server manages cookies.
// - The http client (src/lib/http.ts) MUST send credentials and handle JSON.
// - Backend still enforces authz; this layer only coordinates UI updates.
//
// Usage
// -----
//   import * as Auth from "@/lib/auth/actions";
//   await Auth.exchange();          // after Supabase (or IdP) login flow completes
//   await Auth.refresh();           // manual refresh (rare; http.ts does silent retries)
//   await Auth.logout();            // end current session
//   await Auth.switchTenant(tid);   // move to another tenant (if member)
//
// Each helper emits an event (see src/lib/auth/events.ts) so MeContext reloads /me/context.
//

import { http } from "@/lib/http";
import {
  authLoggedIn,
  authRefreshed,
  authLoggedOut,
  authSwitchedTenant,
  authError,
} from "@/lib/auth/events";

// ------------------------------------------------------
// Types (aligned with backend contracts)
// ------------------------------------------------------

export type ApiOk<T> = T & { ok?: true };
export type ApiErr = {
  ok?: false;
  error: {
    code: string;            // e.g., "PERMISSION_DENIED", "UNAUTHORIZED", "VALIDATION_ERROR"
    message: string;         // human-friendly message
    details?: unknown;       // extra payload if any
    requestId?: string;      // server request correlation id
  };
};

export type ExchangeRes = {
  ev?: number;              // auth state version (if returned by server)
  tenantId?: string;        // active tenant after exchange
};
export type RefreshRes = { ev?: number };
export type LogoutRes = { message?: string };
export type SwitchTenantRes = { ev?: number; tenantId: string };

// All endpoints are under the versioned API prefix.
const AUTH_BASE = "/api/v1/auth";

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

/**
 * Handle success and emit a specific event.
 * Keeps the UI consistent even across multiple tabs.
 */
function emitAfter<T extends { ev?: number }>(
  event: "login" | "refresh" | "logout" | "switch",
  data: T & { tenantId?: string }
) {
  const detail = { ev: data?.ev, tenantId: (data as any)?.tenantId };

  switch (event) {
    case "login":
      authLoggedIn(detail);
      break;
    case "refresh":
      authRefreshed(detail);
      break;
    case "logout":
      authLoggedOut(detail);
      break;
    case "switch":
      authSwitchedTenant(detail as { ev?: number; tenantId: string });
      break;
  }
}

/** Uniform error publisher */
function publishError(reason: string, payload?: unknown) {
  authError({ reason, payload });
}

/** Narrow a possibly-error response */
function isApiErr(x: any): x is ApiErr {
  return x && typeof x === "object" && "error" in x && typeof x.error?.code === "string";
}

// ------------------------------------------------------
// Actions
// ------------------------------------------------------

/**
 * POST /auth/exchange
 * Establish KydoHub session cookies after a successful IdP/Supabase login.
 * The server reads the IdP token (e.g., from Authorization or cookie) and
 * sets its own HttpOnly cookies; no tokens are stored in JS.
 *
 * @returns server payload (ev, tenantId) or throws ApiErr
 */
export async function exchange(body: Record<string, unknown> = {}): Promise<ApiOk<ExchangeRes>> {
  try {
    const res = await http.post(`${AUTH_BASE}/exchange`, body);
    if (isApiErr(res)) throw res;
    emitAfter("login", res as ExchangeRes);
    return { ...(res as ExchangeRes), ok: true };
  } catch (e: any) {
    publishError("exchange_failed", e);
    throw e;
  }
}

/**
 * POST /auth/refresh
 * Rotates the access token cookie(s). Usually automatic via http.ts 401 retry,
 * but exposed here for explicit flows (e.g., background refresh button, tests).
 */
export async function refresh(): Promise<ApiOk<RefreshRes>> {
  try {
    const res = await http.post(`${AUTH_BASE}/refresh`, {});
    if (isApiErr(res)) throw res;
    emitAfter("refresh", res as RefreshRes);
    return { ...(res as RefreshRes), ok: true };
  } catch (e: any) {
    publishError("refresh_failed", e);
    throw e;
  }
}

/**
 * POST /auth/logout
 * Ends the current session. If you need "logout all devices", pass { all: true }.
 */
export async function logout(opts: { all?: boolean } = {}): Promise<ApiOk<LogoutRes>> {
  try {
    const res = await http.post(`${AUTH_BASE}/logout`, { all: !!opts.all });
    if (isApiErr(res)) throw res;
    emitAfter("logout", res as LogoutRes);
    return { ...(res as LogoutRes), ok: true };
  } catch (e: any) {
    publishError("logout_failed", e);
    throw e;
  }
}

/**
 * POST /auth/switch
 * Activates another tenant membership for the current user.
 * Backend validates membership and sets the active-tenant cookie.
 */
export async function switchTenant(tenantId: string): Promise<ApiOk<SwitchTenantRes>> {
  try {
    const res = await http.post(`${AUTH_BASE}/switch`, { tenantId });
    if (isApiErr(res)) throw res;
    emitAfter("switch", res as SwitchTenantRes);
    return { ...(res as SwitchTenantRes), ok: true };
  } catch (e: any) {
    publishError("switch_tenant_failed", e);
    throw e;
  }
}
