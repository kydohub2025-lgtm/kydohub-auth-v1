// src/routes/guards/RequirePageAccess.tsx
//
// Purpose
// -------
// Route-level RBAC guard. Wrap any page element to enforce access based on
// server-defined page ids (from me.ui_resources.pages) or explicit permissions.
// If access is denied, it either renders the 403 screen inline or navigates to /403.
//
// Typical usage (React Router v6):
// --------------------------------
// <Route
//   path="/staff"
//   element={
//     <RequirePageAccess pageId="staff">
//       <StaffPage />
//     </RequirePageAccess>
//   }
// />
//
// Notes
// -----
// • This is the "page gate." For buttons/controls, use <IfAction/>.
// • Backend still enforces auth; this is a UX layer only.
// • To use explicit permissions instead of a pageId, pass `requires` and optional `mode`.
// • If `redirectTo` is provided, we Navigate there on deny; otherwise we render <ForbiddenPage/>.
//
// Security
// --------
// • Doesn’t expose permission names to end users. Keeps denial generic.
// • Avoids leaking me-context in error UI.

import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import Acl from "../../components/acl/Acl";
import ForbiddenPage from "../../pages/ForbiddenPage";

type Mode = "all" | "any";

export type RequirePageAccessProps = {
  /** Server-defined page id to check (preferred). */
  pageId?: string;
  /** Optional: use explicit permissions instead of pageId. */
  requires?: string[] | null;
  /** How to evaluate `requires` (default: "all"). */
  mode?: Mode;
  /** If set, navigate here when denied (e.g., "/403"). If omitted, render <ForbiddenPage/> inline. */
  redirectTo?: string;
  /** Optional note for 403 page; do NOT include sensitive details. */
  note?: string;
  /** The page element to render on allow. */
  children: React.ReactNode;
};

export default function RequirePageAccess(props: RequirePageAccessProps) {
  const {
    pageId,
    requires,
    mode = "all",
    redirectTo,
    note,
    children,
  } = props;

  const location = useLocation();

  // We delegate the decision to <Acl/> and use `fallback` to render or redirect on denial.
  const fallback = redirectTo ? (
    <Navigate to={redirectTo} replace state={{ from: location }} />
  ) : (
    <ForbiddenPage note={note} />
  );

  // Prefer pageId; else use requires.
  return (
    <Acl
      pageId={pageId}
      requires={pageId ? undefined : requires}
      mode={mode}
      fallback={fallback}
      debugAttrsOnly
    >
      <React.Fragment>{children}</React.Fragment>
    </Acl>
  );
}
