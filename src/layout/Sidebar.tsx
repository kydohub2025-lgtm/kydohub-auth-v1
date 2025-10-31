/**
 * src/components/layout/Sidebar.tsx
 * -----------------------------------------------------------------------------
 * Purpose
 *  - Left navigation for KydoHub's protected app shell.
 *  - Reads user/tenant from `useMe()` and hides items via <Acl>.
 *  - Offers a compact, resilient layout with a footer that includes Logout.
 *
 * Key behaviors
 *  - Shows skeletons while /me/context loads.
 *  - Hides all private links when not signed in.
 *  - Uses <Acl pageId="..."> for page-level gating, <Acl actionId="..."> for action chips.
 *
 * Security notes
 *  - UI gating only; backend still enforces RBAC/ABAC.
 *  - Logout routes to dedicated /logout workflow (centralized, safer).
 *
 * Dependencies
 *  - useMe:         src/hooks/useMe.ts
 *  - Acl:           src/components/auth/Acl.tsx
 *  - LogoutButton:  src/components/LogoutButton.tsx
 * -----------------------------------------------------------------------------
 */

import React from "react";
import { NavLink, Link } from "react-router-dom";
import { useMe } from "../../hooks/useMe";
import { Acl } from "../auth/Acl";
import LogoutButton from "../LogoutButton";

type SidebarProps = {
  /** Collapsed state for narrow layouts (optional) */
  collapsed?: boolean;
  /** Optional className overrides */
  className?: string;
};

export const Sidebar: React.FC<SidebarProps> = ({ collapsed = false, className }) => {
  const { me, loading } = useMe();
  const isSignedIn = !!me?.user?.id;

  return (
    <aside
      className={
        "h-full border-r bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 " +
        (className ?? "")
      }
      aria-label="Primary navigation"
    >
      {/* Header / brand (mini when collapsed) */}
      <div className="h-14 flex items-center px-3 border-b">
        <Link to={isSignedIn ? "/app" : "/"} className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg border flex items-center justify-center">
            <span className="text-xs font-semibold">KH</span>
          </div>
          {!collapsed && <span className="font-semibold">KydoHub</span>}
        </Link>
      </div>

      {/* Content */}
      <div className="flex flex-col h-[calc(100%-3.5rem)]">
        <nav className="flex-1 p-2">
          {/* Loading state */}
          {loading && (
            <div className="space-y-2">
              <div className="h-8 rounded bg-gray-200 animate-pulse" />
              <div className="h-8 rounded bg-gray-200 animate-pulse" />
              <div className="h-8 rounded bg-gray-200 animate-pulse" />
            </div>
          )}

          {/* Signed-in nav items */}
          {!loading && isSignedIn && (
            <ul className="space-y-1">
              {/* Dashboard */}
              <Acl pageId="dashboard">
                <li>
                  <NavLink
                    to="/app"
                    className={({ isActive }) =>
                      "flex items-center gap-2 rounded px-3 py-2 text-sm " +
                      (isActive ? "bg-gray-100 font-semibold" : "hover:bg-gray-50 text-gray-700")
                    }
                  >
                    <span className="inline-block h-4 w-4 border rounded" aria-hidden />
                    {!collapsed && <span>Dashboard</span>}
                  </NavLink>
                </li>
              </Acl>

              {/* Staff */}
              <Acl pageId="staff">
                <li>
                  <NavLink
                    to="/app/staff"
                    className={({ isActive }) =>
                      "flex items-center gap-2 rounded px-3 py-2 text-sm " +
                      (isActive ? "bg-gray-100 font-semibold" : "hover:bg-gray-50 text-gray-700")
                    }
                  >
                    <span className="inline-block h-4 w-4 border rounded" aria-hidden />
                    {!collapsed && <span>Staff</span>}
                  </NavLink>

                  {/* Optional nested action chip (example) */}
                  <Acl actionId="staff.create">
                    {!collapsed && (
                      <div className="ml-9 mt-1">
                        <span className="inline-block text-[11px] border px-1.5 py-0.5 rounded">
                          Can create
                        </span>
                      </div>
                    )}
                  </Acl>
                </li>
              </Acl>

              {/* Students */}
              <Acl pageId="students">
                <li>
                  <NavLink
                    to="/app/students"
                    className={({ isActive }) =>
                      "flex items-center gap-2 rounded px-3 py-2 text-sm " +
                      (isActive ? "bg-gray-100 font-semibold" : "hover:bg-gray-50 text-gray-700")
                    }
                  >
                    <span className="inline-block h-4 w-4 border rounded" aria-hidden />
                    {!collapsed && <span>Students</span>}
                  </NavLink>
                </li>
              </Acl>

              {/* Parents */}
              <Acl pageId="parents">
                <li>
                  <NavLink
                    to="/app/parents"
                    className={({ isActive }) =>
                      "flex items-center gap-2 rounded px-3 py-2 text-sm " +
                      (isActive ? "bg-gray-100 font-semibold" : "hover:bg-gray-50 text-gray-700")
                    }
                  >
                    <span className="inline-block h-4 w-4 border rounded" aria-hidden />
                    {!collapsed && <span>Parents</span>}
                  </NavLink>
                </li>
              </Acl>

              {/* Reports */}
              <Acl pageId="reports">
                <li>
                  <NavLink
                    to="/app/reports"
                    className={({ isActive }) =>
                      "flex items-center gap-2 rounded px-3 py-2 text-sm " +
                      (isActive ? "bg-gray-100 font-semibold" : "hover:bg-gray-50 text-gray-700")
                    }
                  >
                    <span className="inline-block h-4 w-4 border rounded" aria-hidden />
                    {!collapsed && <span>Reports</span>}
                  </NavLink>

                  {/* Example action chip */}
                  <Acl actionId="reports.export">
                    {!collapsed && (
                      <div className="ml-9 mt-1">
                        <span className="inline-block text-[11px] border px-1.5 py-0.5 rounded">
                          Export access
                        </span>
                      </div>
                    )}
                  </Acl>
                </li>
              </Acl>
            </ul>
          )}

          {/* Signed-out hint */}
          {!loading && !isSignedIn && (
            <div className="text-sm text-gray-600 px-3 py-2">
              Please{" "}
              <Link to="/signin" className="underline">
                sign in
              </Link>{" "}
              to access features.
            </div>
          )}
        </nav>

        {/* Footer (account + logout) */}
        <div className="border-t p-3">
          {!loading && isSignedIn ? (
            <div className="flex items-center justify-between gap-2">
              <Link
                to="/app/account"
                className="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50"
                title="Account settings"
              >
                <div className="h-7 w-7 rounded-full bg-gray-200 flex items-center justify-center text-xs">
                  {me?.user?.email?.[0]?.toUpperCase() ?? "U"}
                </div>
                {!collapsed && (
                  <div className="flex flex-col">
                    <span className="text-sm">{me?.user?.email ?? "Account"}</span>
                    {me?.tenant?.name && (
                      <span className="text-[11px] text-gray-500">{me.tenant.name}</span>
                    )}
                  </div>
                )}
              </Link>

              {/* Compact logout control always present */}
              <LogoutButton
                as={collapsed ? "icon" : "text"}
                className={collapsed ? "" : "text-sm border px-2 py-1 rounded hover:bg-gray-50"}
                label="Sign out"
                title="Sign out of KydoHub"
              />
            </div>
          ) : (
            !loading && (
              <Link
                to="/signin"
                className="block text-center text-sm border px-3 py-1 rounded hover:bg-gray-50"
              >
                Sign in
              </Link>
            )
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
