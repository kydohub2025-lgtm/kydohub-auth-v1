// src/lib/abac.ts
//
// Purpose
// -------
// Frontend ABAC helpers that derive *data-scope filters* from /me/context.
// RBAC gates the UI; ABAC limits what data we fetch/display per membership.
//
// Notes
// -----
// • Never hardcode policy; backend supplies attrs inside memberships.
// • Backend still enforces ABAC server-side. Frontend adds defense-in-depth.

type Dict = Record<string, any>;

// Minimal shape we read from /me/context; kept local to avoid import/alias issues.
interface MeLike {
  active?: { tenantId?: string };
  activeTenant?: { tenantId?: string }; // legacy fallback
  memberships?: Array<{
    tenantId: string;
    roles?: string[];
    attrs?: Dict; // e.g., { roomIds: [...], siteIds: [...] }
  }>;
}

export interface AbacFilterResult {
  filters: Dict;          // e.g. { tenantId: "xxx", roomId: { $in: [...] } }
  summary?: string;       // dev-only helper text
  unrestricted?: boolean; // true for owner/admin-like roles
}

/**
 * Build ABAC filters for a given entity (e.g., "students", "staff").
 * - Always includes tenantId
 * - Adds attribute-driven constraints (roomIds/siteIds) for non-admin roles
 */
export function getAbacFilters(me: MeLike | null | undefined, entity: string): AbacFilterResult {
  if (!me) return { filters: {}, summary: "no-context", unrestricted: false };

  const tenantId =
    me?.active?.tenantId ??
    me?.activeTenant?.tenantId;

  if (!tenantId) return { filters: {}, summary: "no-tenant", unrestricted: false };

  const membership = me?.memberships?.find((m) => m.tenantId === tenantId);
  if (!membership) return { filters: {}, summary: "no-membership", unrestricted: false };

  const roles = membership.roles ?? [];
  const isAdmin =
    roles.includes("owner") ||
    roles.includes("admin") ||
    roles.includes("superadmin");

  if (isAdmin) {
    return {
      filters: { tenantId },
      summary: `tenant=${tenantId} (unrestricted: admin)`,
      unrestricted: true,
    };
  }

  const attrs: Dict = membership.attrs ?? {};
  const filters: Dict = { tenantId };

  // Heuristic per-entity mappings (extend safely as features grow)
  switch (entity) {
    case "students":
      if (Array.isArray(attrs.roomIds) && attrs.roomIds.length) {
        filters.roomId = { $in: attrs.roomIds };
      }
      break;
    case "staff":
      if (Array.isArray(attrs.siteIds) && attrs.siteIds.length) {
        filters.siteId = { $in: attrs.siteIds };
      }
      break;
    case "attendance":
      if (Array.isArray(attrs.roomIds) && attrs.roomIds.length) {
        filters.roomId = { $in: attrs.roomIds };
      }
      break;
    default:
      // keep only tenantId by default
      break;
  }

  const summary = Object.keys(filters)
    .map((k) => `${k}=${JSON.stringify(filters[k])}`)
    .join(", ");

  return { filters, summary, unrestricted: false };
}

/** Convenience: just the params object for API calls. */
export function abacParams(me: MeLike | null | undefined, entity: string): Dict {
  return getAbacFilters(me, entity).filters;
}

/** Dev-only logger to visualize current ABAC scope. */
export function debugAbac(me: MeLike | null | undefined, entity: string) {
  if (import.meta.env.MODE !== "development") return;
  const r = getAbacFilters(me, entity);
  console.log(`[ABAC] ${entity}:`, r.summary ?? r.filters);
}

export default { getAbacFilters, abacParams, debugAbac };
