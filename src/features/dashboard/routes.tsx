// src/features/dashboard/routes.tsx
//
// Purpose
// -------
// Tenant-protected Dashboard routes. Applies RBAC at the route level so only
// users with the proper permission(s) can render the Dashboard page.
//
// Current integration
// -------------------
// • The page lives in this feature folder:
//     src/features/dashboard/pages/DashboardPage.tsx
//   Keep feature code self-contained by importing from within the folder.
//
// RBAC rule
// ---------
// • Requires: "dashboard.view"
// • Adjust in one place if you change the permission id in ui_resources.
//
// Usage
// -----
// Imported and spread by src/router/appRoutes.tsx

import type { RouteObject } from "react-router-dom";
import React from "react";
import { guard } from "@/router/withRouteGuard";

// Lazy page (keeps initial bundle small)
const DashboardPage = React.lazy(() => import("./pages/DashboardPage"));

export const featureRoutes: RouteObject[] = [
  {
    path: "/dashboard",
    element: guard(<DashboardPage />, { anyOf: ["dashboard.view"] }),
  },
  // Optional convenience alias: root → dashboard
  {
    path: "/",
    element: guard(<DashboardPage />, { anyOf: ["dashboard.view"] }),
  },
];

// Alias to match central router import
export const dashboardRoutes = featureRoutes;
export default featureRoutes;
