---

# Session Transport Matrix (Web vs Mobile)

> Goal: one identity (Supabase) with two transport modes that match each platform’s security model.
> Web = **HttpOnly cookies** (CSRF-safe). Mobile = **Bearer tokens** (no CSRF, secure storage).

## 1) Summary Matrix

| Dimension            | Web App (React @ Cloudflare Pages)                               | Mobile Apps (iOS/Android)                                   |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Client header        | `X-Client: web`                                                  | `X-Client: mobile`                                          |
| Session transport    | **Cookies** (`kydo_sess`, `kydo_refresh`, `kydo_csrf`)           | **Authorization Header** (`Bearer <access>`) + JSON refresh |
| Auth exchange        | `POST /auth/exchange` → **204** + Set-Cookie                     | `POST /auth/exchange` → **200** JSON `{access,refresh}`     |
| Access lifetime      | ~15m (configurable)                                              | ~15m (configurable)                                         |
| Refresh lifetime     | ~30d (path-scoped cookie)                                        | ~30d (opaque token in secure storage)                       |
| Storage location     | Browser cookie jar (HttpOnly for session/refresh)                | Keychain/Keystore (refresh), memory (access)                |
| CSRF protection      | **Required** (double-submit `kydo_csrf` + Origin/Referer checks) | **Not required** (no ambient cookies)                       |
| CORS                 | `Allow-Credentials:true`, origin allow-list                      | N/A (uses Authorization, no cookies)                        |
| Refresh flow         | `POST /auth/refresh` (uses `kydo_refresh` cookie) → **204**      | `POST /auth/refresh` `{refresh}` → **200** JSON             |
| Tenant switch        | `POST /auth/switch` → **204** (cookies reminted)                 | `POST /auth/switch` → **200** JSON tokens                   |
| Logout               | `POST /auth/logout` → **204**, clears cookies                    | Delete stored tokens; optional `/auth/logout` to block JTI  |
| EV outdated handling | 401 `EV_OUTDATED` → auto call `/auth/refresh` once → retry       | same                                                        |
| Error envelope       | JSON `{ error:{ code, message, … } }`                            | same                                                        |
| Observability        | `X-Request-ID` set by FE; server logs `tenantId,userId`          | same                                                        |

## 2) Cookie & Header Contracts (Web)

* `kydo_sess`: **HttpOnly**, `Secure`, `SameSite=Lax`, `Path=/`, `Domain=.kydohub.com`
* `kydo_refresh`: **HttpOnly**, `Secure`, `SameSite=Strict`, `Path=/auth/refresh`, `Domain=.kydohub.com`
* `kydo_csrf`: **Readable** cookie, `Secure`, `SameSite=Lax`, `Path=/`
* FE must send:

  * `credentials: 'include'`
  * `X-CSRF-Token: <kydo_csrf>`
  * `X-Client: web`
  * `X-Request-ID: <uuid>` (frontend generates)

## 3) Authorization Contracts (Mobile)

* Requests carry `Authorization: Bearer <access>`.
* Exchange/Refresh responses:

  ```json
  { "tokenType":"Bearer", "access":"<jwt>", "expiresIn":900, "refresh":"<opaque>", "tenant":{ "tenantId":"t1","name":"..." } }
  ```
* App behavior:

  * Store `refresh` in Keychain/Keystore.
  * Keep `access` in memory; rotate via `/auth/refresh`.
  * Include `X-Client: mobile` and `X-Request-ID`.

## 4) CORS & CSRF (Web Only)

* **CORS** (API → FE):

  * `Access-Control-Allow-Origin: https://app.kydohub.com` (plus preview/dev)
  * `Access-Control-Allow-Credentials: true`
  * `Vary: Origin`
* **CSRF** checks on non-GET:

  * Origin/Referer host **must** end with `.kydohub.com`
  * `X-CSRF-Token` **must** match `kydo_csrf` cookie

## 5) `/auth/exchange` Branching Logic

1. Verify Supabase token.
2. Determine mode:

   * If `X-Client=web` → mint cookies; **204** (no body).
   * If `X-Client=mobile` → return JSON tokens; **200**.
3. Multi-tenant case with no hint:

   * **209** `{ tenants:[{tenantId,name}...] }` (no cookies/tokens yet).
   * Client completes with `/auth/switch`.

## 6) Refresh & EV (Epoch/Version)

* Server caches `ev:{tenantId}:{userId}` in Redis.
* When roles/permissions change, bump EV.
* If incoming `access.ev < server EV` → **401 EV_OUTDATED**; client **must** call `/auth/refresh` once then retry original request.
* Web refresh re-issues cookies; mobile refresh returns JSON.

## 7) Security Posture

* Web sessions are **HttpOnly** cookies to prevent XSS token theft and support CSRF defense.
* Refresh cookie is **path-scoped** (`/auth/refresh`) + `SameSite=Strict` to minimize CSRF risk.
* Mobile avoids cookies, so **no CSRF** surface; tokens are bound to secure OS storage.
* Logout and incident response: add JTI to `jti:block` set for immediate revocation.

## 8) Implementation Pointers (where code lives)

* **Backend**

  * `middleware/cors_csrf.py` (CORS + CSRF)
  * `routers/auth.py` (exchange, refresh, logout, switch)
  * `security/cookies.py` (cookie builders)
* **Frontend**

  * `src/lib/http/fetchJson.ts` (credentials+CSRF, retry-once)
  * `TenantLayout` loads `/me/context` post-exchange/switch

## 9) DoD (Definition of Done)

* Web:

  * `POST /auth/exchange` sets three cookies; first protected call succeeds with `credentials:'include'` + CSRF header.
  * 401 `EV_OUTDATED` triggers one refresh and succeeds on retry.
* Mobile:

  * Exchange returns tokens; Authorization header works across all routes; refresh rotates successfully.
* Tenant switch:

  * Cookies/tokens re-minted; `/me/context` updates menus/actions accordingly.
* Observability:

  * Every request has `X-Request-ID`; error envelope consistent across modes.

## 10) Test Cases (quick)

* Web POST without `X-CSRF-Token` ⇒ **403 CSRF_FAILED**; no cookies rotated.
* Cross-origin from non-allow-listed Origin ⇒ blocked by CORS/Origin check.
* Multi-tenant user with no `tenantHint` ⇒ **209** tenant list.
* EV bump server-side ⇒ next call **401 EV_OUTDATED** ⇒ refresh ⇒ retry OK.

---
