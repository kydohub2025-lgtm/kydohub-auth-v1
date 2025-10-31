// src/components/errors/RequirePerms.tsx
//
// Purpose
// -------
// Route/page-level guard for RBAC. Renders children only if the current user
// has the required permission(s); otherwise shows <AccessDenied />.
//
// Why not just use <Acl/>?
// ------------------------
// <Acl/> is great for *component-level* gating inside a page.
// <RequirePerms/> is optimized for *page/route elements* so you don't have to
// wrap every page manually with repetitive logic.
//
// Usage (React Router)
// --------------------
// {
//   path: "/students",
//   element: (
//     <RequirePerms anyOf={["students.view"]}>
//       <StudentsPage />
//     </RequirePerms>
//   )
// }
//
// With AND logic:
//   <RequirePerms allOf={["students.view", "students.list"]}>
//     <StudentsPage />
//   </RequirePerms>
//
// With a custom fallback:
//   <RequirePerms anyOf={["reports.view"]} fallback={<My403 />}>
//     <ReportsPage />
//   </RequirePerms>
//
// Security notes
// --------------
// • We *only* read from /me/context via useAuth(); no client-side escalation.
// • Denials render a sanitized 403 component without leaking roles/attrs.
//
// Dependencies
// ------------
// • src/lib/auth.ts must export useAuth() with { me, loading, error, reload }.
// • AccessDenied.tsx in the same folder.

import React from "react";
import AccessDenied from "./AccessDenied";
import { useMe } from "@/context/MeContext";

type RequirePermsProps = {
  /** User must have *all* of these permissions (AND). */
  allOf?: string[];
  /** User must have *any* of these permissions (OR). */
  anyOf?: string[];
  /** Content to render when access is allowed. */
  children: React.ReactNode;
  /** Optional fallback to render when denied (default: <AccessDenied/>). */
  fallback?: React.ReactNode;
  /** Optional: show a minimal skeleton while context loads (default: true). */
  showWhileLoading?: boolean;
};

export function RequirePerms({
  allOf,
  anyOf,
  children,
  fallback,
  showWhileLoading = true,
}: RequirePermsProps) {
  // Read permissions from MeContext (populated via /me/context)
  const { me, loading, error } = useMe();

  // Loading state: keep UX smooth for route transitions.
  if (loading) {
    if (!showWhileLoading) return null;
    return (
      <div className="p-6 md:p-10">
        <div className="animate-pulse rounded-2xl border bg-white/60 dark:bg-neutral-900/40 h-40" />
      </div>
    );
  }

  // If auth errored out or there is no context, deny.
  if (error || !me) {
    return fallback ?? <AccessDenied title="Access unavailable" message="We couldn't verify your access. Please reload and try again." />;
  }

  const allowed = evaluate(me, { allOf, anyOf });
  if (!allowed) {
    return (
      (fallback as React.ReactElement) ?? (
        <AccessDenied
          required={[...(allOf ?? []), ...(anyOf ?? [])]}
          message="Your current role does not include the required permission(s) for this page."
          debugInfo={devDebug(me, { allOf, anyOf })}
        />
      )
    );
  }

  return <>{children}</>;
}

function evaluate(
  me: any,
  opts: { allOf?: string[]; anyOf?: string[] },
): boolean {
  // me.permissions is computed from backend (/me/context) using roles -> permissions mapping.
  const permset: Set<string> = new Set<string>(me?.permissions ?? []);

  if (opts.allOf && opts.allOf.length > 0) {
    for (const p of opts.allOf) {
      if (!permset.has(p)) return false;
    }
  }

  if (opts.anyOf && opts.anyOf.length > 0) {
    let ok = false;
    for (const p of opts.anyOf) {
      if (permset.has(p)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  // If neither allOf nor anyOf provided, default to deny (fail-closed).
  if ((!opts.allOf || opts.allOf.length === 0) && (!opts.anyOf || opts.anyOf.length === 0)) {
    return false;
  }

  return true;
}

function devDebug(me: any, req: { allOf?: string[]; anyOf?: string[] }) {
  if (import.meta.env.MODE !== "development") return undefined;
  return {
    requiredAll: req.allOf ?? [],
    requiredAny: req.anyOf ?? [],
    have: (me?.permissions ?? []).slice(0, 1000), // bounded for safety
    tenantId: me?.tenant?.tenantId ?? me?.active?.tenantId ?? me?.activeTenant?.tenantId,
    roles: me?.roles ?? me?.membership?.roles ?? [],
  };
}

export default RequirePerms;
