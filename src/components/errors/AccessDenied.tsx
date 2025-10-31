// src/components/errors/AccessDenied.tsx
//
// Purpose
// -------
// Dedicated 403 (Forbidden) page/component for RBAC denials.
// Use when a user is authenticated but lacks required permissions
// to view a page or perform an action.
//
// When to use
// -----------
// • Route guard denies a page: render this component as the page.
// • Component-level guard (Acl) hides a section/action: optionally inline this.
//
// Design notes
// ------------
// • Keeps language neutral and tenant-safe; reveals only required permissions,
//   never sensitive role details.
// • Provides quick actions (switch tenant, go home, reload, sign out).
// • Optional debug block appears in development to surface context info.
//
// Integration
// -----------
// Router example (page-level):
//   element: (
//     <RequirePerms anyOf={["students.view"]}>
//       <StudentsPage />
//     </RequirePerms>
//   )
//
// Inside <RequirePerms>, on deny:
//   return <AccessDenied required={["students.view"]} />;
//
// Component example:
//   <Acl requires={["staff.create"]} fallback={<AccessDenied inline required={["staff.create"]} />}>
//     <CreateStaffButton />
//   </Acl>
//
// Security
// --------
// • Never show actual user attributes/filters to end users.
// • Debug details are shown only in development mode.

import React from "react";
import { useNavigate } from "react-router-dom";

type AccessDeniedProps = {
  /** List of permissions that would satisfy access */
  required?: string[];
  /** Optional friendly title */
  title?: string;
  /** Optional message (otherwise a sensible default) */
  message?: string;
  /** Render as a small inline block instead of a full page */
  inline?: boolean;
  /** Optional custom actions (e.g., <Button>Ask Admin</Button>) */
  actions?: React.ReactNode;
  /** Show a dev-only debug section (auto-enabled in development) */
  debugInfo?: Record<string, unknown>;
};

export function AccessDenied({
  required,
  title = "Access denied",
  message,
  inline = false,
  actions,
  debugInfo,
}: AccessDeniedProps) {
  const navigate = useNavigate();

  const content = (
    <div
      className={[
        "rounded-2xl border shadow-sm",
        "bg-white/80 dark:bg-neutral-900/60 backdrop-blur",
        inline ? "p-4" : "p-6 md:p-10",
      ].join(" ")}
    >
      <h1 className="text-lg md:text-xl font-semibold mb-2">{title}</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-4">
        {message ??
          "You’re signed in, but your role doesn’t have permission to view this content."}
      </p>

      {Array.isArray(required) && required.length > 0 && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
            Required permission{required.length > 1 ? "s" : ""}
          </div>
          <ul className="flex flex-wrap gap-2">
            {required.map((p) => (
              <li
                key={p}
                className="text-xs rounded-full border px-2 py-1 bg-neutral-50 dark:bg-neutral-800"
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium shadow-sm border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Go to Dashboard
        </button>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium shadow-sm bg-black text-white hover:bg-neutral-800"
        >
          Reload
        </button>
        {/* Optional: if you have a tenant switcher route/dialog */}
        <button
          onClick={() => navigate("/tenant/switch")}
          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium shadow-sm border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Switch tenant
        </button>
        {/* Optional: if you expose sign-out here, wire to your auth/logout */}
        {/* <button onClick={logout} className="...">Sign out</button> */}
        {actions}
      </div>

      {showDebug() && (debugInfo || required) ? (
        <div className="mt-6">
          <details className="text-xs">
            <summary className="cursor-pointer select-none text-neutral-500">
              Developer details
            </summary>
            <pre className="mt-2 overflow-auto rounded-md bg-neutral-100 dark:bg-neutral-800 p-3">
              {JSON.stringify(
                {
                  required,
                  debugInfo,
                  location: typeof window !== "undefined" ? window.location.href : undefined,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  );

  if (inline) {
    return <div className="my-3">{content}</div>;
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      {content}
    </div>
  );
}

function showDebug() {
  return import.meta.env?.MODE === "development";
}

export default AccessDenied;
