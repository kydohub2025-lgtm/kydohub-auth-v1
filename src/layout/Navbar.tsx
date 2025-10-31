/**
 * src/components/layout/Navbar.tsx
 * -----------------------------------------------------------------------------
 * Purpose
 *  - Top navigation bar for KydoHub.
 *  - Reads signed-in user/tenant from `useMe()`.
 *  - Gates menu items with <Acl> tied to server-provided `ui_resources`.
 *  - Provides a consistent place to show account/tenant info and Logout.
 *
 * Key behaviors
 *  - While me/context loads: shows skeletons/placeholders.
 *  - When signed out (no me.user): hides private nav and shows Sign In.
 *  - Uses <Acl pageId="..."> / <Acl actionId="..."> to hide items per RBAC.
 *
 * Security notes
 *  - This is UI-only gating. Backend still enforces RBAC/ABAC server-side.
 *  - Logout is delegated to /logout route (centralized, safer).
 *
 * Dependencies
 *  - useMe: src/hooks/useMe.ts
 *  - Acl:   src/components/auth/Acl.tsx
 *  - LogoutButton: src/components/LogoutButton.tsx
 * -----------------------------------------------------------------------------
 */

import React from "react";
import { Link, NavLink } from "react-router-dom";
import { useMe } from "../../hooks/useMe";
import { Acl } from "../auth/Acl";
import LogoutButton from "../LogoutButton";

type NavbarProps = {
  /** Optional className for outer wrapper */
  className?: string;
};

export const Navbar: React.FC<NavbarProps> = ({ className }) => {
  const { me, loading } = useMe();

  const isSignedIn = !!me?.user?.id;

  return (
    <header
      className={
        "w-full border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 " +
        (className ?? "")
      }
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="h-14 flex items-center justify-between gap-4">
          {/* Left: Brand */}
          <div className="flex items-center gap-3">
            <Link to={isSignedIn ? "/app" : "/"} className="flex items-center gap-2">
              {/* Simple logo placeholder */}
              <div className="h-8 w-8 rounded-lg border flex items-center justify-center">
                <span className="text-xs font-semibold">KH</span>
              </div>
              <span className="font-semibold">KydoHub</span>
            </Link>

            {/* Primary nav (gated via <Acl pageId="...">) */}
            {isSignedIn && (
              <nav className="hidden md:flex items-center gap-4 ml-6">
                {/* Dashboard visible if page id "dashboard" is allowed */}
                <Acl pageId="dashboard">
                  <NavLink
                    to="/app"
                    className={({ isActive }) =>
                      "text-sm px-2 py-1 rounded " +
                      (isActive ? "font-semibold" : "text-gray-600 hover:text-black")
                    }
                  >
                    Dashboard
                  </NavLink>
                </Acl>

                {/* Staff page */}
                <Acl pageId="staff">
                  <NavLink
                    to="/app/staff"
                    className={({ isActive }) =>
                      "text-sm px-2 py-1 rounded " +
                      (isActive ? "font-semibold" : "text-gray-600 hover:text-black")
                    }
                  >
                    Staff
                  </NavLink>
                </Acl>

                {/* Students page */}
                <Acl pageId="students">
                  <NavLink
                    to="/app/students"
                    className={({ isActive }) =>
                      "text-sm px-2 py-1 rounded " +
                      (isActive ? "font-semibold" : "text-gray-600 hover:text-black")
                    }
                  >
                    Students
                  </NavLink>
                </Acl>

                {/* Parents page (example) */}
                <Acl pageId="parents">
                  <NavLink
                    to="/app/parents"
                    className={({ isActive }) =>
                      "text-sm px-2 py-1 rounded " +
                      (isActive ? "font-semibold" : "text-gray-600 hover:text-black")
                    }
                  >
                    Parents
                  </NavLink>
                </Acl>

                {/* Reports (example) */}
                <Acl pageId="reports">
                  <NavLink
                    to="/app/reports"
                    className={({ isActive }) =>
                      "text-sm px-2 py-1 rounded " +
                      (isActive ? "font-semibold" : "text-gray-600 hover:text-black")
                    }
                  >
                    Reports
                  </NavLink>
                </Acl>
              </nav>
            )}
          </div>

          {/* Right: account/tenant area */}
          <div className="flex items-center gap-3">
            {/* Loading placeholders */}
            {loading && (
              <div className="flex items-center gap-3">
                <div className="h-5 w-28 rounded bg-gray-200 animate-pulse" />
                <div className="h-8 w-8 rounded-full bg-gray-200 animate-pulse" />
              </div>
            )}

            {/* When signed in, show tenant + user + logout */}
            {!loading && isSignedIn && (
              <>
                {/* Tenant name if present */}
                {me?.tenant?.name && (
                  <span className="hidden sm:inline text-sm text-gray-600">
                    {me.tenant.name}
                  </span>
                )}

                {/* Example: an action gated button (e.g., reports.export) */}
                <Acl actionId="reports.export">
                  <Link
                    to="/app/reports/export"
                    className="text-sm border px-2 py-1 rounded hover:bg-gray-50"
                  >
                    Export
                  </Link>
                </Acl>

                {/* Account pill */}
                <Link
                  to="/app/account"
                  className="flex items-center gap-2 border rounded-full px-2 py-1 hover:bg-gray-50"
                  title="Account settings"
                >
                  <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">
                    {me?.user?.email?.[0]?.toUpperCase() ?? "U"}
                  </div>
                  <span className="hidden md:inline text-sm">
                    {me?.user?.email ?? "Account"}
                  </span>
                </Link>

                {/* Logout */}
                <LogoutButton
                  as="text"
                  className="text-sm border px-2 py-1 rounded hover:bg-gray-50"
                  label="Sign out"
                />
              </>
            )}

            {/* When signed out, show Sign In */}
            {!loading && !isSignedIn && (
              <Link
                to="/signin"
                className="text-sm border px-3 py-1 rounded hover:bg-gray-50"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
