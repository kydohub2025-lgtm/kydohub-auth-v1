// src/routes/AppRoutes.tsx
//
// Purpose
// -------
// Central router with page-level RBAC guards.
// • Public routes (login, signup) are open.
// • Authenticated app routes render inside AppLayout and are *page-gated*
//   via <RequirePageAccess pageId="...">.
// • A dedicated 403 route is provided for deep links.
//
// How it works
// ------------
// 1) After login, MeContext fetches /me/context (see MeProvider).
// 2) Each protected route wraps the page with <RequirePageAccess pageId="...">.
// 3) If the user lacks access, they see ForbiddenPage (or get redirected to /403).
//
// Non-developer tip
// -----------------
// • To add a new screen, decide a `pageId` (must exist in ui_resources.pages)
//   and wrap the component with <RequirePageAccess pageId="that-id">.
//
// Security
// --------
// • No permission names are rendered. Decisions rely on me.ui_resources & effective role permissions.
// • Backend remains authoritative for API calls.

import * as React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AppLayout from "../layout/AppLayout";
import LoginPage from "../pages/auth/LoginPage";
import SignupPage from "../pages/auth/SignupPage";

import DashboardPage from "../pages/DashboardPage";
import StaffPage from "../pages/StaffPage";
import StudentsPage from "../pages/StudentsPage";
import ParentsPage from "../pages/ParentsPage";

import NotFound from "../pages/NotFound";
import ForbiddenPage from "../pages/ForbiddenPage";

import RequirePageAccess from "./guards/RequirePageAccess";

// Optional: a small wrapper to route "" → first allowed page post-login if needed.
// For now, we default "" → "/dashboard". You can later replace this with a
// dynamic resolver using me.ui_resources.pages order.
function HomeRedirect() {
  return <Navigate to="/dashboard" replace />;
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* ----------------------------- Public routes ----------------------------- */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* ------------------------- App shell (protected) ------------------------- */}
      {/* AppLayout typically has top nav / sidebar. Child routes are page-gated below. */}
      <Route path="/" element={<AppLayout />}>
        {/* default → dashboard (you can replace with a dynamic "first allowed page" later) */}
        <Route index element={<HomeRedirect />} />

        {/* Page-gated routes: pageId MUST match ui_resources.pages[].id from /me/context */}
        <Route
          path="dashboard"
          element={
            <RequirePageAccess pageId="dashboard" redirectTo="/403">
              <DashboardPage />
            </RequirePageAccess>
          }
        />

        <Route
          path="staff"
          element={
            <RequirePageAccess pageId="staff" redirectTo="/403">
              <StaffPage />
            </RequirePageAccess>
          }
        />

        <Route
          path="students"
          element={
            <RequirePageAccess pageId="students" redirectTo="/403">
              <StudentsPage />
            </RequirePageAccess>
          }
        />

        <Route
          path="parents"
          element={
            <RequirePageAccess pageId="parents" redirectTo="/403">
              <ParentsPage />
            </RequirePageAccess>
          }
        />

        {/* 403 (explicit route for deep links / redirects) */}
        <Route path="403" element={<ForbiddenPage />} />

        {/* 404 fallback */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
