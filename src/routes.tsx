/**
 * src/routes.tsx
 * -----------------------------------------------------------------------------
 * App-wide routing for KydoHub (React Router v6+).
 *
 * What it does
 *  - Declares public routes: /login, /logout (logout auto-runs).
 *  - Declares protected area under AppLayout: /, /dashboard, /staff, /students.
 *  - Uses <ProtectedRoute> to enforce authenticated access (cookies-based auth).
 *  - Falls back to <NotFound /> for unknown paths.
 *
 * Notes
 *  - Keep page files in src/pages/* (as per current MVP).
 *  - If/when you move to feature folders, only update these import paths.
 *  - No token storage here; backend httpOnly cookies are the source of truth.
 * -----------------------------------------------------------------------------
 */

import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Layouts
import { AppLayout } from "./layouts/AppLayout";       // shell with Navbar + Sidebar
// If you’re not using tenant-specific shell right now, you can remove this:
// import { TenantLayout } from "./layouts/TenantLayout";

// Public pages
import { LoginPage } from "./pages/LoginPage";
import { LogoutPage } from "./pages/LogoutPage";

// Protected pages (MVP demo pages)
import { DashboardPage } from "./pages/DashboardPage";
import { StaffPage } from "./pages/StaffPage";
import { StudentsPage } from "./pages/StudentsPage";
import { NotFound } from "./pages/NotFound";

// Route guard
import { ProtectedRoute } from "./routes/ProtectedRoute";

export const AppRoutes: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/logout" element={<LogoutPage />} />

        {/* Protected section */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          {/* Default redirect to /dashboard */}
          <Route index element={<Navigate to="/dashboard" replace />} />

          {/* Feature pages (MVP) */}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/students" element={<StudentsPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

export default AppRoutes;
