// src/routes/guards/RequireAuth.tsx
//
// Purpose
// -------
// Route-level guard for KydoHub using React Router v6.
// Ensures the user is authenticated and authorized *before* rendering a page.
// Works with RBAC permissions (perm) and ui_resources gates (page/action).
//
// What it does
// ------------
// 1) If /me/context is still loading → render a lightweight spinner (customizable).
// 2) If not authenticated → redirect to /login with a returnTo parameter.
// 3) If authenticated but not authorized for the requested page/action/perm → render 403.
// 4) Otherwise, render the protected children.
//
// Where it fits
// -------------
// - Uses MeContext (src/context/MeContext.tsx) for auth state and checks.
// - Complements the <Acl> component, but at the *route* level.
// - Backend remains the source of truth; this is a UX layer only.
//
// Typical usage
// -------------
// In your route config (e.g., src/routes.tsx):
//
//   import { RequireAuth } from "@/routes/guards/RequireAuth";
//
//   <Route
//     path="/students"
//     element={
//       <RequireAuth page="students">
//         <StudentsPage/>
//       </RequireAuth>
//     }
//   />
//
//   // Gate by action too (e.g., admin-only page)
//   <Route
//     path="/admin/users"
//     element={
//       <RequireAuth perm="admin.users.view">
//         <AdminUsersPage/>
//       </RequireAuth>
//     }
//   />
//
// Notes for non-devs
// ------------------
// - page/action ids must exist in ui_resources for the tenant.
// - If you only need to hide a button inside a page, use <Acl>. If you must
//   prevent entering a route entirely, use <RequireAuth> here.
//
// Security/UX details
// -------------------
// - On 401 (not logged in), users are redirected to /login?returnTo=<current-path>.
// - On 403 (no permission), we show a compact, brand-safe 403 component.
// - Spinner and 403 renderers are overridable via props.

import React, { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useMe } from "@/context/MeContext";

type Mode = "all" | "any";

export type RequireAuthProps = {
  /** One permission code or a list (e.g., "students.view") */
  perm?: string | string[];
  /** Page id from ui_resources.pages (e.g., "students") */
  page?: string;
  /** Action id from ui_resources.actions (e.g., "students.create") */
  action?: string;
  /** For multiple permissions: require "all" (default) or "any" */
  mode?: Mode;
  /** Override loading UI while /me/context fetches */
  renderLoading?: () => ReactNode;
  /** Override 403 UI when authenticated but not authorized */
  renderForbidden?: () => ReactNode;
  /** Protected content (usually a page component) */
  children: ReactNode;
  /** Login path; default: "/login" */
  loginPath?: string;
};

/** Default tiny loading indicator (replace if you have a global spinner) */
function DefaultLoading() {
  return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <div style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⏳</div>
      <div style={{ marginTop: 8 }}>Loading…</div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/** Default 403 page */
function DefaultForbidden() {
  return (
    <div style={{ padding: 32, maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>403 — Not authorized</h1>
      <p style={{ color: "#555" }}>
        You’re signed in, but you don’t have access to this page. If you think this is a mistake,
        please contact your administrator.
      </p>
    </div>
  );
}

/** Internal evaluator mirrors the logic in the <Acl> component. */
function isAllowed(
  opts: { perm?: string | string[]; page?: string; action?: string; mode?: Mode },
  api: ReturnType<typeof useMe>
): boolean {
  const { perm, page, action, mode = "all" } = opts;
  // Permissions
  if (typeof perm === "string") {
    if (!api.has(perm)) return false;
  } else if (Array.isArray(perm) && perm.length) {
    const ok = mode === "any" ? api.hasAny(perm) : api.hasAll(perm);
    if (!ok) return false;
  }
  // Page
  if (page && !api.allowPage(page)) return false;
  // Action
  if (action && !api.allowAction(action)) return false;

  return true;
}

/**
 * RequireAuth
 * -----------
 * Wrap a route element to require authentication + authorization.
 */
export function RequireAuth({
  perm,
  page,
  action,
  mode = "all",
  renderLoading,
  renderForbidden,
  children,
  loginPath = "/login",
}: RequireAuthProps) {
  const meApi = useMe();
  const location = useLocation();

  // 1) Loading
  if (meApi.loading) {
    return <>{renderLoading ? renderLoading() : <DefaultLoading />}</>;
  }

  // 2) Not authenticated → redirect to login with returnTo
  if (!meApi.me) {
    const returnTo = encodeURIComponent(location.pathname + location.search + location.hash);
    return <Navigate to={`${loginPath}?returnTo=${returnTo}`} replace />;
  }

  // 3) Authenticated but not authorized → 403
  const allowed = isAllowed({ perm, page, action, mode }, meApi);
  if (!allowed) {
    return <>{renderForbidden ? renderForbidden() : <DefaultForbidden />}</>;
  }

  // 4) Authorized → render the protected element
  return <>{children}</>;
}

export default RequireAuth;
