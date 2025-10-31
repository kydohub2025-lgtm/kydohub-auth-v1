// src/features/staff/routes.tsx
//
// Purpose
// -------
// Tenant-protected Staff routes with RBAC at the route level.
// Keeps feature self-contained and swappable.
//
// Current integration
// -------------------
// • Page lives inside this feature:
//     src/features/staff/pages/StaffPage.tsx
//   Import locally to keep the feature self-contained.
//
// RBAC rules (default)
// --------------------
// • List/View page requires: "staff.view"
// • (Optional) Creation form route requires: "staff.create"
// • (Optional) Edit form route requires: "staff.update"
// Adjust these strings to match ui_resources if you rename permissions.
//
// Usage
// -----
// Imported and spread by src/router/appRoutes.tsx

import type { RouteObject } from "react-router-dom";
import React from "react";
import { guard, guardLazy } from "@/router/withRouteGuard";

// Lazy: keep the initial bundle small.
const StaffPage = React.lazy(() => import("./pages/StaffPage"));

// If/when you add create/edit pages later, keep them lazy too:
// const StaffCreatePage = React.lazy(() => import("@/features/staff/pages/StaffCreatePage"));
// const StaffEditPage = React.lazy(() => import("@/features/staff/pages/StaffEditPage"));

export const featureRoutes: RouteObject[] = [
  {
    path: "/staff",
    element: guard(<StaffPage />, { anyOf: ["staff.view"] }),
  },

  // (Optional) Example sub-routes for forms — uncomment when pages exist.
  // {
  //   path: "/staff/new",
  //   element: guardLazy(() => import("@/features/staff/pages/StaffCreatePage"), {
  //     anyOf: ["staff.create"],
  //   }),
  // },
  // {
  //   path: "/staff/:staffId/edit",
  //   element: guardLazy(() => import("@/features/staff/pages/StaffEditPage"), {
  //     anyOf: ["staff.update"],
  //   }),
  // },
];

// Alias to match central router import
export const staffRoutes = featureRoutes;
export default featureRoutes;
