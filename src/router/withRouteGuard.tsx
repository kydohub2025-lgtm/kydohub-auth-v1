// src/lib/router/withRouteGuard.tsx
//
// Purpose
// -------
// Tiny helper to wrap React Router "element" nodes with our RBAC guard,
// so route configs stay clean and consistent.
//
// Why this exists
// ---------------
// Instead of repeating:
//   element: (
//     <RequirePerms anyOf={["students.view"]}>
//       <StudentsPage />
//     </RequirePerms>
//   )
//
// You can write:
//   element: guard(<StudentsPage />, { anyOf: ["students.view"] })
//
// It also supports lazy-loaded pages and a custom fallback.
//
// Folder & imports
// ----------------
// • Lives under src/lib/router to keep infra code centralized.
// • Uses RequirePerms from src/components/errors/RequirePerms.
//
// Usage
// -----
// import { guard, guardLazy } from "@/lib/router/withRouteGuard";
//
// const routes = [
//   {
//     path: "/students",
//     element: guard(<StudentsPage />, { anyOf: ["students.view"] }),
//   },
//   {
//     path: "/reports",
//     element: guardLazy(() => import("@/features/reports/pages/ReportsPage"), {
//       allOf: ["reports.view", "reports.list"],
//     }),
//   },
// ];
//
// Security
// --------
// • Fail-closed: if no permissions are provided or auth context is missing,
//   access is denied and a sanitized 403 is shown.
// • No client-side elevation: only reads computed `me.permissions` from /me/context.

import React, { Suspense } from "react";
import RequirePerms from "@/components/errors/RequirePerms";
import AccessDenied from "@/components/errors/AccessDenied";

export type GuardOptions = {
  allOf?: string[];
  anyOf?: string[];
  /** Optional custom fallback to render on deny */
  fallback?: React.ReactNode;
  /** Optional loading element while auth/page loads */
  loading?: React.ReactNode;
  /** Hide skeleton while loading auth context (default true shows a minimal one) */
  showWhileLoading?: boolean;
};

/**
 * Wrap a concrete element with the RBAC guard.
 * Example:
 *   element: guard(<DashboardPage />, { anyOf: ["dashboard.view"] })
 */
export function guard(
  element: React.ReactNode,
  opts: GuardOptions,
): React.ReactElement {
  const {
    allOf,
    anyOf,
    fallback,
    loading = defaultRouteLoader(),
    showWhileLoading = true,
  } = opts ?? {};

  // If no perms declared -> fail-closed with 403
  const hasRule = (allOf && allOf.length) || (anyOf && anyOf.length);
  if (!hasRule) {
    return (
      <AccessDenied
        title="Access rule missing"
        message="This route is not configured with required permissions."
      />
    );
  }

  return (
    <Suspense fallback={loading}>
      <RequirePerms
        allOf={allOf}
        anyOf={anyOf}
        fallback={fallback}
        showWhileLoading={showWhileLoading}
      >
        {element}
      </RequirePerms>
    </Suspense>
  );
}

/**
 * Guard a lazy-loaded page (code-split) with RBAC.
 * Example:
 *   element: guardLazy(() => import("@/features/staff/pages/StaffPage"), { anyOf: ["staff.view"] })
 */
export function guardLazy(
  lazyImport: () => Promise<{ default: React.ComponentType<any> }>,
  opts: GuardOptions,
): React.ReactElement {
  const LazyComp = React.lazy(lazyImport);
  return guard(<LazyComp />, opts);
}

/** Minimal, neutral route-level loader */
function defaultRouteLoader() {
  return (
    <div className="p-6 md:p-10">
      <div className="animate-pulse h-6 w-40 mb-4 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="animate-pulse h-40 rounded-2xl border bg-white/60 dark:bg-neutral-900/40" />
    </div>
  );
}

export default guard;
