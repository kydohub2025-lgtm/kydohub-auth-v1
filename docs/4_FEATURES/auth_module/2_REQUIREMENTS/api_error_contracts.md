---

# API Error Contracts — Auth & Onboarding

> Purpose: unify how the backend reports errors so the web and mobile clients can implement **one** handler. Applies to `/auth/*` and `/me/context`, and is safe to reuse across other features.

## 1) Envelope (always)

All non-2xx responses MUST return this JSON envelope:

```json
{
  "error": {
    "code": "EXPIRED | EV_OUTDATED | PERMISSION_DENIED | INVALID_TOKEN | TENANT_REQUIRED | CSRF_FAILED | RATE_LIMITED | VALIDATION_FAILED | CONFLICT | NOT_FOUND",
    "message": "Human-friendly, neutral message",
    "details": { "fieldErrors": { "field": "reason" } }, 
    "requestId": "uuid-v4"
  }
}
```

* `code` is machine-readable (stable string).
* `message` is safe for end users (no secrets, no stack traces).
* `details` is optional; for validation or troubleshooting (never PII).
* `requestId` MUST echo the inbound `X-Request-ID` or be generated server-side.

**Headers (recommended with every error):**

* `X-Request-ID: <uuid>`
* `Cache-Control: no-store`
* `Content-Type: application/json; charset=utf-8`

---

## 2) Canonical codes & HTTP mapping

| Code                | HTTP | When it happens                                                                | Client behavior (summary)                                    |
| ------------------- | ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `EXPIRED`           | 401  | Missing/expired/invalid session or refresh token; revoked JTI                  | For web: attempt a **single** `/auth/refresh`; else to login |
| `EV_OUTDATED`       | 401  | Server-side role/permission version > token EV                                 | Auto-call `/auth/refresh` once, then retry original request  |
| `PERMISSION_DENIED` | 403  | Authenticated but lacks permission or no membership for tenant                 | Show “You don’t have access”; do not retry automatically     |
| `INVALID_TOKEN`     | 401  | Supabase token exchange failed, signature wrong, or claims missing             | Show neutral login error; allow user to retry login          |
| `TENANT_REQUIRED`   | 209* | User has multiple tenants and none selected                                    | Show tenant picker UI; call `/auth/switch`                   |
| `CSRF_FAILED`       | 403  | Web POST/PUT/PATCH/DELETE missing/invalid `X-CSRF-Token` or bad Origin/Referer | Reload (to refresh `kydo_csrf`) and retry once               |
| `RATE_LIMITED`      | 429  | Too many requests (IP/user/tenant throttles)                                   | Backoff and retry later                                      |
| `VALIDATION_FAILED` | 400  | Body/params invalid; schema violations                                         | Highlight fields from `details.fieldErrors`                  |
| `CONFLICT`          | 409  | Logical conflict (e.g., invite already accepted, duplicate membership)         | Refresh page state; guide user to resolution                 |
| `NOT_FOUND`         | 404  | Resource does not exist or is not visible under ABAC scope                     | Show neutral “not found”; don’t reveal existence             |

* `209 Tenant Choice` is a deliberate non-standard status used by this feature to cleanly branch UI into the tenant picker flow.

---

## 3) Standard responses by endpoint

### 3.1 `POST /auth/exchange`

* **204** (web success; cookies set)
* **200** (mobile success; JSON tokens)
* **209 TENANT_REQUIRED** (with `{tenants:[{tenantId,name}]}`)
* **400 INVALID_TOKEN**
* **401 EXPIRED** *(e.g., Supabase project mismatch)*

**Examples**

```json
{ "error": { "code": "INVALID_TOKEN", "message": "Login could not be verified. Please try again.", "requestId": "..." } }
```

```json
{ "tenants": [ { "tenantId": "t1", "name": "Sunrise Daycare" }, { "tenantId": "t2", "name": "Bright Kids" } ] }
```

### 3.2 `POST /auth/refresh`

* **204** (web; cookies rotated)
* **200** (mobile; tokens rotated)
* **401 EXPIRED** (refresh invalid/expired)
* **403 CSRF_FAILED** (web state-changing call without valid CSRF)

**Example**

```json
{ "error": { "code": "EXPIRED", "message": "Your session has ended. Please sign in again.", "requestId": "..." } }
```

### 3.3 `POST /auth/logout`

* **204** (cookies cleared; JTI blocked)
* **401 EXPIRED** (no active session)
* **403 CSRF_FAILED** (web)

### 3.4 `POST /auth/switch`

* **204** (web; cookies reminted for chosen tenant)
* **200** (mobile; tokens for chosen tenant)
* **401 PERMISSION_DENIED** (user not a member of that tenant)
* **403 CSRF_FAILED** (web)

### 3.5 `GET /me/context`

* **200** (context JSON)
* **401 EV_OUTDATED** (client should refresh then retry)
* **403 PERMISSION_DENIED** (no membership)

---

## 4) Error body examples (ready to copy into tests)

**EV_OUTDATED**

```json
{
  "error": {
    "code": "EV_OUTDATED",
    "message": "Your permissions have been updated. Refreshing…",
    "requestId": "b1d3f1ee-57b2-4d9e-9c5c-1a0e8d4d1c2f"
  }
}
```

**CSRF_FAILED**

```json
{
  "error": {
    "code": "CSRF_FAILED",
    "message": "Invalid request token. Please reload and try again.",
    "requestId": "1f5c8c9a-0a47-4a54-a9b0-43c1a4eb2e86"
  }
}
```

**VALIDATION_FAILED (with field errors)**

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please check the highlighted fields.",
    "details": {
      "fieldErrors": {
        "tenantId": "required",
        "device.client": "must be 'web' or 'mobile'"
      }
    },
    "requestId": "f3a3f7d0-eaa7-4d1c-b9b9-4d2ae6b3d0e0"
  }
}
```

**TENANT_REQUIRED (209)**

```json
{
  "tenants": [
    { "tenantId": "t1", "name": "Sunrise Daycare" },
    { "tenantId": "t2", "name": "Bright Kids" }
  ]
}
```

---

## 5) Frontend handling rules (one place in your app)

* Treat any non-2xx as the envelope above (parse `error.code`).
* **401 `EV_OUTDATED`** → call `/auth/refresh` once → retry original request once.
* **401 `EXPIRED`** (after one refresh attempt) → route to Sign-In (neutral message).
* **403 `CSRF_FAILED`** → reload context/page; show “Please try again”.
* **209 `TENANT_REQUIRED`** → open tenant picker; on select → `POST /auth/switch`.
* **429 `RATE_LIMITED`** → backoff (e.g., 1s, 2s, 4s) and show gentle message if persistent.
* **400 `VALIDATION_FAILED`** → map `details.fieldErrors` to form UI.

---

## 6) Backend authoring rules

* Never return different structures for errors; always use the envelope (except 209 tenant list).
* Keep messages neutral (no user enumeration, no issuer names, no stack traces).
* Include `X-Request-ID` on every response; log it with `tenantId`, `userId`, `operationId`.
* For cross-origin web requests, include `Vary: Origin` on responses that depend on Origin allow-listing.
* For CSRF failures, do not set/rotate cookies.

---

## 7) Test checklist (map to Acceptance Flows)

* ✅ 401 EV_OUTDATED triggers one refresh & succeeds on retry.
* ✅ 403 CSRF_FAILED blocks mutation and **does not** rotate cookies.
* ✅ 209 TENANT_REQUIRED returns a list and no cookies.
* ✅ 401 EXPIRED after invalid refresh leads to login flow.
* ✅ All error responses include `X-Request-ID` and `Cache-Control: no-store`.

---

**End of file.**
