---

# Authentication Design — Part 1 (Updated)

> Scope: Identity, session transport, cookies/CORS/CSRF, endpoint contracts, `/me/context`, guard pipeline, and error semantics for **web (React @ Cloudflare Pages)** and **mobile** clients.
> Domains: **app.kydohub.com** (FE) and **api.kydohub.com** (BE).
> Goal: one identity (Supabase) with platform-appropriate session transport, zero hardcoded RBAC in the frontend, and instant permission-change effects without user logouts.

---

## 1) Identity & Session Ownership

* **Identity Provider:** Supabase handles sign-in (email/password/SSO/MFA) and returns an **access token** the client uses once.
* **Exchange:** The client sends that Supabase token to **`POST /auth/exchange`** on our backend.
* **Session ownership after exchange**

  * **Web:** Backend issues **HttpOnly cookies** for access + refresh; CSRF token in a readable cookie.
  * **Mobile:** Backend returns **JSON tokens** (`access`, `refresh`) for storage in secure OS keystores.
* **No tokens in JS** (web). Only cookies; JavaScript never sees the access/refresh token values.

---

## 2) Domains, CORS, and Client Modes

* **Frontend:** `https://app.kydohub.com`
* **Backend:** `https://api.kydohub.com`
* **Cookie scope:** `.kydohub.com` (first-party across `app` and `api`)
* **CORS (API → FE)**

  * Allow-list origins: `app.kydohub.com` (+ preview/dev)
  * `Access-Control-Allow-Credentials: true`
  * `Vary: Origin`
* **Client mode header:** `X-Client: web | mobile`

  * Controls whether `/auth/exchange` sets cookies (web, `204`) or returns JSON (mobile, `200`).

---

## 3) Cookie & Header Strategy (Web)

**Cookies set by backend**

* `kydo_sess` — access JWT

  * `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Domain=.kydohub.com`, TTL ~15m
* `kydo_refresh` — opaque refresh

  * `HttpOnly`, `Secure`, `SameSite=Strict`, **`Path=/auth/refresh`**, `Domain=.kydohub.com`, TTL ~30d
* `kydo_csrf` — CSRF token

  * **Readable** (not HttpOnly), `Secure`, `SameSite=Lax`, `Path=/`, TTL ~7d

**Frontend fetch rules**

* Always `credentials: 'include'`
* Send `X-CSRF-Token` equal to the `kydo_csrf` cookie on **POST/PUT/PATCH/DELETE**
* Never send `Authorization` for web; cookies ride automatically

---

## 4) CSRF & CORS Enforcement (Web)

**For non-GET requests**

1. **Origin/Referer check**: must be on the allow-list (ends with `.kydohub.com`)
2. **Double-submit**: `X-CSRF-Token` header must match the `kydo_csrf` cookie

**On failure:** return **403** `{error:{code:"CSRF_FAILED"}}` and **do not** rotate cookies.

---

## 5) Dual-Mode Endpoint Behaviors

### `POST /auth/exchange`

* **Web (`X-Client: web`)** → **204 No Content**, sets the three cookies above.
* **Mobile (`X-Client: mobile`)** → **200 OK**, returns:

  ```json
  { "tokenType":"Bearer", "access":"<jwt>", "expiresIn":900, "refresh":"<opaque>", "tenant":{"tenantId":"t1","name":"..." } }
  ```
* **Multi-tenant without choice** → **209 Tenant Choice**:

  ```json
  { "tenants":[{"tenantId":"t1","name":"..."},{"tenantId":"t2","name":"..."}] }
  ```

### `POST /auth/refresh`

* **Web:** reads `kydo_refresh` cookie → **204**, re-issues cookies (rotate refresh).
* **Mobile:** body `{ "refresh": "<opaque>" }` → **200**, returns rotated tokens.

### `POST /auth/logout`

* Blocklist current JTI, clear cookies (web) → **204**.

### `POST /auth/switch`

* Switch active tenant if user has membership.

  * **Web:** **204**, re-mint cookies bound to the chosen tenant.
  * **Mobile:** **200**, return tokens bound to the chosen tenant.

---

## 6) `/me/context` — The Frontend’s Source of Truth

**Purpose:** After login or tenant switch, the FE calls **`GET /me/context`** once to build navigation and gate controls.

**It returns**

* **Tenant & user** identifiers (display info optional)
* **`roles[]`** — role names for this tenant
* **`permissions[]`** — flattened permission strings (`resource.action`)
* **`ui_resources`** — server-owned lists of **pages** and **actions**, each with `requires: []`
* **`abac`** hints — data guardrails:

  * `rooms[]` (staff visibility)
  * `guardianOf[]` (parent visibility)
* **`meta.ev`** — server’s permission version that the token must match

**Why:** The UI stays dynamic (menus/buttons change) without any hardcoded permission logic.

---

## 7) Error Contract (Uniform Envelope)

All non-2xx responses use:

```json
{
  "error": {
    "code": "EXPIRED | EV_OUTDATED | PERMISSION_DENIED | INVALID_TOKEN | TENANT_REQUIRED | CSRF_FAILED | RATE_LIMITED | VALIDATION_FAILED | CONFLICT | NOT_FOUND",
    "message": "Neutral, user-safe text",
    "details": { "fieldErrors": { "field": "reason" } },
    "requestId": "uuid-v4"
  }
}
```

**Key semantics**

* **401 `EV_OUTDATED`** — server’s permissions version > token’s `ev`. Client calls `/auth/refresh` once, then retries.
* **401 `EXPIRED`** — session missing/expired/invalid. Web wrapper tries one refresh; otherwise send to login.
* **209 `TENANT_REQUIRED`** — show tenant picker; complete with `/auth/switch`.
* **403 `CSRF_FAILED`** — missing/mismatched CSRF; ask user to reload and retry.

---

## 8) Guard Pipeline (Every Protected Route)

1. **Extract session**

   * Web: `kydo_sess` cookie
   * Mobile: `Authorization: Bearer <jwt>`
2. **Verify JWT** (sig/exp; required claims: `sub`, `tid`, `ev`, `jti`)
3. **Revocation** — deny if JTI is in the blocklist
4. **EV freshness** — compare token `ev` vs `ev:{tenantId}:{userId}`; if stale → **401 `EV_OUTDATED`**
5. **Membership & roles** — load `{tenantId,userId}`, expand roles → `permissions[]`
6. **RBAC** — route declares required permissions (must be satisfied)
7. **ABAC** — build filters (e.g., staff rooms, parent guardianOf) and inject into queries
8. **Tenant injection** — always add `tenantId = token.tid` to DB queries (ignore client-supplied tenant IDs)

---

## 9) Data Stores & Caches (AuthZ side)

* **MongoDB (source of truth)**

  * `users` — link to Supabase user; profile
  * `memberships` — `{tenantId,userId,roles[],attrs{rooms[],guardianOf[]}}`
  * `roles` — `{tenantId,name,permissions[]}`
  * `ui_resources` — `{tenantId,pages[],actions[]}`
  * `refresh_sessions` *(optional)* — device/refresh tracking (esp. mobile)
* **Redis (ephemeral control)**

  * `ev:{tenantId}:{userId}` — integer permission version
  * `permset:{tenantId}:{userId}` — cached flattened permissions (TTL)
  * `jti:block` — set of revoked token IDs

**Rule:** Mongo is the truth; Redis accelerates and coordinates instant changes.

---

## 10) Flows (At a Glance)

**Login & Exchange (web)**

1. FE logs in with Supabase → gets `supabase_access_token`
2. FE `POST /auth/exchange` (`X-Client:web`)
3. BE verifies Supabase token → sets `kydo_sess`, `kydo_refresh`, `kydo_csrf` → **204**
4. FE `GET /me/context` → builds nav/actions

**Authorized API Call**

* BE verifies cookie → JTI check → EV check
* Loads membership/roles → RBAC + ABAC → **injects tenantId** → serves data

**Permission Change**

* Admin changes role/membership → server **bumps EV**
* Next API call from user → **401 EV_OUTDATED** → FE `/auth/refresh` → retry succeeds → UI updates

**Tenant Switch**

* FE `POST /auth/switch` with chosen tenant
* BE re-mints session (web: cookies; mobile: tokens)
* FE reloads `/me/context` → nav/actions update

---

## 11) Observability & Rate Limits (Essentials)

* **Every request:** `X-Request-ID` (client-generated) + logs include `tenantId,userId,route,status,durationMs`
* **Metrics to watch:** exchange/refresh success & latency, EV_OUTDATED rate, 401/403 counts, Redis hit/miss
* **Rate-limit** `/auth/exchange`, `/auth/refresh`, `/auth/logout`, `/auth/switch` per IP and per user

---

## 12) Definition of Done (Part 1)

* Web & mobile exchange/refresh flows work as specified (status codes & bodies match).
* Cookies have correct attributes; refresh is **path-scoped** and `SameSite=Strict`.
* CSRF enforced (double-submit + Origin/Referer) on all non-GET web requests.
* `/me/context` returns roles, permissions, `ui_resources`, and ABAC hints and drives the UI.
* Guard chain enforces JWT→JTI→EV→RBAC→ABAC; tenantId is server-injected.
* Error envelope consistent across endpoints; `EV_OUTDATED` triggers one silent refresh.

---

### Notes on Part 2 (what will be updated next)

Part 2 will cover **Admin & RBAC modeling**, **UI mapping to permissions**, **ABAC patterns & examples**, **monitoring/alerting dashboards**, and **incident runbooks** with any deltas required by today’s decisions.

---

**End of Part 1**
