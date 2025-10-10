---

# Backend Guard Rules (AuthN, EV, RBAC, ABAC)

> Purpose: a single source of truth for how **every** protected FastAPI route must authenticate and authorize requests. Aligns with `auth/deps.py`, `rbac/permissions.py`, `rbac/abac.py`, and the API/error contracts.

## 1) Guard Chain (must run in this order)

1. **Extract session**

   * **Web**: `kydo_sess` cookie.
   * **Mobile/Service**: `Authorization: Bearer <jwt>`.
   * If missing/invalid → **401 EXPIRED** (no refresh attempted here).

2. **Verify JWT**

   * Verify signature (`RS256`) with `JWT_PUBLIC_KEY`.
   * Required claims: `sub` (userId), `tid` (tenantId), `ev` (epoch/version), `jti` (token id).
   * Missing claims → **401 INVALID_TOKEN**.

3. **Revocation (JTI blocklist)**

   * Check `jti:block` (Redis set). Member present → **401 EXPIRED**.

4. **EV freshness (role/version drift)**

   * Read `ev:{tenantId}:{userId}` from Redis (optional).
   * If server EV > token EV → **401 EV_OUTDATED** (client will call `/auth/refresh`, then retry).

5. **Membership & Roles**

   * Load `memberships` by `{tenantId, userId}`; if none → **403 PERMISSION_DENIED**.
   * Load `roles` by `{tenantId, name: {$in: membership.roles}}`; **flatten** `permissions[]`.

6. **RBAC check (coarse)**

   * Route declares minimal required permission(s) via `requires("resource.action", …)`.
   * If caller lacks any listed permission → **403 PERMISSION_DENIED**.

7. **ABAC scoping (fine)**

   * Build query filters or resource checks using `membership.attrs`:

     * Staff: `rooms[]`
     * Parent: `guardianOf[]`
   * Prefer allow-list filters; avoid post-filtering after data is loaded.

8. **Tenant enforcement**

   * Never accept tenantId from client for auth decisions.
   * Use `claims.tid` (from JWT) and injected `tenantId` in all DB queries.

9. **Proceed to handler**

   * Expose `AuthzContext` on `request.state.authz` for business logic.

> **Invariant**: All **writes** must pass RBAC and ABAC; reads should be **least-privilege filtered**.

---

## 2) Route Authoring Rules

* **Always** include a guard dependency:

  ```python
  @router.get("/students/list")
  async def list_students(
      ctx = Depends(requires("students.list_all","students.list_room","students.list_guardian")),
      authz = Depends(get_authz)
  ):
      ...
  ```
* Never trust client-provided tenant/user IDs; derive from `authz.principal`.
* For multi-tenant users, `/auth/switch` re-mints claims; handlers should not accept manual “switch” inputs.
* If a route can return **zero** results due to ABAC, prefer empty arrays over 403, unless the action itself is disallowed.

---

## 3) Error Semantics (uniform)

* Use the envelope from `api_error_contracts.md`:

  * **401**: `EXPIRED` | `EV_OUTDATED` | `INVALID_TOKEN`
  * **403**: `PERMISSION_DENIED` | `CSRF_FAILED`
* Do **not** leak internal reasons (no “role X missing Y” in messages).
* For EV drift, **only** return `EV_OUTDATED` (never rotate inside protected routes).

---

## 4) Cache & Fallback Rules

* Redis is **optional**. If unavailable:

  * JTI check → treat as **not blocked** (favor availability, audit separately).
  * EV read → assume **fresh** (do not block); actual refresh will happen once EV is visible again.
  * Permissions cache (`permset:*`) is an optimization only; recompute from Mongo on miss.
* Never store PII in Redis values; use token ids and permission sets only.

---

## 5) ABAC Patterns (server-side only)

* **Students list**

  * `students.list_all` → `{"tenantId": tid}`
  * `students.list_room` → `{"tenantId": tid, "currentRoomId": {"$in": rooms}}`
  * `students.list_guardian` → `{"tenantId": tid, "_id": {"$in": guardianOf}}`
* **Student view by id**

  * Allowed if:

    * `students.view_all`, or
    * `students.view_room` AND student.currentRoomId ∈ rooms, or
    * `students.view_guardian` AND student._id ∈ guardianOf
* Always combine with `tenantId` first in the query predicate.

---

## 6) CSRF, CORS, and Cookies (web-only)

* State-changing routes must pass the CSRF middleware (double-submit token + Origin/Referer).
* Do not rotate cookies on CSRF failures; return **403 CSRF_FAILED**.
* All protected responses must include security headers:

  * `X-Content-Type-Options: nosniff`
  * `X-Frame-Options: DENY`
  * `Referrer-Policy: strict-origin-when-cross-origin`
  * CSP enforced at CDN/gateway.

---

## 7) Logging & Observability

* Attach to each request log:

  * `requestId` (from `X-Request-ID` or generated)
  * `tenantId`, `userId` (from claims)
  * `route`, `operationId`, `status`, `durationMs`
* Metrics to emit:

  * Exchange/Refresh success rate & latency
  * `EV_OUTDATED` rate
  * 401/403 counts by route
  * Redis hit/miss ratios
* Never log raw tokens or cookies. Truncate IDs after a few chars for correlation.

---

## 8) Rate Limiting & Abuse

* Apply per-IP and per-`userId` limits to `/auth/exchange`, `/auth/refresh`, `/auth/logout`, `/auth/switch`.
* On throttle, return **429 RATE_LIMITED** with `Retry-After` header.
* Brute-force indicators should trigger JTI mass-block (logout-all) runbook.

---

## 9) Testing Rules (map to acceptance docs)

* Unit-test the guard chain with:

  * Missing cookie/header → **401 EXPIRED**
  * Bad signature / missing claims → **401 INVALID_TOKEN**
  * JTI blocked → **401 EXPIRED**
  * EV outdated → **401 EV_OUTDATED**
  * No membership → **403 PERMISSION_DENIED**
  * RBAC pass + ABAC filter yields only scoped data
  * Redis down → route still passes within latency budget
* Contract-test error envelope structure and headers (`X-Request-ID`, `Cache-Control:no-store`).

---

## 10) Performance Targets

* Guard chain overhead (decoded + membership/roles + rbac) **≤ 20ms P50**, **≤ 60ms P95** with warm Redis.
* Mongo-only fallback: **≤ 150ms P95** for membership/roles load.
* EV check and JTI set operations should be **O(1)** and non-blocking.

---

## 11) Definition of Done (backend)

* Every protected router uses `requires(...)` + `get_authz`.
* All errors conform to the envelope; no plaintext/body variations.
* ABAC filters implemented for students; patterns replicated for other resources.
* CSRF middleware active; CORS allow-list strict; cookies attributes correct.
* Observability and rate limiting in place for `/auth/*`.
* Redis absence does not break any route; latency stays within budget.

---
