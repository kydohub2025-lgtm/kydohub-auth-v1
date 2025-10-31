// src/components/acl/Acl.tsx
//
// Purpose
// -------
// A tiny, declarative gatekeeper for UI. It decides whether to render its children
// based on RBAC checks. You can:
//   • Gate by explicit permission strings via `requires`
//   • OR reference a server-defined page/action (from me.ui_resources) via `pageId` / `actionId`
//
// Default behavior is conservative and predictable:
//   • If `pageId` is provided, we check allowPage(me, pageId).
//   • Else if `actionId` is provided, we check allowAction(me, actionId).
//   • Else if `requires` is provided, we evaluate against the user’s permissions,
//     using `mode="all" | "any"` (default "all").
//   • If nothing is provided, we render nothing (fail-safe).
//
// Non-developer tip
// -----------------
// Use it like:
//
//   // Require specific permission(s)
//   <Acl requires={["students.create"]}><Button>New Student</Button></Acl>
//
//   // OR gate by a server-defined UI action
//   <Acl actionId="students.create"><Button>New Student</Button></Acl>
//
//   // OR gate an entire route/section by page id
//   <Acl pageId="students"><StudentsPage/></Acl>
//
// Dependencies
// ------------
// • Consumes MeContext (read-only) to access /me/context
// • Uses acl.ts helpers (allowPage, allowAction, requireAll/Any)
// • No network calls. Purely presentation logic.
//
// Notes
// -----
// • `fallback` renders if access is denied (default: null).
// • `as` lets you wrap children in a specific element if desired (e.g., <Acl as="span">).
// • This component only gates UI visibility; backend still enforces authorization.

import React, { PropsWithChildren } from "react";
import { useMe } from "../../context/MeContext"; // assumes you have a MeContext hook
import {
  ACL,
  allowPage,
  allowAction,
  requireAll,
  requireAny,
  type MeLike,
} from "../../lib/acl";

type Mode = "all" | "any";

export type AclProps = PropsWithChildren<{
  // Strategy 1: gate by a server-defined PAGE id (from me.ui_resources.pages)
  pageId?: string;

  // Strategy 2: gate by a server-defined ACTION id (from me.ui_resources.actions)
  actionId?: string;

  // Strategy 3: gate by explicit permission strings
  requires?: string[] | null;

  // When using `requires`, should we require all or any?
  mode?: Mode;

  // UI to render when access is denied
  fallback?: React.ReactNode;

  // Optional override for testing or edge wiring
  meOverride?: MeLike | null;

  // Wrap output in an element/tag if you want (<span>, <div>, etc.)
  as?: keyof JSX.IntrinsicElements;

  // When true, adds data attributes to help QA/debug (no visible text)
  debugAttrsOnly?: boolean;
}>;

export function Acl(props: AclProps) {
  const {
    pageId,
    actionId,
    requires,
    mode = "all",
    fallback = null,
    meOverride,
    as,
    debugAttrsOnly = false,
    children,
  } = props;

  const { me } = useMe(); // { me } from /me/context
  const ctx: MeLike | null | undefined = meOverride ?? me;

  const decision = decide(ctx, { pageId, actionId, requires, mode });

  // Optional wrapper tag
  const Wrapper = as ? as : React.Fragment;

  if (!decision.allowed) {
    // Render fallback with QA-friendly data attributes (no sensitive data)
    return (
      <Wrapper
        {...(debugAttrsOnly
          ? {
              "data-acl-denied": "true",
              "data-acl-reason": decision.reason ?? "unknown",
            }
          : {})}
      >
        {fallback}
      </Wrapper>
    );
  }

  return (
    <Wrapper
      {...(debugAttrsOnly
        ? {
            "data-acl-allowed": "true",
            "data-acl-mode": pageId
              ? "page"
              : actionId
              ? "action"
              : requires && requires.length
              ? mode
              : "none",
          }
        : {})}
    >
      {children}
    </Wrapper>
  );
}

function decide(
  me: MeLike | null | undefined,
  opts: { pageId?: string; actionId?: string; requires?: string[] | null; mode: Mode }
): { allowed: boolean; reason?: string } {
  if (!me) return { allowed: false, reason: "no-context" };

  // Highest-level checks first: page → action → explicit requires
  if (opts.pageId) {
    const ok = allowPage(me, opts.pageId);
    return ok ? { allowed: true } : { allowed: false, reason: "page-denied" };
  }

  if (opts.actionId) {
    const ok = allowAction(me, opts.actionId);
    return ok ? { allowed: true } : { allowed: false, reason: "action-denied" };
  }

  // Explicit requires
  if (opts.requires && opts.requires.length > 0) {
    const have = ACL.getEffectivePermissions(me);
    const ok = opts.mode === "any" ? requireAny(have, opts.requires) : requireAll(have, opts.requires);
    return ok ? { allowed: true } : { allowed: false, reason: "requires-denied" };
  }

  // Nothing to evaluate -> fail-safe hide
  return { allowed: false, reason: "no-rules" };
}

export default Acl;
