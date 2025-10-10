Here you go—ready to drop in.

**Path:**
`docs/4_FEATURES/auth_onboarding/2_REQUIREMENTS/acceptance_auth_flows.md`

---

# Authentication & Onboarding – Acceptance Flows

> Scope: Web (React on Cloudflare Pages, cookie sessions) + Mobile (Bearer tokens).
> Tenants: multi-tenant users supported via `/auth/switch`.
> Context driver: `/me/context` (roles, permissions, ui_resources, ABAC).

## 0) Test Preconditions

* **Domains:** `app.kydohub.com` (FE), `api.kydohub.com` (BE). Cookies scoped to `.kydohub.com`.
* **CORS:** allow-list includes FE origins; `Allow-Credentials: true`.
* **Seed data:**

  * Tenant `t1` “Sunrise Daycare”, Tenant `t2` “Bright Kids”.
  * Roles: `owner`, `admin`, `teacher`, `assistant`, `parent` with permissions seeded.
  * `ui_resources` for each tenant (pages/actions).
  * Users:

    * `u_owner` (owner in `t1`)
    * `u_teacher` (teacher in `t1`, `attrs.rooms=["room-a","room-b"]`)
    * `u_parent` (parent in `t1`, `attrs.guardianOf=["stu-101"]`)
    * `u_multi` (teacher in `t1`, assistant in `t2`)
* **Supabase:** valid logins for the above (email/password or OAuth) to produce a **Supabase access token**.
* **CSRF:** backend sets `kydo_csrf`; FE must echo `X-CSRF-Token` on state-changing calls.
* **Redis (optional):** available for EV/JTI caches; tests also cover outage.

---

## 1) Web – Login/Exchange/Context (Happy Path)

**Given** a user signs in via Supabase on `app.kydohub.com` and obtains `supabase_access_token`
**When** FE `POST /auth/exchange` with `{ provider:"supabase", token, device:{client:"web"} }`
**Then** BE returns **204** and sets cookies `kydo_sess` (HttpOnly), `kydo_refresh` (HttpOnly, path `/auth/refresh`, SameSite=Strict), and `kydo_csrf` (readable).
**And** FE calls `GET /me/context` and receives roles, permissions, `ui_resources`, ABAC hints.
**And** Protected pages render per `ui_resources.pages`; gated actions appear enabled only when permitted.

**Acceptance checks**

* Cookies have `Secure`, `HttpOnly` (except `kydo_csrf`), proper domain `.kydohub.com`.
* `me/context` schema matches `me_context_schema.json`.
* First guarded API call succeeds with `credentials:'include'` and `X-CSRF-Token`.

---

## 2) Mobile – Login/Exchange/Context (Happy Path)

**Given** a user signs in via Supabase in the mobile app and obtains `supabase_access_token`
**When** app `POST /auth/exchange` with `{ device:{client:"mobile"} }`
**Then** BE returns **200** JSON with `{ tokenType:"Bearer", access, expiresIn, refresh, tenant }`
**And** app stores `refresh` in secure storage and uses `Authorization: Bearer <access>`
**And** `GET /me/context` returns the correct context.

**Acceptance checks**

* No cookies set; all subsequent calls use `Authorization`.
* Context matches the same tenant membership as web.

---

## 3) Multi-Tenant – Tenant Choice on Exchange

**Given** `u_multi` belongs to two tenants
**When** FE `POST /auth/exchange` without `tenantHint`
**Then** BE returns **209 Tenant Choice** with `tenants[]` (no cookies yet).
**When** user selects a tenant and FE `POST /auth/switch` with `{tenantId:"t2"}`
**Then** web: **204** with reminted cookies; mobile: **200** with tokens;
**And** `GET /me/context` shows the chosen tenant’s roles/pages.

---

## 4) Tenant Switch (In-Session)

**Given** a logged-in web user with memberships in `t1` and `t2`
**When** FE `POST /auth/switch` with `{tenantId:"t2"}` including `X-CSRF-Token`
**Then** **204**, cookies reminted, `GET /me/context` reflects `t2`
**And** UI menu/actions adjust to `t2`’s `ui_resources`.

---

## 5) EV Outdated → Silent Refresh

**Given** `u_teacher` is logged in and role permissions are updated server-side (EV bumped)
**When** next protected API call occurs
**Then** BE returns **401** with `{error.code:"EV_OUTDATED"}`
**And** FE automatically calls `POST /auth/refresh` (with CSRF)
**And** retry of the original request succeeds
**And** `GET /me/context` now reflects updated permissions/UI.

**Acceptance checks**

* Only **one** automatic retry occurs after refresh.
* If refresh fails, user sees a neutral session-expired prompt.

---

## 6) CSRF Enforcement (Web)

**Given** a logged-in web session
**When** FE sends a **POST** without `X-CSRF-Token` or with a mismatched token
**Then** BE returns **403** with `{error.code:"CSRF_FAILED"}`
**And** no state change is performed.

**Acceptance checks**

* `Origin`/`Referer` must match allowed origins.
* GET/HEAD/OPTIONS are not blocked for missing CSRF.

---

## 7) Redis Outage – Graceful Fallback

**Given** Redis becomes unavailable
**When** a protected route is called
**Then** BE still verifies JWT and recomputes permissions from Mongo
**And** response time remains within **≤800ms P95@50RPS** on the test rig
**And** write paths that rely on cache for safety (if any) fail closed with a safe error.

---

## 8) Parent Data Scoping (ABAC)

**Given** `u_parent` has `attrs.guardianOf=["stu-101"]`
**When** `GET /students/list` is called
**Then** only student `stu-101` appears
**And** attempts to access other student IDs return `403 PERMISSION_DENIED` or empty results (per route policy).

---

## 9) Staff Data Scoping (ABAC)

**Given** `u_teacher` has `attrs.rooms=["room-a","room-b"]`
**When** `GET /students/list` is called
**Then** only students whose `currentRoomId ∈ {room-a, room-b}` are returned
**And** viewing a student outside these rooms is blocked unless permission `students.list_all` exists.

---

## 10) Logout

**Web**

* **When** `POST /auth/logout` with `X-CSRF-Token`
* **Then** **204** and cookies cleared; next protected call returns **401 EXPIRED**.

**Mobile**

* **When** app deletes stored tokens and (optionally) calls `/auth/logout` to add JTI to blocklist
* **Then** next call with the old access token returns **401 EXPIRED**.

---

## 11) Invalid/Expired Refresh

**Given** a tampered/expired `kydo_refresh` (web) or stale `refresh` (mobile)
**When** `POST /auth/refresh`
**Then** **401** with `{error.code:"EXPIRED"}`
**And** FE presents a neutral “Please sign in again” flow (no user enumeration).

---

## 12) Invite Acceptance → Membership Creation

**Given** an invite is accepted (web or mobile) and user authenticates with Supabase
**When** FE calls `/auth/exchange` with the token
**Then** backend ensures `users` exists and creates/updates `memberships` with invited roles
**And** `GET /me/context` includes the new roles/pages.

---

## 13) Security Headers

**When** any response is served
**Then** `X-Content-Type-Options:nosniff`, `X-Frame-Options:DENY`, `Referrer-Policy:strict-origin-when-cross-origin` are present
**And** CSP is enforced at CDN/gateway level (policy documented in design).

---

## 14) Error Semantics (Consistent Envelope)

For any failure above, responses conform to:

```json
{ "error": { "code": "EXPIRED|EV_OUTDATED|PERMISSION_DENIED|INVALID_TOKEN|TENANT_REQUIRED|CSRF_FAILED", "message": "..." } }
```

**Acceptance checks**

* Status codes match the API spec (`401`, `403`, `209`, etc.).
* No sensitive details in messages; neutral phrasing.

---

## 15) Observability (Tracing & Metrics)

**Given** requests include `X-Request-ID` from FE
**Then** logs contain `requestId`, `tenantId`, `userId`, `operationId` where applicable
**And** metrics dashboards show:

* Exchange/Refresh success rates and latencies
* EV_OUTDATED rate
* Redis hit/miss ratio
* 401/403 distribution

---

## Exit Criteria (Feature Shippable)

* All scenarios 1–15 pass in **staging** with real Supabase + Mongo Atlas.
* Web cookies behave across `app.kydohub.com` ↔ `api.kydohub.com` (SameSite + CSRF verified).
* Mobile bearer flow verified on at least one iOS and one Android build.
* Redis outage test meets latency budget, or documented exemption with mitigation.
* No hardcoded UI gates; all menus/actions derive from `/me/context`.

---

**End of file.**