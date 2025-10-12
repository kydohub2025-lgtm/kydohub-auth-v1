# KydoHub Auth & Onboarding — Implementation Decisions (Phases 0 → 7)

> **Status:** Approved (Ideation complete, pre‑implementation)
>
> **Scope:** Authentication, Authorization (RBAC/ABAC), User Onboarding
>
> **Purpose:** One canonical reference for engineers, QA, and ops during build, rollout, and troubleshooting.

---

## Table of Contents
- [Architecture & Environments](#architecture--environments)
- [Environment Variables (Contract)](#environment-variables-contract)
- [Phase‑by‑Phase Decisions](#phase-by-phase-decisions)
  - [Phase‑0 — Context, Env Mapping, Readiness](#phase-0--context-env-mapping-readiness)
  - [Phase‑1 — App Skeleton & Cross‑Cutting](#phase-1--app-skeleton--cross-cutting)
  - [Phase‑2 — Auth Foundation (Tokens, Cookies, Rotation)](#phase-2--auth-foundation-tokens-cookies-rotation)
  - [Phase‑3 — Repos & Guard Chain](#phase-3--repos--guard-chain)
  - [Phase‑4 — `/auth/*` Endpoints](#phase-4--auth-endpoints)
  - [Phase‑5 — `/me/context`](#phase-5--mecontext)
  - [Phase‑6 — Hardening & Observability](#phase-6--hardening--observability)
  - [Phase‑7 — Tests & CI/CD](#phase-7--tests--cicd)
- [Operational Runbooks (Summary)](#operational-runbooks-summary)
- [Troubleshooting Cues](#troubleshooting-cues)
- [Change Log](#change-log)
- [Ownership](#ownership)

---

## Architecture & Environments
**Stack**: FastAPI on AWS Lambda (API Gateway), MongoDB Atlas (SoR), optional Redis (**Amazon ElastiCache**), Supabase as IdP.

**Domains**: FE `app.kydohub.com` ↔ BE `api.kydohub.com`.

**API Base**: `/api/v1`.

**Tokens**: KydoHub **RS256** JWT (own keypair) for sessions; Supabase token is accepted **only** at `/auth/exchange`.

**Redis optionality**: Performance + control plane (EV, permset cache, JTI blocklist). App degrades to Mongo when Redis unavailable; strong‑guarantee writes may fail‑closed.

---

## Environment Variables (Contract)
> Values live in `.env.local` for dev and in SSM/Secrets Manager for staging/prod.

**Service**
- `APP_STAGE` (dev/staging/prod)
- `API_BASE_PATH=/api/v1`
- `LOG_LEVEL`

**Mongo**
- `MONGODB_URI`, `MONGODB_DB`

**Redis (optional)**
- `REDIS_URL` (empty/absent disables)

**Supabase**
- `SUPABASE_URL`
- `SUPABASE_JWT_SECRET` (verify Supabase access JWT at `/auth/exchange`)

**KydoHub JWT (RS256)**
- `JWT_PRIVATE_KEY_PEM`, `JWT_PUBLIC_KEY_PEM`
- `JWT_ISS=kydohub-api`, `JWT_AUD=kydohub-app`
- `JWT_ACCESS_TTL_SEC=1200` (**20m**), `JWT_REFRESH_TTL_SEC=1209600` (**14d**)

**Web Security**
- `ALLOWED_ORIGINS` (comma‑sep; includes dev + prod)
- `COOKIE_DOMAIN=.kydohub.com`
- `ACCESS_COOKIE=kydo_sess`, `REFRESH_COOKIE=kydo_refresh`, `CSRF_COOKIE=kydo_csrf`
- `CSRF_HEADER=X-CSRF`

**Rate Limits**
- `RATE_LIMITS_IP`, `RATE_LIMITS_TENANT` (gateway/app use)

**Observability (optional)**
- `OTLP_ENDPOINT`, `SENTRY_DSN`

---

## Phase‑by‑Phase Decisions

### Phase‑0 — Context, Env Mapping, Readiness
- **Architecture**: FastAPI (Lambda), Mongo Atlas, ElastiCache (preferred), Supabase IdP.
- **JWT**: RS256 with our own keypair, JWKS planned.
- **CORS/CSRF**: strict allow‑list; double‑submit CSRF + Origin/Referer checks (web only).
- **Cookie domain**: `.kydohub.com`.
- **TTL**: access 20m, refresh 14d; clock skew ±120s.
- **Idempotency**: `POST /auth/switch` (120s window).
- **Rate limits (base)**: per‑IP & per‑user; per‑tenant (exchange 600/min, burst×2).
- **Readiness**: Atlas connectivity from Lambda; ElastiCache reachable; API Gateway custom domain; CI via OIDC→AWS; seed `roles` + `ui_resources` on tenant creation.

### Phase‑1 — App Skeleton & Cross‑Cutting
- **Structure**: core (config, logging, errors); middleware (request‑id → gzip → security headers → CORS → CSRF); infra (mongo, redis); routers (health).
- **Health**: `/healthz` 200 (process alive), `/readyz` checks Mongo and reports Redis (true/false/null). If Mongo down → 503.
- **Security headers**: `nosniff`, `DENY` frames, `strict-origin-when-cross-origin`; CSP mainly at edge. `Cache-Control: no-store` for auth endpoints.
- **Error envelope** (uniform): `{ error: { code, message, details, requestId } }`. Reserved codes include `BAD_REQUEST, UNAUTHENTICATED, EXPIRED, EV_OUTDATED, PERMISSION_DENIED, CSRF_FAILED, ORIGIN_MISMATCH, CORS_REJECTED, NOT_FOUND, CONFLICT, RATE_LIMITED, DEPENDENCY_UNAVAILABLE, INTERNAL`.

### Phase‑2 — Auth Foundation (Tokens, Cookies, Rotation)
- **Web cookies**
  - `kydo_sess`: HttpOnly, Secure, **SameSite=Lax**, Domain `.kydohub.com`, Path `/`, TTL=access TTL.
  - `kydo_refresh`: HttpOnly, Secure, **SameSite=Lax**, Domain `.kydohub.com`, **Path `/auth/refresh`**, TTL=refresh TTL.
  - `kydo_csrf`: Secure, **non‑HttpOnly**, **SameSite=Lax**, Path `/` (double‑submit token).
- **Mobile**: bearer JSON `{ access, refresh }` (no CSRF).
- **CORS**: only `ALLOWED_ORIGINS`, `credentials: true`.
- **CSRF (web)**: require Origin/Referer ∈ allow‑list **and** header `X-CSRF` matching `kydo_csrf`; on fail → `403 CSRF_FAILED` (no rotation).
- **Claims**: `sub, tid, ev, jti, iat, exp, aud, iss`.
- **Rotation**: refresh rotates JTI; reuse of old refresh → revoke family (blocklist), require re‑login.
- **Redis keys**: `ev:{tid}:{uid}`, `permset:{tid}:{uid}` (TTL 5–15m), `jti:block:{jti}`.
- **`refresh_sessions`** (recommended): device metadata; unique `(tenantId,userId,jti)`; TTL on `expiresAt`.

### Phase‑3 — Repos & Guard Chain
- **Repos**
  - `MembershipRepo`: `get(tenantId,userId)`, `list_by_roles(...)`.
  - `RoleRepo`: `list_by_names(tenantId,names[])`, `flatten_permissions(roles[]) -> set[str]`.
  - `UIResourcesRepo`: `get_for_tenant(tenantId)`.
  - `RefreshSessionRepo`: `create/rotate/revoke/revoke_all`.
  - `AuthStateCache`: `get/set_ev`, `get/set_permset` with single‑flight.
  - `JtiBlocklist`: `is_blocked`, `block`.
- **Guard order**: `JWT → JTI → EV → Membership → Roles→Permset → RBAC → ABAC → Tenant Inject`.
- **Context**: expose `{ requestId, clientMode, tenant_id, user_id, roles[], permissions:set, abac{rooms[], guardianOf[]}, ev, jti }` to routers.
- **Fallbacks**: Redis down → recompute from Mongo for reads; strong writes (JTI/block) use Mongo fallback; if guarantees can’t be met → **fail‑closed** with `DEPENDENCY_UNAVAILABLE`.

### Phase‑4 — `/auth/*` Endpoints
- **Mode**: `X-Client: web|mobile` (or equivalent). Web uses cookies+CSRF; mobile uses bearer JSON.
- **`POST /auth/exchange`**
  - Verify Supabase token; resolve tenant or return **209 Tenant Choice** `{ tenants[] }`.
  - Web: **204** + set cookies. Mobile: **200** `{ tokenType, access, expiresIn, refresh, tenant? }`.
- **`POST /auth/refresh`**
  - Validate & rotate; Web: **204** + cookie rotation (**CSRF required**); Mobile: **200** JSON.
- **`POST /auth/logout`**
  - **204**; clear cookies (web); **block current JTI**.
- **`POST /auth/switch`**
  - Membership required in target tenant; re‑mint session; honors **Idempotency‑Key** (120s). Web: **204**. Mobile: **200** JSON.
- **Rate limits (final)**
  - Per‑IP / per‑user: exchange **20/min & 10/min**, refresh **60/min & 20/min**, logout **30/10**, switch **30/15**, me/context **120/60**.
  - Per‑tenant baseline: exchange **600/min** (burst×2). On throttle → **429** + `Retry-After` + `X-RateLimit-Policy`.
- **Redis unavailable (auth routes)**: recompute read paths; if strong guarantees can’t be ensured (e.g., blocklist write) → **deny** with `DEPENDENCY_UNAVAILABLE`. Cookies/tokens are **not** rotated on CSRF/CORS failures.

### Phase‑5 — `/me/context`
- **Inputs**: membership (active), roles → flattened `permissions`, `ui_resources` (pages/actions). ABAC hints: `rooms[]` for staff; `guardianOf[]` from `student_contact_links` for guardians/parents.
- **Output** (exact schema):
  ```jsonc
  {
    "tenant": { /* minimal fields for UI */ },
    "user": { /* minimal profile for UI */ },
    "roles": ["..."],
    "permissions": ["resource.action", "..."],
    "ui_resources": { "pages": ["..."], "actions": ["..."] },
    "abac": { "rooms": ["..."], "guardianOf": ["..."] },
    "meta": { "ev": <int> }
  }
  ```
- **Performance**: Mongo‑only cold ≤ **150 ms P95** @ ~50 RPS; Redis warm ≤ **60 ms P95**.
- **Caching**: `permset:{tid}:{uid}` TTL 5–15m; optional `uires:{tid}` TTL 10–30m or versioned.
- **Failures**: missing/suspended membership → **403 PERMISSION_DENIED**; Redis down → recompute from Mongo.

### Phase‑6 — Hardening & Observability
- **Rate limiting**: gateway preferred; app guard per route. Anomaly: ≥5× spike → stricter tier 10 min; emit `security.rate_limit.elevated`.
- **Structured logs** (no PII):
  ```
  { ts, level, msg, requestId, route, method, status, durMs,
    tenantId?, userId?, client?("web"|"mobile"), ipHash?, ev?, jti?, redisMiss? }
  ```
- **Metrics**: requests_total, auth_exchange_total{outcome}, auth_refresh_total{outcome}, ev_outdated_total, rate_limited_total{scope}; histograms for request_duration_ms (route), permset_recompute_ms, redis_ops_ms.
- **SLOs**: Exchange/Refresh success ≥ **98%** (5m); EV_OUTDATED < **3%** sustained; `/me/context` P95 ≤ 150ms (DB) / 60ms (Redis).
- **Audit** (append‑only, retain ≥365d): `auth.session.exchanged|refreshed|logged_out|switched`, `auth.jti.blocked|refresh.reuse_detected`, `auth.ev.bumped|roles.updated|membership.updated`, `security.rate_limit.elevated|redis.unavailable|redis.recovered`.
- **Headers/CSP**: app‑layer headers; CSP minimal at edge; `Cache-Control: no-store` on auth routes.
- **Resilience**: Redis down → reads recompute; strong writes use Mongo fallback or **fail‑closed**. Mongo down → `/readyz=503`; Supabase down → new sessions blocked, existing continue until access expiry.
- **JWKS/Keys**: dual keypairs during rotation (kid‑tagged); serve JWKS at `/.well-known/jwks.json`.

### Phase‑7 — Tests & CI/CD
- **Unit**: Supabase verify; RS256 mint/verify + kid; cookie builders; rotation; guard chain; permset flatten; repos semantics.
- **Contract**: `api_auth_contracts.yaml` conformance; `/me/context` matches `me_context_schema.json`; JWT payload matches `kydohub_jwt_payload_schema.json`.
- **Integration**: full E2E (web/mobile); CSRF/CORS failures; EV drift; tenant switch; logout/JTI block.
- **Resilience/Chaos**: Redis down (reads OK, strong writes fail‑closed); slow Mongo; refresh reuse attack handling.
- **Performance**: `/me/context` budgets; `/auth/refresh` ≤ **90 ms P95** (Redis) / ≤ **180 ms P95** (no Redis).
- **CI/CD (GitHub Actions)**: PR → lint/type/audit → unit → contract → integration → short perf; main/tag → package (reproducible, pinned) → Trivy+SBOM → deploy‑dev (OIDC→AWS) → smoke → promote‑stg (manual) → canary (10→50→100) → promote‑prod (manual) with auto‑rollback on SLO breach.
- **Envs**: dev (localhost CORS, Redis optional, verbose logs), staging (mirrors prod, ElastiCache on), prod (restrictive CORS, ElastiCache, JWKS served). Secrets via SSM/SM.
- **Docs**: `README_FEATURE_INDEX.md`, `TESTING.md`, `OPS_RUNBOOKS.md`, `.env.template`.

---

## Operational Runbooks (Summary)
- **EV bump**: set `ev:{tid}:{uid} = current+1` → expect 401 `EV_OUTDATED` → FE refresh → recovery ≤10m.
- **Mass logout**: generate new RS256 keypair; add to JWKS; start minting with new `kid`; blocklist active JTIs; optionally shorten access TTL temporarily; communicate sign‑out.
- **Redis outage**: page on `redis_unavailable` / low hit ratio; verify VPC/SG; monitor `/me/context` P95; throttle non‑critical routes; DB‑only mode acceptable temporarily.
- **Key rotation**: dual‑key window; serve JWKS; retire old key post max refresh TTL; monitor `INVALID_SIGNATURE`.

---

## Troubleshooting Cues
- **401 `EV_OUTDATED`**: RBAC/ABAC update or server EV>token EV → FE must call `/auth/refresh` once.
- **403 `CSRF_FAILED`**: missing/invalid `X-CSRF` or bad Origin/Referer; cookies are **not** rotated on failure.
- **429 `RATE_LIMITED`**: check headers for policy; bursts auto‑relax after cooldown.
- **503 `DEPENDENCY_UNAVAILABLE`**: Mongo/Redis required for strong guarantee; read logs for `dependency` and `operation`.
- **Login loops (web)**: verify cookie domain `.kydohub.com`, SameSite **Lax**, refresh cookie Path `/auth/refresh`, CORS allow‑list, and HTTPS only.

---

## Change Log
- **2025‑10‑12**: Initial consolidated decisions (Phases 0→7) approved and frozen for implementation.

---

## Ownership
- **Feature Owner**: KydoHub Platform (Auth & Onboarding)
- **Tech Lead**: Backend Implementation Assistant (you + ChatGPT co‑pilot)
- **Ops**: SRE/Cloud team (API Gateway, Lambda, Atlas, ElastiCache, Secrets)

---

> **File path:** `docs/4_FEATURES/auth_onboarding/IMPLEMENTATION_DECISIONS.md`

> **How to use this doc:** Treat as the single source of truth during implementation and incident response. If any decision changes, update this document first, then proceed with code changes and tests.