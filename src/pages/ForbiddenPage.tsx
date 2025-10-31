// src/pages/ForbiddenPage.tsx
//
// Purpose
// -------
// A friendly 403 page shown when a user navigates to a route (page) they’re not
// allowed to access per RBAC. This is used by the route-guard we’ll add next.
// It provides guidance and safe navigation options.
//
// Non-developer tip
// -----------------
// • The router will render this page whenever `<Acl pageId="...">` denies access
//   at the route level.
// • You don’t need to call it directly; just wire the guard in routes.
//
// Security & UX
// -------------
// • No sensitive details are shown (only a generic “not allowed”).
// • Offers a “Go Home” button and (optionally) a Tenant Switcher hook point.

import * as React from "react";
import { Link } from "react-router-dom";

type ForbiddenPageProps = {
  /** Optional contextual note to show (kept generic; avoid exposing permission names). */
  note?: string;
  /** Optional React node to render additional actions (e.g., a TenantSwitcher). */
  extra?: React.ReactNode;
};

export default function ForbiddenPage({ note, extra }: ForbiddenPageProps) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-xl w-full text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 border border-red-200 mb-6">
          <span className="text-2xl" aria-hidden>
            🔒
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
          403 • You don’t have access to this page
        </h1>

        <p className="text-muted-foreground mb-6">
          If you believe this is a mistake, contact your administrator or switch to a different tenant.
          {note ? <span className="block mt-2">{note}</span> : null}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-accent transition"
          >
            ⟵ Go to Dashboard
          </Link>

          {/* Hook for optional tenant switcher / help link */}
          {extra ? (
            <div className="inline-flex">{extra}</div>
          ) : (
            <Link
              to="/help/access"
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
            >
              Get help with access
            </Link>
          )}
        </div>

        <div className="mt-8 text-xs text-muted-foreground">
          Request ID: <span className="font-mono">{safeRequestId()}</span>
        </div>
      </div>
    </div>
  );
}

// Creates a short, non-identifying UI request token to aid support without leaking data.
function safeRequestId() {
  try {
    // Try to reuse an existing correlation id if your app puts one on window.
    const fromGlobal = (window as any).__reqid as string | undefined;
    if (fromGlobal && typeof fromGlobal === "string") return fromGlobal.slice(0, 12);

    // Otherwise generate a short random token (not cryptographically strong; just a UI hint).
    return Math.random().toString(36).slice(2, 14);
  } catch {
    return "unknown";
  }
}
