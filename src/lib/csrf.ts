// src/lib/csrf.ts
/**
 * CSRF utilities for KydoHub web clients.
 *
 * Why this exists
 * ---------------
 * Your backend enforces CSRF for state-changing requests (POST/PUT/PATCH/DELETE)
 * when browser cookies are present. It uses "double submit" protection:
 *   - A readable cookie:  kydo_csrf
 *   - A request header:   X-CSRF
 * The server rejects the request unless header value === cookie value, and it
 * also checks Origin/Referer on the server side.
 *
 * What this file does
 * -------------------
 * - Reads the kydo_csrf cookie safely.
 * - Adds the X-CSRF header for "unsafe" HTTP methods.
 * - Exposes helpers you can compose inside your fetch wrapper.
 *
 * Security notes
 * --------------
 * - Only attach the CSRF header for state-changing methods. It’s not needed for GET.
 * - If the cookie is absent (e.g., not signed in yet), we simply skip the header.
 * - The CSRF cookie must be NON HttpOnly (so JS can read it). Your backend already
 *   sets the session/refresh cookies as HttpOnly and a separate readable CSRF cookie.
 */

export const CSRF_COOKIE = "kydo_csrf";
export const CSRF_HEADER = "X-CSRF";

// Methods that must carry the CSRF header when cookies are used.
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns true if the given HTTP method is "unsafe" (state-changing).
 */
export function isUnsafeMethod(method?: string): boolean {
  if (!method) return false;
  return UNSAFE_METHODS.has(method.toUpperCase());
}

/**
 * Read a cookie value by name from document.cookie.
 * Returns null if not present or if running outside the browser.
 */
export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const c of cookies) {
    const [k, ...v] = c.split("=");
    if (decodeURIComponent(k) === name) {
      return decodeURIComponent(v.join("="));
    }
  }
  return null;
}

/**
 * Get the current CSRF token from the kydo_csrf cookie.
 * Returns null if not present.
 */
export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE);
}

/**
 * Build the CSRF header object if needed for this request.
 * - Only produced for unsafe methods.
 * - Skips if no kydo_csrf cookie is available.
 */
export function buildCsrfHeader(method?: string): Record<string, string> {
  if (!isUnsafeMethod(method)) return {};
  const token = getCsrfToken();
  if (!token) return {};
  return { [CSRF_HEADER]: token };
}

/**
 * Merge CSRF header into an existing RequestInit, if needed.
 * Safe to call for any request; it only adds header for unsafe methods and
 * when a kydo_csrf cookie is present.
 */
export function withCsrf(init: RequestInit = {}): RequestInit {
  const method = (init.method || "GET").toUpperCase();
  const csrfHeader = buildCsrfHeader(method);

  if (!Object.keys(csrfHeader).length) return init;

  const nextHeaders = new Headers(init.headers || {});
  // Do not overwrite if already provided explicitly
  if (!nextHeaders.has(CSRF_HEADER)) {
    nextHeaders.set(CSRF_HEADER, csrfHeader[CSRF_HEADER]);
  }

  return { ...init, headers: nextHeaders };
}

/**
 * Convenience helper to produce headers object you can spread into a request.
 * Useful if you’re composing headers manually elsewhere:
 *
 *   const headers = {
 *     "Content-Type": "application/json",
 *     ...csrfHeaderFor("POST"),
 *   };
 */
export function csrfHeaderFor(method?: string): Record<string, string> {
  return buildCsrfHeader(method);
}

/**
 * Tiny guard you can call before making a critical state-changing call.
 * If it returns false, you probably need to exchange/login first to receive
 * the CSRF cookie from the backend (e.g., after /auth/exchange).
 */
export function hasCsrfCookie(): boolean {
  return getCsrfToken() != null;
}

/**
 * Example usage (with the http.ts wrapper you already added):
 *
 *   import { http } from "@/lib/http";
 *   // POST with CSRF header auto-attached:
 *   await http("/api/v1/students", { method: "POST", body: { name: "Ava" } });
 *
 * If you build a fetch manually:
 *
 *   const res = await fetch("/api/v1/students", {
 *     method: "POST",
 *     headers: {
 *       "Content-Type": "application/json",
 *       ...csrfHeaderFor("POST"),
 *     },
 *     body: JSON.stringify({ name: "Ava" }),
 *     credentials: "include",
 *   });
 */
