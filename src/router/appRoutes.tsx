// src/router/appRoutes.tsx
//
// Purpose
// -------
// Single place to assemble the application’s route tree while keeping each
// feature self-contained in: src/features/<feature>/routes.tsx
//
// How it works
// ------------
// • Every feature exposes its own `featureRoutes` array from
//   src/features/<feature>/routes.tsx.
// • This file imports those arrays and merges them into `appRoutes`.
// • Guards are applied inside each feature’s routes via `guard(...)` or
//   `guardLazy(...)` (see src/lib/router/withRouteGuard.tsx).
//
// Why this design
// ---------------
// • Preserves your agreed folder structure (feature-scoped) while giving the
//   router one authoritative list.
// • Makes it trivial to enable/disable features (just add/remove an import).
//
// Usage in App
// ------------
// In src/App.tsx (or your Router provider module), do:
//   import { appRoutes } from "@/router/appRoutes";
//   createBrowserRouter(appRoutes)
//
// Conventions
// -----------
// • Public/auth routes (login/signup) should live under src/features/auth/.
// • Tenant-protected pages must use RBAC guards in their feature routes.
// • 404 route is provided here as a final catch-all.
//
// Security
// --------
// • This file does not grant access; it only aggregates feature routes.
// • RBAC enforcement happens in each feature via guard()/RequirePerms.
//
// NOTE for non-developers
// -----------------------
// If you add a new feature later, create `src/features/<feature>/routes.tsx`,
// export `featureRoutes`, and then import + spread it here.

import type { RouteObject } from "react-router-dom";

// Feature route modules (keep these lines at the top for easy toggling)
import { featureRoutes as authRoutes } from "@/features/auth/routes";
import { featureRoutes as dashboardRoutes } from "@/features/dashboard/routes";
import { featureRoutes as staffRoutes } from "@/features/staff/routes";
import { featureRoutes as studentsRoutes } from "@/features/students/routes";
// Add new features above this line…

// Shared pages
import NotFound from "@/pages/NotFound";

// Merge all feature routes in a deterministic order.
// Public/auth first, then tenant-protected features.
export const appRoutes: RouteObject[] = [
  ...authRoutes,
  ...dashboardRoutes,
  ...staffRoutes,
  ...studentsRoutes,

  // Final catch-all (404)
  {
    path: "*",
    element: <NotFound />,
  },
];

export default appRoutes;
