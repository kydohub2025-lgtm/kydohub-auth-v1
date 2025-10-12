---

# Authentication Design — Part 2 (Updated)

> Scope: RBAC catalog, ABAC patterns, UI mapping, seeding & migrations, EV/versioning rules, observability & dashboards, rate limits, resilience, incident runbooks, and testing plan. Complements **Part 1**.

---

## 1) RBAC Catalog (Roles → Permissions)

> Permissions are flat strings `resource.action`. Roles are per-tenant (can override defaults). Keep roles small and legible.

### 1.1 Canonical permissions (initial set)

* **Tenant administration**

  * `tenant.manage`, `roles.read`, `roles.write`, `memberships.read`, `memberships.write`, `ui_resources.write`
* **Students**

  * `students.view`, `students.list_all`, `students.list_room`, `students.list_guardian`, `students.create`, `students.update`
* **Attendance**

  * `attendance.view`, `attendance.mark`, `attendance.export`
* **Messaging**

  * `messages.view`, `messages.send`
* **Rooms**

  * `rooms.view`, `rooms.assign`
* **Billing (optional)**

  * `billing.view`, `billing.manage`
* **Support**

  * `support.readonly`

> Add more per feature as you grow; keep each new permission to `domain.verb`.

### 1.2 Default roles (seed values)

| Role              | Permissions (subset)                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`           | all permissions (superuser for tenant)                                                                                                                                      |
| `admin`           | tenant.manage, roles.read/write, memberships.read/write, ui_resources.write, students.view/list_all/create/update, attendance.view/export, messages.view, rooms.view/assign |
| `teacher`         | students.view, students.list_room, attendance.view, attendance.mark, messages.send                                                                                          |
| `assistant`       | students.view, students.list_room, attendance.view                                                                                                                          |
| `parent`          | students.view, students.list_guardian, messages.send                                                                                                                        |
| `billing_manager` | billing.view, billing.manage                                                                                                                                                |
| `support_viewer`  | support.readonly (no PII writes; limited visibility per support policy)                                                                                                     |

> Tenants may later add custom roles; keep the structure identical: `{tenantId, name, permissions[]}`.

---

## 2) ABAC Patterns (Attributes → Data Scope)

* **Staff**: `attrs.rooms[]` limits lists to students currently in those rooms.
* **Parents**: `attrs.guardianOf[]` limits lists/views to specific student IDs.
* **Admins/Owners**: permissions such as `students.list_all` bypass ABAC restrictions for read-paths.

**Server rules**

* ABAC filtering is enforced **in queries** (not after fetching).
* For “view by id” routes, verify membership via room or guardian relationship if `*_all` permission is absent.

---

## 3) UI Mapping (Server-owned `ui_resources` → Frontend)

> The frontend never hardcodes gates; it renders menus and enables actions from `ui_resources`, validated against `permissions[]` from `/me/context`.

### 3.1 Pages (examples)

```json
{
  "pages": [
    { "id": "dashboard",  "title": "Dashboard",  "requires": [] , "path": "/dashboard" },
    { "id": "students",   "title": "Students",   "requires": ["students.view"], "path": "/students" },
    { "id": "attendance", "title": "Attendance", "requires": ["attendance.view"], "path": "/attendance" },
    { "id": "admin",      "title": "Admin",      "requires": ["tenant.manage"], "path": "/admin" }
  ],
  "actions": [
    { "id": "attendance.mark", "requires": ["attendance.mark"] },
    { "id": "student.create",  "requires": ["students.create"] }
  ]
}
```

**Conventions**

* Every page/action must list concrete `requires` permissions (empty array means public after login).
* IDs are stable strings consumed by the FE (e.g., to map to routes/icons).

---

## 4) Seeding & Migrations

### 4.1 Seed scripts (per tenant)

1. Insert **default roles** with permission arrays.
2. Insert **ui_resources** (pages/actions).
3. On founding tenant: create **owner membership** for the founder.

### 4.2 Migration principles

* **Add permission**: ship backend checks first (tolerant), then update roles, then bump `ui_resources.version`.
* **Rename/deprecate**: support old + new for one deployment, sweep role docs, then remove old.
* **Indexes** (authz collections):

  * `memberships`: `{ tenantId:1, userId:1 }` unique
  * `roles`: `{ tenantId:1, name:1 }` unique
  * `ui_resources`: `{ tenantId:1 }`
  * `refresh_sessions` (optional): `{ tenantId:1, userId:1, jti:1, expiresAt:1 }`

---

## 5) EV (Epoch/Version) & Invalidations

**When to bump `ev:{tenantId}:{userId}`**

* Roles on a membership change (add/remove role).
* The permissions list on any **role** used by the user changes.
* `ui_resources` change that materially hides/shows capabilities (optional, if FE caches).

**Bump sources**

* Admin role editor
* Invite acceptance / tenant switch seeding
* Background syncs (e.g., guardian link updates)

**Client behavior**

* On **401 `EV_OUTDATED`** the FE/mobile calls `/auth/refresh` once, then retries original request.

---

## 6) Observability & Dashboards

**Structured logs (per request)**

* `timestamp`, `requestId`, `route`, `method`, `status`, `durationMs`
* `tenantId`, `userId` (from claims), `client` (web/mobile), `operationId` (for critical paths)
* Error logs include `error.code`, never include tokens/cookies or PII.

**Key metrics**

* **Exchange**: success rate, P50/P95 latency
* **Refresh**: rotate success rate, P50/P95 latency
* **EV_OUTDATED rate**: percentage of requests that require refresh
* **401/403 counts**: by route
* **Redis**: hit/miss %, command latencies
* **DB**: membership+roles load time P50/P95

**Alert thresholds (starter)**

* Exchange or Refresh success rate < 98% (5m)
* EV_OUTDATED > 3% sustained (15m)
* Redis MISS > 40% sustained (15m)
* `/me/context` P95 > 300ms (15m)

---

## 7) Rate Limiting (Auth endpoints)

> Apply per-IP and per-user (after authentication when possible).

| Endpoint              |  Per-IP | Per-User | Notes                                            |
| --------------------- | ------: | -------: | ------------------------------------------------ |
| `POST /auth/exchange` |  20/min |   10/min | backoff 60s on exceed                            |
| `POST /auth/refresh`  |  60/min |   20/min | rotates refresh; suspicious spikes trigger alert |
| `POST /auth/logout`   |  30/min |   10/min |                                                  |
| `POST /auth/switch`   |  30/min |   15/min |                                                  |
| `GET /me/context`     | 120/min |   60/min | not strict; cache on FE if needed                |

On throttle, return **429 RATE_LIMITED** + `Retry-After`.

---

## 8) Resilience & Fallbacks

**Redis unavailable**

* JTI blocklist → treated as not blocked (favor availability; audit anomaly)
* EV read → assume fresh (clients will get updated once Redis recovers)
* Permset cache → recompute from Mongo; target ≤150ms P95

**Mongo transient failure**

* Fail-safe for writes (deny changes); reads return **503** with neutral message; alert immediately.

**Cookie/clock skew**

* Accept small `iat/exp` skew (±120s) on JWT; log anomalies.

---

## 9) Incident Runbooks

### 9.1 Compromised account / token leakage

1. Identify `userId`, `tenantId`, suspicious `jti`.
2. Add `jti` to `jti:block`.
3. Bump `ev:{tid}:{uid}`.
4. Force password reset in Supabase and re-verify devices.
5. Review audit logs for membership/role changes.

### 9.2 Mass role misconfiguration (bad deploy)

1. Roll back `roles` changes (deploy rollback or seed fix).
2. Bump **EV for affected users** (or whole tenant if easier).
3. Verify `/me/context` matches expected UI.
4. Postmortem: improve migration guardrails.

### 9.3 CSRF failures spike

1. Check CORS allow-list drift and CDN rules.
2. Verify `kydo_csrf` creation path and cookie attributes.
3. Inspect referrers for unexpected origins.
4. Consider rotating CSRF cookie for affected users.

### 9.4 Redis outage

1. Confirm fallbacks active; latency within budget.
2. Suppress EV/JTI dependent alerts temporarily.
3. After recovery, check EV drift and recompute caches where needed.

### 9.5 Key rotation (JWT)

1. Publish new `JWT_PUBLIC_KEY`; start signing with new private key.
2. Overlap both keys for `N` hours.
3. Invalidate old **refresh** tokens if high risk, otherwise allow normal rotation window.
4. Communicate maintenance window if needed.

---

## 10) Privacy, Audit & Retention

* **Audit events** (store per tenant):

  * `auth.exchange`, `auth.refresh`, `auth.logout`, `auth.switch`
  * `roles.updated`, `membership.updated`, `invite.accepted`
* **Personal data**: keep minimal in auth logs; prefer `userId` & `email hash` only.
* **Retention**:

  * Auth logs: 90 days (configurable)
  * `refresh_sessions`: TTL on `expiresAt`, or 30–90 days if auditing required

---

## 11) Logging Schema (suggested)

```json
{
  "ts": "2025-10-10T17:02:11.123Z",
  "level": "info",
  "requestId": "uuid",
  "route": "POST /auth/exchange",
  "status": 204,
  "durationMs": 83,
  "tenantId": "t1",
  "userId": "sbp_2c1...",
  "client": "web",
  "operationId": "auth.exchange"
}
```

Errors add:

```json
{
  "level": "warn",
  "error": { "code": "EV_OUTDATED", "message": "..." }
}
```

---

## 12) Mobile-Specific Notes

* Store **refresh** in Keychain/Keystore; keep **access** in memory only.
* Attach `Authorization: Bearer <access>` + `X-Client: mobile`.
* On `401`, rotate via `/auth/refresh` once, then reattempt.
* Consider device name in `DeviceInfo` during exchange for session management UX.

---

## 13) Testing Plan (beyond acceptance flows)

* **Unit**: guard chain permutations (claims missing, JTI blocked, EV drift, membership missing).
* **Contract**: OpenAPI conformance for `/auth/*` and `/me/context`.
* **Security**: CSRF negative cases; cookie attribute assertions; SameSite behavior.
* **Performance**: `/me/context` P95 ≤ 300ms; permission recompute ≤ 150ms (Mongo-only).
* **Chaos**: disable Redis and verify graceful degradation; inject DB latency to confirm timeouts/alerts.
* **Mobile E2E**: real device tests for token storage & refresh.

---

## 14) Definition of Done (Part 2)

* Roles & permissions seeded; `ui_resources` present per tenant.
* ABAC enforcement implemented for students (and mirrored for other feature domains as they ship).
* EV bumping wired from all role/membership mutation paths.
* Dashboards & alerts created; rate limits active on `/auth/*`.
* Runbooks published and referenced by on-call.
* Tests cover unit/contract/security/perf/chaos cases listed above.

---

**End of Part 2**
