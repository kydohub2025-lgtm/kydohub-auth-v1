/**
 * src/layouts/TenantLayout.tsx
 * -----------------------------------------------------------------------------
 * Purpose
 *  - Section wrapper for tenant-scoped features (Staff, Students, Parents, etc.).
 *  - Reads current tenant from `useMe()` and displays a compact header.
 *  - Provides a consistent content container and places <Outlet/> for sub-pages.
 *
 * Security
 *  - This layout does *not* grant access; it's visual chrome only.
 *  - Actual gating is via ProtectedRoute + <Acl> and backend RBAC/ABAC.
 *
 * UX
 *  - Sticky section header with tenant name/code and optional description line.
 *  - Slot for right-side actions (e.g., page-level “Create” button) via props.
 *
 * Dependencies
 *  - useMe: src/hooks/useMe.ts
 *  - react-router <Outlet/> for nested routes
 * -----------------------------------------------------------------------------
 */

import React from "react";
import { Outlet } from "react-router-dom";
import { useMe } from "../hooks/useMe";

type TenantLayoutProps = {
  /** Optional title for the section (e.g., "Staff", "Students") */
  title?: string;
  /** Optional subtitle/description rendered under the title */
  subtitle?: string;
  /** Optional right aligned toolbar (e.g., action buttons) */
  rightToolbar?: React.ReactNode;
  /** Optional custom class for the content container */
  contentClassName?: string;
};

const TenantLayout: React.FC<TenantLayoutProps> = ({
  title,
  subtitle,
  rightToolbar,
  contentClassName,
}) => {
  const { me, loading } = useMe();
  const tName = me?.tenant?.name || "Tenant";
  const tCode = me?.tenant?.code || undefined;

  return (
    <section className="min-h-full">
      {/* Section header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b">
        <div className="mx-auto max-w-7xl px-3 md:px-6 py-3 md:py-4">
          <div className="flex items-start md:items-center justify-between gap-3">
            <div className="flex-1">
              {/* Breadcrumb-ish line with tenant chip */}
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className="inline-flex items-center gap-1">
                  <span className="opacity-80">Tenant</span>
                  <span
                    className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 bg-white"
                    title={tCode ? `Tenant code: ${tCode}` : "Tenant"}
                  >
                    <span className="font-medium">{tName}</span>
                    {tCode && <span className="text-[10px] text-gray-500">({tCode})</span>}
                  </span>
                </span>
                {title && (
                  <>
                    <span className="opacity-50">/</span>
                    <span className="font-medium text-gray-800">{title}</span>
                  </>
                )}
              </div>

              {/* Main title + optional subtitle */}
              {title && (
                <h1 className="mt-1 text-xl md:text-2xl font-semibold tracking-tight text-gray-900">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="mt-0.5 text-sm text-gray-600">
                  {subtitle}
                </p>
              )}
            </div>

            {/* Right-aligned toolbar slot (e.g., actions) */}
            <div className="shrink-0">{rightToolbar}</div>
          </div>
        </div>
      </div>

      {/* Loading state for tenant header context only (content can still render) */}
      {loading && (
        <div className="mx-auto max-w-7xl px-3 md:px-6 py-3">
          <div className="h-8 w-40 rounded bg-gray-200 animate-pulse" />
        </div>
      )}

      {/* Content area */}
      <div className={`mx-auto max-w-7xl px-3 md:px-6 py-4 ${contentClassName ?? ""}`}>
        <Outlet />
      </div>
    </section>
  );
};

export default TenantLayout;
