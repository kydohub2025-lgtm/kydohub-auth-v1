// src/components/auth/TenantSwitcher.tsx
//
// Purpose
// -------
// Production-safe tenant switch control. It lists the user’s memberships from MeContext,
// highlights the active tenant, and switches via POST /auth/switch using our
// src/lib/auth/actions.ts helpers. After a successful switch it waits for
// `auth:refreshed` so that MeContext has finished refetching /me/context.
//
// Why this belongs in /components/auth
// ------------------------------------
// Reusable across layouts (navbar, sidebar, account menu) with minimal props.
// No vendor UI libs required; works with plain HTML and Tailwind.
//
// Security / UX notes
// -------------------
// • Shows only tenants the server returned in /me/context (no client-side guessing).
// • Disables interaction while a switch is in-flight to prevent double submits.
// • Gracefully handles the case where there’s only one membership.
//
// Non-developer tip
// -----------------
// Drop <TenantSwitcher/> anywhere after <MeProvider/> has mounted.
// You don’t need to manually refresh pages after switching; the component
// waits for MeContext to reload automatically.
//
// Optional styling
// ----------------
// Replace the <select> with your design system control later; the logic stays the same.

import React, { useMemo, useState } from "react";
import * as Auth from "@/lib/auth/actions";
import { waitForAuthRefreshed } from "@/lib/auth/events";
import { useMe } from "@/context/MeContext";

type Membership = {
  tenantId: string;
  tenantCode?: string;
  tenantName?: string;
  roles?: string[];
};

type Props = {
  /** Optional: compact mode for tight headers */
  size?: "sm" | "md";
  /** Called after the context has refreshed post-switch (e.g., to close a menu) */
  onSwitched?: (tenantId: string) => void;
  /** Optional: override label text */
  label?: string;
};

export const TenantSwitcher: React.FC<Props> = ({ size = "md", onSwitched, label }) => {
  const { me, loading: meLoading } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive memberships + active tenant id from MeContext with defensive fallbacks.
  const { memberships, activeTenantId } = useMemo(() => {
    // We expect a shape like:
    // me: {
    //   active: { tenantId, tenantCode?, tenantName? },
    //   memberships: Array<{ tenantId, tenantCode?, tenantName?, roles? }>
    // }
    const activeTenantId =
      (me as any)?.active?.tenantId ??
      (me as any)?.activeTenantId ??
      null;

    const memberships: Membership[] =
      (me as any)?.memberships ??
      (me as any)?.tenants ??
      [];

    return { memberships, activeTenantId };
  }, [me]);

  const options = useMemo(() => {
    return (memberships as Membership[]).map((m) => ({
      id: m.tenantId,
      label: m.tenantName ?? m.tenantCode ?? m.tenantId,
    }));
  }, [memberships]);

  const hasMultiple = options.length > 1;

  async function handleChange(nextTenantId: string) {
    if (!nextTenantId || nextTenantId === activeTenantId) return;
    setBusy(true);
    setError(null);
    try {
      await Auth.switchTenant(nextTenantId);
      // Wait until MeContext emits auth:refreshed (refetch done).
      await waitForAuthRefreshed(5000);
      onSwitched?.(nextTenantId);
    } catch (e: any) {
      const msg =
        e?.error?.message ||
        e?.message ||
        "Failed to switch tenant. Please try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (meLoading) {
    return (
      <div className="inline-flex items-center text-sm opacity-60">
        Loading tenants…
      </div>
    );
  }

  if (!options.length) {
    // Unusual: no memberships — show a safe placeholder.
    return (
      <div className="inline-flex items-center text-sm opacity-60">
        No tenants
      </div>
    );
  }

  const selectCls =
    size === "sm"
      ? "h-8 px-2 py-1 text-sm border rounded"
      : "h-10 px-3 py-2 text-base border rounded";

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">
        {label ?? "Tenant"}
      </label>
      <select
        className={`${selectCls} disabled:opacity-60`}
        value={activeTenantId ?? ""}
        disabled={!hasMultiple || busy}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Active tenant"
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      {!hasMultiple && (
        <span className="text-[11px] text-gray-500">
          You only belong to one tenant.
        </span>
      )}

      {error && (
        <div className="text-xs text-red-600" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default TenantSwitcher;
