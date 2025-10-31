// src/components/access/Acl.tsx
//
// Purpose
// -------
// Declarative, reusable UI gate for RBAC/ABAC decisions in KydoHub.
// It hides or shows its children based on:
//   • explicit permission codes (perm)
//   • page access defined in ui_resources (page)
//   • action access defined in ui_resources (action)
// The backend STILL enforces authz on every API; this is only a UX layer.
//
// How to use
// ----------
// 1) Gate by a single permission:
//      <Acl perm="students.create"><Button>Add Student</Button></Acl>
//
// 2) Gate by multiple permissions (mode="all" by default):
//      <Acl perm={["students.view", "attendance.view"]}>...</Acl>
//
// 3) Gate by page id from ui_resources.pages:
//      <Acl page="students"> ...students page link... </Acl>
//
// 4) Gate by action id from ui_resources.actions:
//      <Acl action="students.export"> ...Export button... </Acl>
//
// 5) Combine checks (all must pass):
//      <Acl page="students" action="students.create" perm="students.view">...</Acl>
//
// 6) Provide fallbacks:
//      <Acl perm="admin.only" fallback={<span>No access</span>}>...</Acl>
//      <Acl perm="admin.only" loadingFallback={<Spinner/>}>...</Acl>
//
// 7) Render-prop for advanced UI (receive allowed boolean):
//      <Acl perm="reports.view">
//        {(allowed) => allowed ? <Reports/> : <EmptyState/>}
//      </Acl>
//
// Notes for non-devs
// ------------------
// - Put stable ids into ui_resources.pages/actions in the DB.
// - The MeContext provider supplies allowPage/allowAction and permission set.
// - If /me/context is still loading, Acl shows nothing (or loadingFallback).

import React, { ReactNode } from "react";
import { useMe } from "@/context/MeContext";

type Mode = "all" | "any";

export type AclProps = {
  /** One code or a list of permission codes, e.g. "students.create" */
  perm?: string | string[];
  /** Page id from ui_resources.pages (e.g. "students") */
  page?: string;
  /** Action id from ui_resources.actions (e.g. "students.create") */
  action?: string;
  /** For multiple permissions: require "all" (default) or "any" */
  mode?: Mode;
  /** What to render while /me/context is loading (optional) */
  loadingFallback?: ReactNode | null;
  /** What to render if not allowed (defaults to null) */
  fallback?: ReactNode | null;
  /** Children or render-prop child that receives the final allowed boolean */
  children?: ReactNode | ((allowed: boolean) => ReactNode);
};

/**
 * Core access evaluation using MeContext helpers.
 * All provided checks (perm, page, action) must pass.
 */
function evaluateAccess(
  opts: { perm?: string | string[]; page?: string; action?: string; mode?: Mode },
  api: {
    has: (p: string) => boolean;
    hasAll: (ps: string[]) => boolean;
    hasAny: (ps: string[]) => boolean;
    allowPage: (id: string) => boolean;
    allowAction: (id: string) => boolean;
  }
): boolean {
  const { perm, page, action, mode = "all" } = opts;

  // 1) Permission codes
  if (typeof perm === "string") {
    if (!api.has(perm)) return false;
  } else if (Array.isArray(perm) && perm.length) {
    const ok = mode === "any" ? api.hasAny(perm) : api.hasAll(perm);
    if (!ok) return false;
  }

  // 2) Page gate
  if (page && !api.allowPage(page)) return false;

  // 3) Action gate
  if (action && !api.allowAction(action)) return false;

  return true;
}

/**
 * Acl component: conditionally renders children based on RBAC/ABAC rules.
 */
export function Acl({
  perm,
  page,
  action,
  mode = "all",
  loadingFallback = null,
  fallback = null,
  children,
}: AclProps) {
  const { loading, me, has, hasAll, hasAny, allowPage, allowAction } = useMe();

  if (loading) {
    return <>{loadingFallback}</>;
  }

  // If not authenticated, deny.
  if (!me) {
    return <>{fallback}</>;
  }

  const allowed = evaluateAccess(
    { perm, page, action, mode },
    { has, hasAll, hasAny, allowPage, allowAction }
  );

  if (typeof children === "function") {
    return <>{children(allowed)}</>;
  }

  return <>{allowed ? children : fallback}</>;
}

/**
 * Hook form for places where a boolean is easier than JSX composition.
 *
 * Example:
 *   const canCreate = useAllow({ action: "students.create" });
 *   return <Button disabled={!canCreate}>New</Button>;
 */
export function useAllow(opts: { perm?: string | string[]; page?: string; action?: string; mode?: Mode }) {
  const { loading, me, has, hasAll, hasAny, allowPage, allowAction } = useMe();
  if (loading || !me) return false;
  return evaluateAccess(opts, { has, hasAll, hasAny, allowPage, allowAction });
}

/**
 * Tiny helper for showing content only when allowed.
 *
 * Example:
 *   <AclWhen action="billing.view"><BillingWidget/></AclWhen>
 */
export function AclWhen(props: AclProps) {
  return (
    <Acl {...props} fallback={null}>
      {props.children}
    </Acl>
  );
}

export default Acl;
