// src/features/auth/routes.tsx
//
// Purpose
// -------
// Public (non-tenant) routes for authentication: login & signup.
// These routes are intentionally *not* RBAC-guarded.
// They are kept in the "auth" feature so the appRoutes aggregator can
// compose feature routes cleanly.
//
// Current integration
// -------------------
// • We reference your existing pages at "@/pages/LoginPage" and "@/pages/SignupPage"
//   to avoid breaking imports while we gradually migrate to feature folders.
// • When you later move these pages to:
//     src/features/auth/pages/LoginPage.tsx
//     src/features/auth/pages/SignupPage.tsx
//   you only need to update the two dynamic import paths below.
//
// Usage
// -----
// Imported by src/router/appRoutes.tsx:
//   import { featureRoutes as authRoutes } from "@/features/auth/routes";
//   ...spread into appRoutes
//
// Security
// --------
// • No RBAC here—users aren’t signed in yet.
// • Keep forms CSRF-safe per your existing fetch/CSRF middleware.
// • Errors are standardized via api_error_contracts.md.

import type { RouteObject } from "react-router-dom";
import React from "react";

// Lazy to keep initial bundle small.
// Load pages from this feature folder (no external supabase deps).
const LoginPage = React.lazy(() => import("./pages/LoginPage"));
const SignupPage = React.lazy(() => import("./pages/SignupPage"));

export const featureRoutes: RouteObject[] = [
  {
    path: "/login",
    element: (
      <React.Suspense
        fallback={
          <div className="p-6 md:p-10">
            <div className="animate-pulse h-6 w-40 mb-4 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="animate-pulse h-40 rounded-2xl border bg-white/60 dark:bg-neutral-900/40" />
          </div>
        }
      >
        <LoginPage />
      </React.Suspense>
    ),
  },
  {
    path: "/signup",
    element: (
      <React.Suspense
        fallback={
          <div className="p-6 md:p-10">
            <div className="animate-pulse h-6 w-40 mb-4 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="animate-pulse h-40 rounded-2xl border bg-white/60 dark:bg-neutral-900/40" />
          </div>
        }
      >
        <SignupPage />
      </React.Suspense>
    ),
  },
];

// Alias to match central router import
export const authRoutes = featureRoutes;
export default featureRoutes;
