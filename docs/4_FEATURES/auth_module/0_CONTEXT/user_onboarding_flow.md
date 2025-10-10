# User Onboarding Flow Spec (KydoHub)

**Purpose:** Define the end-to-end onboarding flow for new users and tenants, aligned with Auth & RBAC design documents. This spec acts as context for LLM-assisted coding (Cursor, ChatGPT, etc.).

---

## 1. Entry Modes
- **Invite-only (default):** Admin sends invite → new user signs up via Supabase → `/auth/exchange` → backend creates/activates membership.
- **Founding tenant (first user):** If no membership exists, allow creating a new tenant via onboarding wizard (tenant details → seed roles → add first staff).
- **Public self-signup (future):** Supported later. Default new memberships to `pending` until approved.

---

## 2. Identity ↔ Membership Binding
- Supabase manages identity (`user_id`, credentials, MFA).
- Backend binds `user_id` → memberships in Mongo during `/auth/exchange`.
- If no membership found:
  - Founding flow: launch tenant creation wizard.
  - Otherwise: return error (“Ask your admin for an invite”).
- **Rule:** Never trust client `tenantId`; always inject server-side.

---

## 3. Role & Permission Seeding
- Seed roles per tenant: `owner`, `admin`, `teacher`, `assistant`, `parent`, `billing_manager`, `support_viewer`.
- Permissions use **`resource.action`** format (e.g., `staff.read`, `students.read`).
- Admin Staff persona initial scope: `staff.read`, `staff.create`, `staff.update`, `students.read`, `rooms.read`, `reporting.read`.

---

## 4. Tenant Selection Flow
- If multiple memberships:
  - Frontend shows tenant picker (tenant list from `/me/context`).
  - On selection → call `/auth/switch` → backend mints cookies with correct tenant → reload `/me/context`.

---

## 5. UI Rendering
- Frontend renders menus and buttons dynamically from server `ui_resources` in `/me/context`.
- Page ACL: requires read permission (e.g., `staff.read`).
- Action controls (buttons): require action permission (e.g., `staff.create`).

---

## 6. Security Defaults
- **Cookies:** HttpOnly + Secure + SameSite=Strict/Lax.
- **CSRF:** Double-submit token for unsafe methods.
- **Redis keys:**
  - `ev:{tenantId}:{userId}` → entitlement version
  - `permset:{tenantId}:{userId}` → cached permissions
  - `jti:block:{jti}` → revoked refresh tokens
- **Domains:** FE + API under `.kydohub.com` for cookie scope.
- **Audit logs:** Capture onboarding events (tenant created, invite accepted, role assigned).

---

## 7. ABAC Attributes (default)
- **Staff:** `rooms: [roomIds]`
- **Parents:** `guardianOf: [studentIds]`
- Services must enforce ABAC in addition to RBAC.

---

## 8. Acceptance Tests
1. **Founding flow:** New Supabase user → `/auth/exchange` → no membership → wizard → tenant created + `owner` role → dashboard loads.
2. **Invite flow:** Invited user signs up → `/auth/exchange` → membership `active` → `/me/context` returns correct menus.
3. **Tenant picker:** Multi-tenant user logs in → selects tenant → `/auth/switch` → menus update.
4. **RBAC propagation:** Admin edits role → backend updates perms + bumps EV → next API call returns 401 EV_OUTDATED → `/auth/refresh` → UI updates instantly.
5. **ABAC check:** Parent only sees their children’s records; teacher only accesses assigned rooms.
6. **Failure recovery:** Redis miss recomputes perms from DB; Supabase outage doesn’t break existing sessions until expiry.

---

## 9. Implementation Guardrails
- **Frontend:**
  - `TenantLayout` loads `/me/context` and enforces auth + tenant.
  - Sidebar renders dynamically from `ui_resources`.
- **Backend:**
  - Build `/auth/exchange`, `/auth/refresh`, `/auth/logout`, `/auth/switch`, `/me/context` first.
  - Guard order: Verify JWT → JTI check → EV compare → permset load → RBAC/ABAC enforcement.

