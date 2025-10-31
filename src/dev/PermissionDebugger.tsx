// src/dev/PermissionDebugger.tsx
//
// Purpose
// -------
// Developer-only panel to visualize RBAC/ABAC context coming from /me/context.
// It lists memberships, active tenant, effective permissions, and the
// server-supplied ui_resources (pages/actions). It also shows live evaluations
// for allowPage() and allowAction() so you can verify gating without digging
// into the console.
//
// Why this is safe
// ----------------
// • It renders nothing in production builds by default (guards on MODE).
// • Contains no secrets; it only displays what the app already has in memory.
// • No mutation of server data; a "Reload context" button simply calls
//   MeContext.reload() if available, otherwise does a full page reload.
//
// Non-developer tip
// -----------------
// Include this while developing. When you deploy, either remove it from the UI
// or keep it wrapped behind the dev guard shown below.
//
// Dependencies
// ------------
// - MeContext: useMe() must expose { me, loading, reload? }
// - ACL helpers: allowPage(), allowAction() from src/lib/acl
//
// Suggested mounting
// ------------------
// In AppLayout or any top-level component:
// {import.meta.env.MODE === "development" && <PermissionDebugger dock="right" />}

import React, { useMemo, useState } from "react";
import { useMe } from "@/context/MeContext";
import { allowPage, allowAction } from "@/lib/acl";

type Dock = "left" | "right" | "bottom" | "float";

type Props = {
  /** Force show even in production (useful on staging if needed). Default: false */
  force?: boolean;
  /** Where to dock the panel. Default: "right" */
  dock?: Dock;
  /** Start collapsed. Default: false */
  collapsed?: boolean;
};

function isDev() {
  // Vite convention: import.meta.env.MODE is "development" or "production"
  return typeof import.meta !== "undefined" && import.meta.env?.MODE === "development";
}

export const PermissionDebugger: React.FC<Props> = ({
  force = false,
  dock = "right",
  collapsed = false,
}) => {
  if (!force && !isDev()) return null;

  const { me, loading, reload } = useMe();
  const [open, setOpen] = useState(!collapsed);
  const [filter, setFilter] = useState("");

  const perms: string[] = useMemo(() => {
    const p =
      // Prefer canonical path me.permissions
      (me as any)?.permissions ??
      // Some backends expose under me.auth.permissions
      (me as any)?.auth?.permissions ??
      [];
    return Array.isArray(p) ? p : [];
  }, [me]);

  const pages: Array<{ id: string; requires?: string[] | null }> = useMemo(() => {
    const arr =
      (me as any)?.ui_resources?.pages ??
      (me as any)?.uiResources?.pages ??
      [];
    return Array.isArray(arr) ? arr : [];
  }, [me]);

  const actions: Array<{ id: string; requires?: string[] | null }> = useMemo(() => {
    const arr =
      (me as any)?.ui_resources?.actions ??
      (me as any)?.uiResources?.actions ??
      [];
    return Array.isArray(arr) ? arr : [];
  }, [me]);

  const memberships: Array<{ tenantId: string; tenantName?: string; roles?: string[] }> =
    useMemo(() => (me as any)?.memberships ?? [], [me]);

  const activeTenantId: string | null = useMemo(() => {
    return (
      (me as any)?.active?.tenantId ??
      (me as any)?.activeTenantId ??
      null
    );
  }, [me]);

  const filteredPages = useMemo(() => {
    if (!filter) return pages;
    const f = filter.toLowerCase();
    return pages.filter((p) => p.id.toLowerCase().includes(f));
  }, [pages, filter]);

  const filteredActions = useMemo(() => {
    if (!filter) return actions;
    const f = filter.toLowerCase();
    return actions.filter((a) => a.id.toLowerCase().includes(f));
  }, [actions, filter]);

  const dockCls =
    dock === "left"
      ? "left-0 top-0 h-full w-[380px]"
      : dock === "right"
      ? "right-0 top-0 h-full w-[380px]"
      : dock === "bottom"
      ? "left-0 bottom-0 w-full max-h-[48vh]"
      : // float
        "right-4 bottom-4 w-[420px] max-h-[65vh] shadow-xl";

  return (
    <div
      className={`fixed z-[9999] bg-white border border-gray-200 shadow-lg rounded-t-lg ${
        dock === "float" ? "rounded-lg" : ""
      } ${dockCls} flex flex-col`}
      style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Permission Debugger</span>
          <span className="text-[11px] px-1.5 py-0.5 bg-gray-200 rounded">
            {isDev() ? "dev" : force ? "forced" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            placeholder="Filter pages/actions…"
            className="h-8 px-2 text-sm border rounded"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="h-8 px-2 text-sm border rounded"
            onClick={async () => {
              try {
                if (typeof reload === "function") {
                  await reload();
                } else {
                  window.location.reload();
                }
              } catch {
                window.location.reload();
              }
            }}
            disabled={loading}
            title="Reload /me/context"
          >
            {loading ? "Reloading…" : "Reload"}
          </button>
          <button
            className="h-8 px-2 text-sm border rounded"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {!open ? null : (
        <div className="flex-1 overflow-auto p-3 space-y-4 text-sm">
          {/* Session / Memberships */}
          <section>
            <h3 className="font-semibold mb-1">Session</h3>
            {loading ? (
              <div className="opacity-70">Loading /me/context…</div>
            ) : me ? (
              <div className="space-y-2">
                <div className="text-[13px]">
                  <span className="font-medium">Active tenant:</span>{" "}
                  <code className="bg-gray-100 px-1 py-0.5 rounded">
                    {activeTenantId ?? "—"}
                  </code>
                </div>
                <div>
                  <div className="font-medium mb-1">Memberships</div>
                  <div className="border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-2 py-1">Tenant</th>
                          <th className="text-left px-2 py-1">TenantId</th>
                          <th className="text-left px-2 py-1">Roles</th>
                        </tr>
                      </thead>
                      <tbody>
                        {memberships.map((m, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-2 py-1">
                              {m.tenantName ?? "—"}
                            </td>
                            <td className="px-2 py-1">
                              <code className="bg-gray-100 px-1 py-0.5 rounded">
                                {m.tenantId}
                              </code>
                            </td>
                            <td className="px-2 py-1">
                              {(m.roles ?? []).join(", ") || "—"}
                            </td>
                          </tr>
                        ))}
                        {!memberships.length && (
                          <tr>
                            <td className="px-2 py-2 text-gray-500" colSpan={3}>
                              No memberships found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="opacity-70">No session.</div>
            )}
          </section>

          {/* Permissions */}
          <section>
            <h3 className="font-semibold mb-1">Effective Permissions</h3>
            <div className="flex items-center gap-2 mb-2">
              <button
                className="h-7 px-2 text-xs border rounded"
                onClick={() => {
                  const text = perms.join("\n");
                  navigator.clipboard?.writeText(text);
                }}
                disabled={!perms.length}
              >
                Copy
              </button>
              <span className="text-[12px] opacity-70">
                {perms.length} entries
              </span>
            </div>
            <div className="border rounded max-h-40 overflow-auto">
              {perms.length ? (
                <ul className="text-xs">
                  {perms.map((p) => (
                    <li key={p} className="px-2 py-1 border-b last:border-b-0">
                      <code className="bg-gray-100 px-1 py-0.5 rounded">{p}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-2 text-xs text-gray-500">None</div>
              )}
            </div>
          </section>

          {/* Pages */}
          <section>
            <h3 className="font-semibold mb-1">Pages (ui_resources.pages)</h3>
            <div className="border rounded overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-2 py-1 w-[44%]">pageId</th>
                    <th className="text-left px-2 py-1 w-[44%]">requires</th>
                    <th className="text-left px-2 py-1 w-[12%]">allow</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPages.map((p) => {
                    const ok = allowPage(me as any, p.id);
                    return (
                      <tr key={p.id} className="border-t">
                        <td className="px-2 py-1">
                          <code className="bg-gray-100 px-1 py-0.5 rounded">{p.id}</code>
                        </td>
                        <td className="px-2 py-1">
                          {(p.requires ?? []).length ? (
                            <span className="break-words">
                              {(p.requires ?? []).map((r) => (
                                <code
                                  key={r}
                                  className="bg-gray-100 px-1 py-0.5 mr-1 rounded inline-block mb-1"
                                >
                                  {r}
                                </code>
                              ))}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <span
                            className={`px-1.5 py-0.5 rounded ${
                              ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {ok ? "yes" : "no"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredPages.length && (
                    <tr>
                      <td className="px-2 py-2 text-gray-500" colSpan={3}>
                        No pages
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Actions */}
          <section>
            <h3 className="font-semibold mb-1">Actions (ui_resources.actions)</h3>
            <div className="border rounded overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-2 py-1 w-[44%]">actionId</th>
                    <th className="text-left px-2 py-1 w-[44%]">requires</th>
                    <th className="text-left px-2 py-1 w-[12%]">allow</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActions.map((a) => {
                    const ok = allowAction(me as any, a.id);
                    return (
                      <tr key={a.id} className="border-t">
                        <td className="px-2 py-1">
                          <code className="bg-gray-100 px-1 py-0.5 rounded">{a.id}</code>
                        </td>
                        <td className="px-2 py-1">
                          {(a.requires ?? []).length ? (
                            <span className="break-words">
                              {(a.requires ?? []).map((r) => (
                                <code
                                  key={r}
                                  className="bg-gray-100 px-1 py-0.5 mr-1 rounded inline-block mb-1"
                                >
                                  {r}
                                </code>
                              ))}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <span
                            className={`px-1.5 py-0.5 rounded ${
                              ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {ok ? "yes" : "no"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredActions.length && (
                    <tr>
                      <td className="px-2 py-2 text-gray-500" colSpan={3}>
                        No actions
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Raw context (folded) */}
          <section>
            <details>
              <summary className="cursor-pointer select-none font-semibold">
                Raw me context
              </summary>
              <pre className="mt-2 p-2 bg-gray-50 rounded overflow-auto text-[11px] leading-5">
                {JSON.stringify(me ?? null, null, 2)}
              </pre>
            </details>
          </section>
        </div>
      )}
    </div>
  );
};

export default PermissionDebugger;
