// src/features/students/routes.tsx
//
// Purpose
// -------
// Tenant-protected Students routes with RBAC at the route level.
// Keeps the feature self-contained and easy to enable/disable.
//
// Current integration
// -------------------
// • Page lives alongside these routes at:
//     src/features/students/pages/StudentsPage.tsx
//
// RBAC rules (default)
// --------------------
// • List/View requires: "students.view"
// • (Optional) Create requires: "students.create"
// • (Optional) Edit requires: "students.update"
// Keep these aligned with your ui_resources document for the tenant.
//
// Usage
// -----
// Imported and spread by src/router/appRoutes.tsx

import type { RouteObject } from "react-router-dom";
import React from "react";
import { guard, guardLazy } from "@/router/withRouteGuard";

// Lazy load to keep initial bundle small.
const StudentsPage = React.lazy(() => import("./pages/StudentsPage"));

// Future forms (uncomment when pages exist in feature folder):
// const StudentCreatePage = React.lazy(() => import("@/features/students/pages/StudentCreatePage"));
// const StudentEditPage = React.lazy(() => import("@/features/students/pages/StudentEditPage"));

export const featureRoutes: RouteObject[] = [
  {
    path: "/students",
    element: guard(<StudentsPage />, { anyOf: ["students.view"] }),
  },

  // (Optional) Sub-routes for create/edit flows — enable when pages exist.
  // {
  //   path: "/students/new",
  //   element: guardLazy(() => import("@/features/students/pages/StudentCreatePage"), {
  //     anyOf: ["students.create"],
  //   }),
  // },
  // {
  //   path: "/students/:studentId/edit",
  //   element: guardLazy(() => import("@/features/students/pages/StudentEditPage"), {
  //     anyOf: ["students.update"],
  //   }),
  // },
];

// Alias to match central router import
export const studentRoutes = featureRoutes;
export default featureRoutes;
