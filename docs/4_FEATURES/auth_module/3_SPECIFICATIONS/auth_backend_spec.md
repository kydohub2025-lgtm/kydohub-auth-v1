---
doc_type: backend_spec
feature_slug: auth-onboarding
version: 0.2.2
status: draft
last_updated: 2025-10-09T00:00:00Z
owners:
  eng_backend: "TBD"
service_context:
  language: "Python"
  framework: "FastAPI (ASGI) via Mangum on AWS Lambda"
  odm: "Beanie"
  db: "MongoDB Atlas"
  cache: "Redis (ElastiCache Serverless / Upstash) — optional with DB fallback"
  jobs: "Lambda + SQS/EventBridge"
  auth: "Cookie mode (HttpOnly access + rotating refresh); Supabase as IdP (browser)"
compliance: ["FERPA","GDPR"]
securityCritical: true
---

# Title
Authentication & RBAC Onboarding (Service Contract, Serverless)

## Overview
**Domain boundary:** session exchange (from Supabase), refresh/logout, tenant switch, `/me/context` (roleNames, permissions, menuModel), EV/permset/JTI enforcement.  
**Collaborators:** Supabase (IdP), MongoDB Atlas (SoT), Redis (EV/permset/JTI), Notifications (invites), Audit/Logs, Metrics.  
**Non-Goals:** native password/MFA UIs (owned by IdP), payments/SSO.

## Auth, RBAC & Multi-Tenancy
- **Auth model:** Browser signs in with **Supabase**, then calls `POST /auth/exchange`; backend mints **HttpOnly Secure SameSite** cookies. **No tokens in JS.** 401 `EV_OUTDATED`/`EXPIRED` → `POST /auth/refresh` silently; single retry.
- **EV/permset/JTI:** Each guarded request verifies **token sig/exp**, checks **JTI blocklist**, compares **token.ev** vs **server EV** (Redis preferred), then authorizes via **permset** (Redis with DB fallback), injecting **tenantId** and ABAC filters.
- **Tenant isolation:** Tenant ID is injected from session; **ignore client tenant** on all calls.

**Feature role matrix (subset):**

| Action / Resource                          | Admin | Teacher | Parent | Notes |
|--------------------------------------------|:-----:|:------:|:-----:|-------|
| `me.context.read`                          |  ✓    |   ✓    |   ✓   | All signed-in users |
| `auth.exchange` / `auth.refresh` / logout  |  ✓    |   ✓    |   ✓   | Session lifecycle |
| `auth.tenant.switch`                       |  ✓    |   ✓    |   ✓   | Must be member of target tenant |

## API Endpoints
> JSON keys **lowerCamelCase**; paths **kebab-case**; every response includes `correlationId` header.  
> Serverless stack: API Gateway (HTTP API) → Lambda (FastAPI via Mangum).

### POST `/auth/exchange` — `operationId: auth.exchange`
**Purpose:** Validate Supabase session; mint **access/refresh/csrf** cookies.  
**Preconditions:** Valid Supabase session; membership exists (or founding flow).  
**Rate limits:** per IP 20/min; per tenant 600/min (burst 2×).  
**Request**
```json
{ "supabaseAccessToken":"string", "tenantHint":"string|null" }
````

**Response 200**

```json
{ "userId":"string", "tenantId":"string", "ev":13, "expiresInSec":1800 }
```

**Errors:** 400 invalid token, 401 unauthenticated, 403 not-member, 429 rate-limited.

### POST `/auth/refresh` — `operationId: auth.refresh`

**Purpose:** Rotate refresh; mint new access; detect reuse; optionally recompute permset if EV changed.
**Request** `{}` (cookies only)
**Response 200**

```json
{ "ev":13, "expiresInSec":1800 }
```

**Errors:** 401/403 (revoked/compromised), 429.

### POST `/auth/logout` — `operationId: auth.logout`

**Purpose:** Invalidate session (set-cookie clear, add JTI to blocklist).
**Request** `{}` (cookies only)
**Response 204** (no body)

### POST `/auth/switch` — `operationId: auth.switch`

**Purpose:** Switch active tenant; mint new cookies with `tenantId` and EV/permset for target tenant.
**Request**

```json
{ "targetTenantId":"string" }
```

**Response 200**

```json
{ "tenantId":"string", "ev":7 }
```

**Errors:** 403 if not a member of target tenant.

### GET `/me/context` — `operationId: me.context`

**Purpose:** Return roleNames, flattened permissions, and `menuModel` for UI.
**Query:** none
**Response 200**

```json
{
  "tenantId":"string",
  "roleNames":["teacher"],
  "permissions":["students.read","messages.create"],
  "menuModel":{
    "pages":[{"key":"page.students","required":["students.read"]}],
    "actions":[{"key":"action.message.send","required":["messages.create"]}]
  },
  "featureFlags":{},
  "abacHints":{"rooms":["Foxes","Bears"]}
}
```

## DTOs (Transport Contracts)

* **Conventions:** lowerCamelCase; time fields ISO8601; opaque tokens not echoed back.
* **Enums:** none in this surface (permissions are strings).
* **Redaction:** never return secrets; mask PII in logs/metrics per policy.

## Validation Rules

* **Supabase token:** required, current, signature verified against IdP; audience/origin checks; clock skew tolerance ±2m.
* **Tenant membership:** must exist for `/auth/exchange` & `/auth/switch`; server injects `tenantId`—client value ignored.
* **CSRF:** double-submit token required for unsafe methods (applies to admin flows under this feature).
* **Rate limit headers:** include `X-RateLimit-Policy` and `Retry-After` on 429.

## Data Access & Query Patterns

* Reads use projected membership document → compute `roleNames`, derive **permset** (if Redis miss) and **ABAC** filters (rooms, guardianship) for other features.
* All queries include `{ tenantId, ... }` predicates; **never** trust client tenant.

## Caching & Performance

* **Redis keys** (TTL indicative):

  * `ev:{tenantId}:{userId}` (no TTL; version integer)
  * `permset:{tenantId}:{userId}` (TTL 5–15m)
  * `jti:block:{jti}` (≤ token lifetime)
* **Fallback when Redis is unavailable:**

  * **Reads:** recompute permset & read EV from Mongo synchronously; continue only if checks pass (no bypass).
  * **Writes/privileged:** require stable DB checks; if not confirmable, **fail closed** with 503.
  * **Thundering herd:** per-(tenantId,userId) single-flight; bounded concurrency; short negative-cache TTL; circuit breaker if DB latency spikes.
* **Compression:** gzip responses; keep `/me/context` < 32KB.

## Rate Limits

* **Per IP:** 20 `/auth/exchange` per minute; 20 `/auth/refresh` per minute.
* **Per tenant:** 600 auth ops/min baseline (burst 2×).
* **429** returns include `retryAfterSec` and `X-RateLimit-Policy`.

## **Idempotency** *(NEW, normative)*

* **Header:** `Idempotency-Key` (UUIDv4).
* **Window:** **120 seconds**.
* **Scope:** Applies to **POST /auth/switch** and any future non-read POSTs in this feature (e.g., admin flows under auth).
* **Behavior:** If a duplicate request with the same key arrives within the window and the original completed, return the **same** status and body as the original and include header `Idempotency-Replayed: true`. If the original is in-flight, hold (single-flight) or return the eventual result.
* **Keying:** Dedup scope = `{ tenantId, userId, method, path, bodyHash }`.

## Error Taxonomy

* **400** `ERR_AUTH_VALIDATION` (bad/missing fields; invalid Supabase token format).
* **401** `ERR_AUTH_UNAUTHENTICATED` (no/expired session), `ERR_AUTH_EXPIRED`, `ERR_AUTH_EV_OUTDATED`.
* **403** `ERR_AUTH_FORBIDDEN` (not a member of target tenant; revoked/compromised refresh).
* **429** `ERR_AUTH_RATE_LIMITED` (throttle exceeded).
* **5xx** `ERR_AUTH_INTERNAL` (unexpected error).

### **Error Envelope (all non-2xx)** *(NEW, normative)*

All error responses MUST use this envelope:

```json
{ "code":"ERR_AUTH_...", "message":"human-safe summary", "details":{ }, "requestId":"uuid" }
```

* `code`: one of the stable codes in Error Taxonomy.
* `message`: neutral, no user enumeration or sensitive context.
* `details`: optional, structured (e.g., `{ reason:"EV_OUTDATED" }`).
* `requestId`: echoes the `correlationId` for support/debugging.

## Observability

* **Logs:** `tenantId`, `userId`, `correlationId`, `operationId`, `latencyMs`, `errorCode`; redact PII.
* **Metrics:** `requests_total{operationId}`, `errors_total{code}`, `latency_p95_ms{op}`, `ev_outdated_rate`, `redis_miss_ratio`, `permset_recompute_ms_p95`.
* **Alerts:** `errorRate>2%`, `latencyP95>3s`, `redis_miss_ratio>0.3 for 5m`, spikes in `401 EV_OUTDATED`.

## Failure Modes & Resilience

* **Access expired:** API returns 401 `ERR_AUTH_EXPIRED` → client calls `/auth/refresh` silently → success.
* **RBAC changed:** 401 `ERR_AUTH_EV_OUTDATED` → silent refresh → UI updates.
* **Refresh reuse/compromise:** detect; deny; clear cookies; audit; require re-login.
* **Redis outage:** degrade to DB recompute (reads), fail-closed on unsafe writes, add backpressure and protect DB.
* **Supabase outage:** existing sessions work until expiry; refresh may fail → redirect to login.

## Security & Privacy

* **Cookies:** HttpOnly, Secure, SameSite=Strict/Lax; narrow domain/path. **CSRF** required on unsafe methods. Strong **CSP** (no inline), HSTS, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`.
* **Tokens:** short access TTL (~20m), rotating refresh (7–30d), **JTI blocklist** for instant revocation. **Never** expose tokens to JS.
* **Tenant escape prevention:** ignore client tenant; apply ABAC; compound indexes include `tenantId` (DB spec).

## Background Jobs & Schedules

* **EV bump propagation:** on role/membership edits; publish change → write new EV to Redis → affected users see 401 EV_OUTDATED next request.
* **Token cleanup:** sweep expired refresh hashes/JTIs via EventBridge schedule.
* **Audit:** enqueue structured events for exchanges, refreshes, role changes.

## Events & Webhooks

* `auth.session.exchanged` `{ userId, tenantId }`
* `auth.session.refreshed` `{ userId, tenantId }`
* `auth.session.logged_out` `{ userId, tenantId }`
* `auth.ev.bumped` `{ tenantId, userId, ev }`

## Versioning & Deprecation

* All endpoints under `/v1`. Introduce `/v2` only for breaking changes; keep cookie names stable across minor versions.

## Testing Strategy

* **Unit:** EV gate, permset builder, JTI checks, CSRF enforcement.
* **Integration:** Login→Exchange→`/me/context` funnel; 401 EV_OUTDATED refresh path; tenant switch.
* **Resilience drills:** Redis unavailable → read recompute OK ≤ **800ms P95 @ 50 RPS**; writes fail closed (503).

## Open Questions

* Cookie domain/path strategy across Cloudflare Pages + API domain (shared parent?).
* Policy for `SameSite=Strict` vs `Lax` during external redirects.
* Minimum MFA policies at IdP per tenant.

## Machine Summary (for Cursor)

```json
{
  "featureSlug": "auth-onboarding",
  "paths": [
    {"operationId":"auth.exchange","method":"POST","path":"/auth/exchange"},
    {"operationId":"auth.refresh","method":"POST","path":"/auth/refresh"},
    {"operationId":"auth.logout","method":"POST","path":"/auth/logout"},
    {"operationId":"auth.switch","method":"POST","path":"/auth/switch"},
    {"operationId":"me.context","method":"GET","path":"/me/context"}
  ],
  "rateLimits": {"perIpPerMin":20,"perTenantPerMin":600,"burstMultiplier":2},
  "caches": [
    {"key":"ev:{tenantId}:{userId}","ttlSec":null},
    {"key":"permset:{tenantId}:{userId}","ttlSec":900},
    {"key":"jti:block:{jti}","ttlSec":"<=accessTtl"}
  ],
  "idempotency": {"header":"Idempotency-Key","windowSec":120,"scope":["POST /auth/switch"]},
  "errorEnvelope": {"code":"string","message":"string","details":"object?","requestId":"uuid"},
  "errorCodes": [
    {"code":"ERR_AUTH_VALIDATION","http":400},
    {"code":"ERR_AUTH_UNAUTHENTICATED","http":401},
    {"code":"ERR_AUTH_EXPIRED","http":401},
    {"code":"ERR_AUTH_EV_OUTDATED","http":401},
    {"code":"ERR_AUTH_FORBIDDEN","http":403},
    {"code":"ERR_AUTH_RATE_LIMITED","http":429},
    {"code":"ERR_AUTH_INTERNAL","http":500}
  ],
  "events": [
    {"name":"auth.session.exchanged","payloadKeys":["userId","tenantId"]},
    {"name":"auth.session.refreshed","payloadKeys":["userId","tenantId"]},
    {"name":"auth.session.logged_out","payloadKeys":["userId","tenantId"]},
    {"name":"auth.ev.bumped","payloadKeys":["tenantId","userId","ev"]}
  ],
  "observability": {
    "logFields":["tenantId","userId","correlationId","operationId","latencyMs","errorCode"],
    "metrics":["requests_total","errors_total","latency_p95_ms","ev_outdated_rate","redis_miss_ratio","permset_recompute_ms_p95"],
    "alerts":["errorRate>2%","latency>3s","redis_miss_ratio>0.3"]
  }
}
```