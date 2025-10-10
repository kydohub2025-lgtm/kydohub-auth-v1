---

# Security, Cookies, CORS & CSRF — Design

> Scope: React (Cloudflare Pages) ↔ FastAPI (AWS API Gateway → Lambda).
> Domains: **app.kydohub.com** (FE) and **api.kydohub.com** (BE).
> Goal: First-party, cookie-based web sessions with CSRF protection; token mode for mobile; strict CORS.

---

## 1) Objectives (what “secure” means here)

1. **No token in JS** (web): access/refresh live in **HttpOnly** cookies only.
2. **CSRF-safe mutations**: double-submit token + Origin/Referer checks.
3. **Tight CORS**: credentials allowed only for allow-listed origins; no wildcards.
4. **Least privilege at the edge**: fail closed on unknown origins, strip headers where needed.
5. **Same design works for mobile** (no cookies → no CSRF surface).

---

## 2) Cookie Strategy (web only)

**Cookie scope & attributes**

* `Domain=.kydohub.com` (covers `app` + `api`)
* `Secure` (HTTPS only)
* `HttpOnly` for session/refresh (not for CSRF cookie)
* `SameSite`:

  * `kydo_sess` → `Lax`
  * `kydo_refresh` → `Strict`
  * `kydo_csrf` → `Lax`
* Paths:

  * `kydo_sess`: `/`
  * `kydo_refresh`: **`/auth/refresh`** (path-scoped)
  * `kydo_csrf`: `/`
* Lifetimes (tuneable):

  * access: 15m
  * refresh: 30d
  * csrf: 7d

**Rationale**

* `refresh` is **Strict + path-scoped** so it does not ride cross-site requests.
* `sess` is **Lax** so top-level navigations work without CSRF issues.
* `csrf` is readable by FE for double-submit.

---

## 3) CSRF Design (web only)

**Defenses (both must pass for non-GET):**

1. **Origin/Referer**: must match an allow-listed origin ending with `.kydohub.com`.
2. **Double-submit**: header `X-CSRF-Token` must equal `kydo_csrf` cookie.

**Failure behavior**

* Return **403** `{ error: { code: "CSRF_FAILED" } }`.
* **Do not** rotate cookies on CSRF failure.

**Frontend rules**

* Always send `credentials: "include"`.
* Echo `X-CSRF-Token` from `kydo_csrf`.
* On 403 CSRF, prompt a soft reload.

---

## 4) CORS Policy (API Gateway → Lambda)

**Why**: we use cookies ⇒ **must** allow credentials and **cannot** use `*`.

**Responses for allowed origins**

```
Access-Control-Allow-Origin: https://app.kydohub.com
Vary: Origin
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, X-Client, X-Request-ID, Authorization
Access-Control-Max-Age: 600
```

**Allow-list (env)**

```
ALLOWED_ORIGINS= https://app.kydohub.com,https://preview.kydohub.com,https://local.kydohub.test
```

**Preflight (OPTIONS)**

* Mirror request’s `Origin` only if in allow-list.
* If origin unknown ⇒ return **no CORS headers** (fail closed).

---

## 5) Mode Split: Web vs Mobile

* **Web** (`X-Client: web`): cookies, CSRF required, CORS enforced.
* **Mobile** (`X-Client: mobile`): **Authorization: Bearer** tokens, **no CSRF**, CORS not relevant.

**/auth/exchange behavior**

* Web → **204**, sets cookies.
* Mobile → **200**, returns `{access, refresh}`.

---

## 6) FastAPI Middleware (where this is enforced)

**Files**

* `apps/backend/kydohub/middleware/cors_csrf.py` — CORS allow-list + CSRF checks.
* `apps/backend/kydohub/security/cookies.py` — Set-Cookie builders (sess/refresh/csrf).

**CSRF middleware logic (summary)**

* If `X-Client != mobile` **and** method ∉ {GET, HEAD, OPTIONS}:

  * Validate `Origin`/`Referer` against allow-list.
  * Compare `X-CSRF-Token` with `kydo_csrf` cookie.
  * On fail → 403 `CSRF_FAILED`.

---

## 7) API Gateway & Cloudflare config notes

**API Gateway (custom domain `api.kydohub.com`)**

* Attach Lambda integration that returns the headers above.
* Ensure binary/media types include `*/*` if you ever stream; not required for JSON.

**Cloudflare Pages (`app.kydohub.com`)**

* Enforce HTTPS, HSTS at Cloudflare.
* Optional: add a CSP (see below) via Pages rules.

---

## 8) Security Headers (all responses)

Set by backend (or API Gateway/Cloudflare where preferred):

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

**Content-Security-Policy (recommend at CDN/gateway)**

* Minimal starter (tighten as you enumerate assets):

```
Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://api.kydohub.com; frame-ancestors 'none';
```

*(Adjust `script-src` if you load third-party, use nonces/hashes where possible.)*

---

## 9) Threat Model (quick)

| Threat                        | Control                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- |
| **CSRF** (cross-site form/JS) | SameSite cookies (Lax/Strict) + **double-submit** + **Origin/Referer** checks |
| **XSS token theft**           | Access/refresh in **HttpOnly** cookies; CSRF token only gates mutations       |
| **Origin spoofing**           | Strict CORS allow-list + `Vary: Origin`; unknown origins get no CORS headers  |
| **Refresh abuse**             | Path-scoped refresh cookie (`/auth/refresh`) + `Strict`                       |
| **Session fixation / replay** | Rotate refresh on use; blocklist JTI on logout; short access lifetime         |
| **Mixed content / downgrade** | Enforce HTTPS and HSTS                                                        |
| **Role drift** (stale perms)  | EV cache; on drift → **401 EV_OUTDATED**; client refreshes once               |

---

## 10) Environment Variables

```bash
COOKIE_DOMAIN=.kydohub.com
ALLOWED_ORIGINS=https://app.kydohub.com,https://preview.kydohub.com,https://local.kydohub.test
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
# Optional
REDIS_URL=redis://...
CSP_REPORT_URI=https://report.kydohub.com/csp
```

---

## 11) Test Plan (must pass)

1. **Happy path:** exchange → cookies set → `/me/context` OK.
2. **CSRF missing:** POST without `X-CSRF-Token` ⇒ **403 CSRF_FAILED**, cookies unchanged.
3. **Bad Origin:** request from non-allow-listed origin ⇒ blocked (no CORS).
4. **Refresh flow:** 401 `EV_OUTDATED` ⇒ one `/auth/refresh` ⇒ retry succeeds.
5. **Strict refresh path:** attempt to send `kydo_refresh` to any path ≠ `/auth/refresh` ⇒ cookie not sent by browser.
6. **Mobile mode:** exchange returns JSON; no cookies; Authorization works.

---

## 12) Definition of Done

* Cookies carry correct attributes/domain; refresh is path-scoped.
* CSRF middleware enforced on all non-GET web requests.
* CORS allow-list active with `Allow-Credentials: true` and `Vary: Origin`.
* Security headers present on every response; CSP configured at CDN/gateway.
* Acceptance tests for CSRF, CORS, refresh, and EV drift pass in staging.

---

**End of file.**