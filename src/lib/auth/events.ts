// src/lib/auth/events.ts
//
// Purpose
// -------
// A tiny utility to publish/subscribe to authentication lifecycle events.
// Components like MeContext listen for `auth:refreshed` to reload /me/context,
// while pages can react to login/logout/tenant switch without tight coupling.
//
// When to emit
// ------------
// • After successful POST /auth/exchange  → authLoggedIn()
// • After successful POST /auth/refresh   → authRefreshed({ ev })
// • After successful POST /auth/logout    → authLoggedOut()
// • After successful POST /auth/switch    → authSwitchedTenant({ tenantId, ev })
//
// MeContext already listens for `auth:refreshed` and will refetch /me/context.
//
// Non-dev tip
// -----------
// Just import the convenience functions (e.g., authRefreshed()) in the places
// where you call the backend auth endpoints and invoke them on success.

export type AuthEventName =
  | "auth:login"
  | "auth:logout"
  | "auth:refreshed"
  | "auth:switch"
  | "auth:error";

export type AuthEventDetail = {
  /** Optional: new auth state version from server to help invalidate caches */
  ev?: number;
  /** Optional: active tenant after a switch */
  tenantId?: string;
  /** Optional: user id/email for logging or analytics */
  userId?: string;
  /** Optional: human-readable reason/context */
  reason?: string;
  /** Optional: arbitrary payload if you need to pass extra info */
  payload?: unknown;
};

type AuthEventHandler = (detail: AuthEventDetail) => void;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.dispatchEvent === "function";
}

function eventType(name: AuthEventName): string {
  return name;
}

/**
 * Low-level emitter.
 * Prefer the convenience wrappers below (authLoggedIn, authRefreshed, etc.).
 */
export function emitAuthEvent(name: AuthEventName, detail: AuthEventDetail = {}): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent<AuthEventDetail>(eventType(name), { detail }));
}

/**
 * Subscribe to a specific auth event.
 * Returns an unsubscribe function.
 */
export function onAuthEvent(name: AuthEventName, handler: AuthEventHandler): () => void {
  if (!isBrowser()) return () => {};
  const listener = (e: Event) => {
    const ce = e as CustomEvent<AuthEventDetail>;
    handler(ce.detail ?? {});
  };
  window.addEventListener(eventType(name), listener);
  return () => window.removeEventListener(eventType(name), listener);
}

// ------------------------------------------------------
// Convenience emitters (call these in your auth flows)
// ------------------------------------------------------

/** Call after successful /auth/exchange (login) */
export function authLoggedIn(detail: AuthEventDetail = {}): void {
  emitAuthEvent("auth:login", detail);
  // Also trigger refreshed so MeContext reloads immediately.
  emitAuthEvent("auth:refreshed", detail);
}

/** Call after successful /auth/refresh */
export function authRefreshed(detail: AuthEventDetail = {}): void {
  emitAuthEvent("auth:refreshed", detail);
}

/** Call after successful /auth/logout */
export function authLoggedOut(detail: AuthEventDetail = {}): void {
  emitAuthEvent("auth:logout", detail);
}

/** Call after successful /auth/switch (tenant change) */
export function authSwitchedTenant(detail: AuthEventDetail & { tenantId: string }): void {
  emitAuthEvent("auth:switch", detail);
  // Switch implies new context; notify listeners to reload.
  emitAuthEvent("auth:refreshed", detail);
}

/** Optional: publish auth error events for monitoring/UI */
export function authError(detail: AuthEventDetail & { reason: string }): void {
  emitAuthEvent("auth:error", detail);
}

// ------------------------------------------------------
// Optional helper: await a refresh (useful in flows)
// ------------------------------------------------------

/**
 * Promise that resolves on the next `auth:refreshed` (or timeout).
 * Handy when you want to ensure MeContext has reloaded before proceeding.
 */
export function waitForAuthRefreshed(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    const off = onAuthEvent("auth:refreshed", () => {
      off();
      resolve();
    });
    if (timeoutMs > 0) {
      setTimeout(() => {
        off();
        resolve();
      }, timeoutMs);
    }
  });
}
