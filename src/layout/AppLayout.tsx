/**
 * src/layouts/AppLayout.tsx
 * -----------------------------------------------------------------------------
 * Purpose
 *  - Protected application shell used by all authenticated routes.
 *  - Renders top Navbar, left Sidebar, and a scrollable <main> with <Outlet/>.
 *
 * Key behaviors
 *  - Responsive: collapses sidebar on small screens (toggle lives in Navbar).
 *  - A11y: skip-link to jump to main content; proper landmarks.
 *  - Security: this is only chrome; gating is enforced by ProtectedRoute + <Acl>.
 *
 * Dependencies
 *  - Navbar:   src/components/layout/Navbar.tsx  (emits onToggleSidebar)
 *  - Sidebar:  src/components/layout/Sidebar.tsx
 *  - Router:   react-router-dom <Outlet/> for nested pages
 *
 * Notes
 *  - Keep this component light; avoid data fetching here.
 *  - Page-level RBAC/ABAC is handled via <Acl> and backend enforcement.
 * -----------------------------------------------------------------------------
 */

import React from "react";
import { Outlet } from "react-router-dom";
import Navbar from "../components/layout/Navbar";
import Sidebar from "../components/layout/Sidebar";

const AppLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const mainRef = React.useRef<HTMLElement>(null);

  const handleToggleSidebar = React.useCallback(() => {
    setSidebarOpen((v) => !v);
  }, []);

  const handleCloseSidebar = React.useCallback(() => {
    setSidebarOpen(false);
  }, []);

  // Close sidebar with ESC on mobile
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-dvh w-dvw overflow-hidden bg-gray-50 text-gray-900">
      {/* Skip to content for screen reader / keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50
                   focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to main content
      </a>

      {/* Top navbar */}
      <header role="banner" className="h-14">
        <Navbar onToggleSidebar={handleToggleSidebar} />
      </header>

      {/* Body: sidebar + content */}
      <div className="h-[calc(100dvh-3.5rem)] grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {/* Mobile sidebar (overlay) */}
        {sidebarOpen && (
          <div className="md:hidden relative z-40">
            {/* Backdrop */}
            <button
              aria-label="Close sidebar overlay"
              className="fixed inset-0 bg-black/30"
              onClick={handleCloseSidebar}
            />
            {/* Drawer */}
            <div className="fixed inset-y-0 left-0 w-[84%] max-w-[300px] bg-white shadow-xl">
              <Sidebar />
            </div>
          </div>
        )}

        {/* Main content area */}
        <main
          id="main-content"
          ref={mainRef}
          role="main"
          className="bg-white md:bg-transparent overflow-y-auto focus:outline-none"
          tabIndex={-1}
        >
          {/* Content container */}
          <div className="min-h-full p-3 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
