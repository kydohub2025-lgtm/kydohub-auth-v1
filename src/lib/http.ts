// src/lib/fetch/http.ts
//
// Purpose
// -------
// A single, safe HTTP entry point for the frontend. It centralizes:
//   • Base URL handling (VITE_API_BASE)
//   • Credentials (cookies) & headers
//   • CSRF header injection for unsafe methods
//   • Typed JSON parsing + neutral error mapping
//   • EV/Token refresh flow (401 with EV_* codes) + single-flight refresh
//   • One automatic retry of the original request after a successful refresh
//   • Request ID extraction for better debugging
//
// Security Notes
// --------------
// - Cookies (access/refresh) are HttpOnly; this module never reads or writes them.
// - We only read the CSRF cookie value (via ./csrf) to send X-CSRF on unsafe methods.
// - We do not cache auth in localStorage/sessionStorage.
//
// Integration Points
// ------------------
// - Backend endpoints used here: POST /auth/refresh
// - After a successful refresh, we dispatch a window event 'auth:refreshed'
//   so MeContextProvider can refetch /me/context (it can listen for this).
//
// Usage
// -----
// import { api } from "./http";
// const data = await api.get<MyDto>("/me/context");
// const created = await api.post<MyThing>("/things", { name: "A" });
// const updated = await api.put<MyThing>(`/things/${id}`, payload);
//
// Error Handling
// --------------
// - Non-2xx responses throw an ApiHttpError (status, code, message, requestId, details).
// - 401 with EV_OUTDATED/EV_EXPIRED triggers a refresh (single-flight), then retries once.
// - If refresh fails or second attempt still fails, the error is thrown to the caller.
//
// Observability
// -------------
// - Console.debug lines are gated to help trace flows in dev without leaking PII.
//

import { csrfHeaderFor } from "./csrf";
// No external imports for error helpers—keep this file self-sufficient.

// -------------------------------
// Types & Error class
// -------------------------------

export interface ApiErrorPayload {
  code?: string;         // e.g., "EV_OUTDATED", "PERMISSION_DENIED", etc.
  message?: string;      // safe, neutral message
  details?: unknown;     // optional structured info
}

export class ApiHttpError extends Error {
  public status: number;
  public code?: string;
  public details?: unknown;
  public requestId?: string;

  constructor(
    status: number,
    code?: string,
    message?: string,
    details?: unknown,
    requestId?: string
  ) {
    super(message || `Request failed with status ${status}`);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

// -------------------------------
// Configuration
// -------------------------------

const API_BASE =
  (import.meta as any)?.env?.VITE_API_BASE?.toString().replace(/\/+$/, "") ||
  "/api/v1";

const EV_CODES = new Set(["EV_OUTDATED", "EV_EXPIRED"]);
const JSON_CT = "application/json";

// -------------------------------
// Single-flight refresh control
// -------------------------------

let refreshPromise: Promise<void> | null = null;

/**
 * ensureRefresh()
 * Runs a single POST /auth/refresh across concurrent 401(EV) reactions.
 * If a refresh is already in progress, returns that same promise.
 * Resolves on 2xx, rejects on any failure.
 */
async function ensureRefresh(): Promise<void> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const url = buildUrl("/auth/refresh");
    try {
      // No body; backend rotates cookies and returns neutral envelope.
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: JSON_CT,
          // Refresh is "unsafe" → include CSRF header as well
          ...csrfHeaderFor("POST"),
        },
      });

      if (!res.ok) {
        const { code, message, details } = await safeParseError(res);
        throw new ApiHttpError(res.status, code, message, details, reqId(res));
      }

      // Notify the app shell that auth state (EV/cookies) has been updated.
      // MeContextProvider can listen and refetch /me/context.
      window.dispatchEvent(new CustomEvent("auth:refreshed"));
      console.debug?.("[http] refresh OK");
    } finally {
      // Always clear so future refreshes can occur.
      const p = refreshPromise;
      refreshPromise = null;
      // Avoid unhandled rejection warning if the caller ignores a rejected promise.
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      p?.catch(() => {});
    }
  })();

  return refreshPromise;
}

// -------------------------------
// Core request with EV-aware retry
// -------------------------------

type UnsafeMethod = "POST" | "PUT" | "PATCH" | "DELETE";
const unsafeMethods = new Set<UnsafeMethod>(["POST", "PUT", "PATCH", "DELETE"]);

export interface RequestOptions extends RequestInit {
  /**
   * If true, force-inject CSRF header even on safe methods.
   * Defaults to: for unsafe methods only.
   */
  requireCsrf?: boolean;

  /**
   * If true, do NOT attempt an EV-based refresh/retry.
   * Defaults to false (allow one automatic retry).
   */
  noAutoRefresh?: boolean;

  /**
   * Internal flag to avoid infinite recursion.
   */
  __retry?: boolean;
}

/**
 * request<T>()
 * The single path that all api.* helpers call.
 */
export async function request<T = unknown>(
  input: string | URL | Request,
  options: RequestOptions = {}
): Promise<T> {
  const url = buildUrl(input);
  const method = (options.method || "GET").toUpperCase();
  const isUnsafe = unsafeMethods.has(method as UnsafeMethod);

  const headers = new Headers(options.headers || {});
  headers.set("Accept", JSON_CT);

  const isJsonBody =
    options.body &&
    typeof options.body === "object" &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof Blob) &&
    !(options.body instanceof ArrayBuffer);

  if (isJsonBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", JSON_CT);
  }

  // CSRF header injection
  const needCsrf = options.requireCsrf || isUnsafe;
  if (needCsrf) {
    const csrfHeader = csrfHeaderFor(method);
    for (const [k, v] of Object.entries(csrfHeader)) {
      headers.set(k, v);
    }
  }

  const init: RequestInit = {
    ...options,
    method,
    headers,
    credentials: "include", // send cookies for same-origin/backend domain
  };

  // If body is a plain object and Content-Type is JSON, stringify it.
  if (isJsonBody && headers.get("Content-Type") === JSON_CT) {
    init.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, init);

  // Fast path: 2xx success
  if (res.ok) {
    return (await parseJsonOrVoid<T>(res)) as T;
  }

  // Non-OK: check if this is an EV_OUTDATED/EV_EXPIRED 401 case
  const { code, message, details } = await safeParseError(res);

  if (
    res.status === 401 &&
    EV_CODES.has((code || "").toUpperCase()) &&
    !options.noAutoRefresh &&
    !options.__retry
  ) {
    console.debug?.("[http] 401 EV detected → ensureRefresh → retry once");
    try {
      await ensureRefresh();
      // Retry original request ONCE with __retry flag set
      return await request<T>(input, { ...options, __retry: true });
    } catch (e) {
      // Refresh failed → bubble original error context
      throw new ApiHttpError(res.status, code, message, details, reqId(res));
    }
  }

  // Any other error → throw typed error
  throw new ApiHttpError(res.status, code, message, details, reqId(res));
}

// -------------------------------
// Backward-compatible fetch-style helpers
// -------------------------------

/**
 * fetchJson()
 * Thin wrapper around window.fetch that applies our defaults:
 *  - Base URL prefixing
 *  - credentials: 'include'
 *  - Accept: application/json
 *  - Content-Type for JSON bodies
 *  - CSRF header for unsafe methods
 * Returns the raw Response for call sites that inspect status/ok and parse later.
 */
export async function fetchJson(
  input: string | URL | Request,
  init: RequestInit = {}
): Promise<Response> {
  const url = buildUrl(input as any);

  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  headers.set("Accept", JSON_CT);

  const body = (init as any).body;
  const isJsonBody =
    body &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer);

  if (isJsonBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", JSON_CT);
  } else if (typeof body === "string" && !headers.has("Content-Type")) {
    // Most callers pass JSON.stringify; set JSON content-type by default.
    headers.set("Content-Type", JSON_CT);
  }

  // CSRF for unsafe methods
  const csrfHeader = csrfHeaderFor(method);
  for (const [k, v] of Object.entries(csrfHeader)) headers.set(k, v);

  const res = await fetch(url, { ...init, method, headers, credentials: "include" });
  return res;
}

/**
 * postJson()
 * Convenience wrapper to POST a JSON payload and return the raw Response.
 */
export async function postJson(
  input: string | URL | Request,
  body?: unknown,
  init?: Omit<RequestInit, "method" | "body">
): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", JSON_CT);
  return fetchJson(input, {
    ...(init || {}),
    method: "POST",
    headers,
    body: body instanceof Blob || body instanceof FormData ? (body as any) : JSON.stringify(body ?? {}),
  });
}

// -------------------------------
// Public API helpers
// -------------------------------

export const api = {
  get<T = unknown>(path: string, opts?: Omit<RequestOptions, "method">) {
    return request<T>(path, { ...opts, method: "GET" });
  },
  post<T = unknown>(
    path: string,
    body?: unknown,
    opts?: Omit<RequestOptions, "method" | "body">
  ) {
    return request<T>(path, { ...opts, method: "POST", body });
  },
  put<T = unknown>(
    path: string,
    body?: unknown,
    opts?: Omit<RequestOptions, "method" | "body">
  ) {
    return request<T>(path, { ...opts, method: "PUT", body });
  },
  patch<T = unknown>(
    path: string,
    body?: unknown,
    opts?: Omit<RequestOptions, "method" | "body">
  ) {
    return request<T>(path, { ...opts, method: "PATCH", body });
  },
  del<T = unknown>(
    path: string,
    opts?: Omit<RequestOptions, "method">
  ) {
    return request<T>(path, { ...opts, method: "DELETE" });
  },
};

// Backwards-compatible alias used across the codebase
export const http = api;

// -------------------------------
// Helpers
// -------------------------------

function buildUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    // If it's an absolute URL (http/https), return as-is.
    if (/^https?:\/\//i.test(input)) return input;
    // Avoid double prefix if caller already included API base
    const baseNoSlash = API_BASE.replace(/\/+$/, "");
    const baseWithSlash = baseNoSlash.startsWith("/") ? baseNoSlash : `/${baseNoSlash}`;
    if (input.startsWith(baseNoSlash + "/") || input.startsWith(baseWithSlash + "/")) {
      return input;
    }
    // Also treat /api/* as already absolute to backend
    if (input.startsWith("/api/")) return input;
    // If it's a root-relative path, prefix with API_BASE.
    if (input.startsWith("/")) return `${API_BASE}${input}`;
    // Otherwise treat as relative to API_BASE
    return `${API_BASE}/${input}`;
  }
  if (input instanceof URL) return input.toString();
  // Request object: keep its URL, but if it's relative, prefix API_BASE.
  const href = (input as Request).url || "";
  if (/^https?:\/\//i.test(href)) return href;
  const baseNoSlash = API_BASE.replace(/\/+$/, "");
  const baseWithSlash = baseNoSlash.startsWith("/") ? baseNoSlash : `/${baseNoSlash}`;
  if (href.startsWith(baseNoSlash + "/") || href.startsWith(baseWithSlash + "/")) {
    return href;
  }
  if (href.startsWith("/api/")) return href;
  if (href.startsWith("/")) return `${API_BASE}${href}`;
  return `${API_BASE}/${href}`;
}

/**
 * parseJsonOrVoid()
 * Safely parse JSON for 204/empty bodies.
 */
async function parseJsonOrVoid<T>(res: Response): Promise<T | void> {
  if (res.status === 204) return;
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    // If server returned non-JSON, just return void to avoid runtime errors.
    return;
  }
  try {
    return (await res.json()) as T;
  } catch {
    // Malformed JSON → treat as void for safety.
    return;
  }
}

/**
 * safeParseError()
 * Attempts to read { code, message, details } from an error response.
 * Returns a normalized payload even if the body is not JSON.
 */
async function safeParseError(res: Response): Promise<ApiErrorPayload> {
  const fallback: ApiErrorPayload = {
    code: undefined,
    message: `HTTP ${res.status}`,
    details: undefined,
  };

  const ct = res.headers.get("Content-Type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return fallback;
  }

  try {
    const data = await res.json();
    // Flexible mapping to our envelope shape
    // Accept common shapes:
    //   { code, message, details }
    //   { error: { code, message, details } }
    //   { err: { code, message, details } }
    if (data?.code || data?.message) {
      return {
        code: data.code,
        message: data.message,
        details: data.details,
      };
    }
    if (data?.error?.code || data?.error?.message) {
      return {
        code: data.error.code,
        message: data.error.message,
        details: data.error.details,
      };
    }
    if (data?.err?.code || data?.err?.message) {
      return {
        code: data.err.code,
        message: data.err.message,
        details: data.err.details,
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * reqId()
 * Extract request ID header (for correlating with backend logs).
 */
function reqId(res: Response): string | undefined {
  return (
    res.headers.get("x-request-id") ||
    res.headers.get("x-amzn-trace-id") ||
    undefined
  );
}
