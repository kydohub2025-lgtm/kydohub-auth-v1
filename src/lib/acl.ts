// src/lib/acl.ts
//
// Purpose
// -------
// Centralized permission helpers for RBAC in the frontend.
// Works purely on the /me/context payload and never calls the network.
// All UI gating (menus, routes, buttons) should go through these helpers.
//
// Key ideas
// ---------
// • We treat permissions as simple strings (e.g., "students.view", "students.create").
// • ui_resources.pages[] and ui_resources.actions[] reference those permission strings
//   using a `requires: string[] | null` field.
// • If `requires` is missing, null, or an empty array, we allow by default
//   (user is authenticated; backend still enforces authorization on APIs).
// • Deny-by-default is enforced naturally when a page/action defines non-empty `requires`
//   and the user lacks at least one required permission.
//
// Non-developer tip
// -----------------
// You’ll mostly use `allowPage(me, "pageId")` and `allowAction(me, "actionId")`.
// For showing/hiding a button, wrap with a small component (coming next) or call
// `allowAction()` inline.
//
// Types are defensive so missing fields don’t crash the app.
//
// Dependencies
// ------------
// None (pure TypeScript). Consumed by PermissionDebugger, <Acl>, nav builders, etc.

type MaybeArray<T> = T | T[];

// Minimal shape we expect from /me/context.
// We keep this loose to avoid tight coupling with backend DTOs.
export type MeLike = {
  permissions?: string[]; // flattened effective permissions
  auth?: { permissions?: string[] }; // fallback if nested under auth
  ui_resources?: {
    pages?: Array<{ id: string; requires?: string[] | null }>;
    actions?: Array<{ id: string; requires?: string[] | null }>;
  };
  uiResources?: {
    pages?: Array<{ id: string; requires?: string[] | null }>;
    actions?: Array<{ id: string; requires?: string[] | null }>;
  };
  // Optional "ev" (epoch/version) fields might exist but are not required here.
};

// ---------- internal getters (null-safe) ----------

function getEffectivePermissions(me?: MeLike | null): string[] {
  if (!me) return [];
  const direct = Array.isArray(me.permissions) ? me.permissions : null;
  const nested = Array.isArray(me.auth?.permissions) ? me.auth?.permissions : null;
  const perms = direct ?? nested ?? [];
  // Normalize and de-duplicate
  const set = new Set(perms.filter((p) => typeof p === "string" && p.trim().length > 0));
  return Array.from(set);
}

type UIEntry = { id: string; requires?: string[] | null };

function getUIPages(me?: MeLike | null): UIEntry[] {
  const src =
    (me?.ui_resources?.pages ?? me?.uiResources?.pages) ?? [];
  return Array.isArray(src)
    ? src
        .filter((p) => p && typeof p.id === "string" && p.id.trim().length > 0)
        .map((p) => ({ id: p.id, requires: normalizeRequires(p.requires) }))
    : [];
}

function getUIActions(me?: MeLike | null): UIEntry[] {
  const src =
    (me?.ui_resources?.actions ?? me?.uiResources?.actions) ?? [];
  return Array.isArray(src)
    ? src
        .filter((a) => a && typeof a.id === "string" && a.id.trim().length > 0)
        .map((a) => ({ id: a.id, requires: normalizeRequires(a.requires) }))
    : [];
}

function normalizeRequires(req?: MaybeArray<string> | null): string[] | null {
  if (!req) return null; // interpret as "no requirements"
  if (Array.isArray(req)) {
    const cleaned = req
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned : null;
  }
  // single string
  const s = String(req).trim();
  return s ? [s] : null;
}

// ---------- exported low-level set helpers ----------

/**
 * Return true if `perm` exists in the `have` set.
 */
export function hasPerm(have: string[] = [], perm: string): boolean {
  if (!perm) return false;
  return have.includes(perm);
}

/**
 * Return true if all required perms exist in the `have` set.
 * Empty/undefined `need` returns true.
 */
export function requireAll(have: string[] = [], need?: string[] | null): boolean {
  if (!need || need.length === 0) return true;
  for (const p of need) {
    if (!have.includes(p)) return false;
  }
  return true;
}

/**
 * Return true if any required perm exists in the `have` set.
 * Empty/undefined `need` returns true.
 */
export function requireAny(have: string[] = [], need?: string[] | null): boolean {
  if (!need || need.length === 0) return true;
  for (const p of need) {
    if (have.includes(p)) return true;
  }
  return false;
}

// ---------- primary RBAC checks (pages & actions) ----------

/**
 * Returns true if the user can access a page by its id.
 * Strategy: if page has no `requires`, allow.
 * If it has `requires`, requireAll() must pass.
 */
export function allowPage(me: MeLike | null | undefined, pageId: string): boolean {
  if (!pageId) return false;
  const pages = getUIPages(me);
  const found = pages.find((p) => p.id === pageId);
  if (!found) {
    // Page id not defined by server: fail safe (hide it).
    return false;
  }
  const have = getEffectivePermissions(me);
  const need = found.requires;
  return requireAll(have, need);
}

/**
 * Returns true if the user can perform an action by its id.
 * Strategy: if action has no `requires`, allow.
 * If it has `requires`, requireAll() must pass.
 */
export function allowAction(me: MeLike | null | undefined, actionId: string): boolean {
  if (!actionId) return false;
  const actions = getUIActions(me);
  const found = actions.find((a) => a.id === actionId);
  if (!found) {
    // Unknown action id: fail safe
    return false;
  }
  const have = getEffectivePermissions(me);
  const need = found.requires;
  return requireAll(have, need);
}

// ---------- verbose helpers (optional, useful in dev) ----------

export type DenyReason =
  | "UNKNOWN_ENTRY"
  | "MISSING_PERMISSIONS"
  | "NO_CONTEXT";

/**
 * Returns {ok, reason, missing[]} for pages.
 * ok=true when allowed; otherwise reason explains why and missing lists unmet perms.
 */
export function whyPageDenied(
  me: MeLike | null | undefined,
  pageId: string
): { ok: boolean; reason?: DenyReason; missing?: string[] } {
  if (!me) return { ok: false, reason: "NO_CONTEXT" };
  const pages = getUIPages(me);
  const found = pages.find((p) => p.id === pageId);
  if (!found) return { ok: false, reason: "UNKNOWN_ENTRY" };
  const have = getEffectivePermissions(me);
  const need = found.requires ?? [];
  const missing = (need ?? []).filter((p) => !have.includes(p));
  return missing.length ? { ok: false, reason: "MISSING_PERMISSIONS", missing } : { ok: true };
}

/**
 * Returns {ok, reason, missing[]} for actions.
 * ok=true when allowed; otherwise reason explains why and missing lists unmet perms.
 */
export function whyActionDenied(
  me: MeLike | null | undefined,
  actionId: string
): { ok: boolean; reason?: DenyReason; missing?: string[] } {
  if (!me) return { ok: false, reason: "NO_CONTEXT" };
  const actions = getUIActions(me);
  const found = actions.find((a) => a.id === actionId);
  if (!found) return { ok: false, reason: "UNKNOWN_ENTRY" };
  const have = getEffectivePermissions(me);
  const need = found.requires ?? [];
  const missing = (need ?? []).filter((p) => !have.includes(p));
  return missing.length ? { ok: false, reason: "MISSING_PERMISSIONS", missing } : { ok: true };
}

// ---------- exports that might help elsewhere ----------

export const ACL = {
  getEffectivePermissions,
  getUIPages,
  getUIActions,
  hasPerm,
  requireAll,
  requireAny,
  allowPage,
  allowAction,
  whyPageDenied,
  whyActionDenied,
};

export default ACL;
