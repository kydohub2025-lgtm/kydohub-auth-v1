---

# Auth & Onboarding — Feature Index / Roadmap

> Scope: User authentication (Supabase → KydoHub session), multi-tenant onboarding (staff, parents), `/me/context`, RBAC/ABAC, CORS/CSRF, and guard pipeline for web (cookies) and mobile (bearer).

## 1) Quick Start

1. **Design Overview**

   * `../1_DESIGN/authentication_design_part1.md`
   * `../1_DESIGN/authentication_design_part2.md`
2. **API Contracts**

   * `../3_SPECIFICATIONS/api_auth_contracts.yaml`
   * `../3_SPECIFICATIONS/me_context_schema.json`
3. **Security Posture**

   * `../1_DESIGN/security_cors_csrf_design.md`
   * `../1_DESIGN/session_transport_matrix.md`

## 2) Document Map

### Specifications & Requirements

* `../3_SPECIFICATIONS/api_auth_contracts.yaml`
* `../3_SPECIFICATIONS/me_context_schema.json`
* `../3_SPECIFICATIONS/db_authz_collections.md`
* `../2_REQUIREMENTS/acceptance_auth_flows.md`
* `../2_REQUIREMENTS/api_error_contracts.md`

### Design & Rules

* `../1_DESIGN/authentication_design_part1.md`
* `../1_DESIGN/authentication_design_part2.md`
* `../1_DESIGN/security_cors_csrf_design.md`
* `../1_DESIGN/session_transport_matrix.md`
* `../4_RULES/backend_guard_rules.md`
* `../4_RULES/frontend_fetch_rules.md`

### Reference

* `/docs/2_DATABASE_CONTEXT/schema_overview.md`
* `/docs/2_DATABASE_CONTEXT/schema_cheatsheet.md`
* `/database/validators/*.json` (tenants, students, contacts, links, rooms, staff)

### To Create

* `/docs/1_INFRA_CONTEXT/env.sample.md`
* `/database/seeds/seed_authz.py`
* `/database/seeds/seed_founding_tenant.py`

## 3) Implementation Order

1. Middleware & Security (CORS/CSRF; cookie builders)
2. Auth Endpoints (`/auth/exchange`, `/auth/refresh`, `/auth/logout`, `/auth/switch`)
3. Guards (JWT → JTI → EV → RBAC → ABAC)
4. Context (`/me/context` assembler)
5. Frontend wiring (HTTP wrapper, tenant layout, `<Acl />`)
6. Seeds (roles, `ui_resources`, founding tenant)
7. Acceptance tests

## 4) Endpoint Contracts (At a Glance)

* `POST /auth/exchange` → Web: 204 + cookies; Mobile: 200 JSON; or 209 Tenant Choice
* `POST /auth/refresh` → Web: 204; Mobile: 200 JSON
* `POST /auth/logout` → 204
* `POST /auth/switch` → Web: 204; Mobile: 200 JSON
* `GET /me/context` → 200 context (roles, permissions, `ui_resources`, ABAC)

Errors per `../2_REQUIREMENTS/api_error_contracts.md`.

## 5) Collections (AuthZ Layer)

* `users` — link to Supabase user; profile
* `memberships` — `{tenantId,userId,roles[],attrs{rooms[],guardianOf[]}}`
* `roles` — `{tenantId,name,permissions[]}`
* `ui_resources` — `{tenantId,pages[],actions[]}`
* `refresh_sessions` (optional) — device/refresh tracking

Indexes & examples: `../3_SPECIFICATIONS/db_authz_collections.md`.

## 6) Environment Variables (Minimum)

```
SUPABASE_URL=
SUPABASE_ANONKEY=
JWT_PUBLIC_KEY=
JWT_PRIVATE_KEY=
MONGODB_URI=
REDIS_URL=
COOKIE_DOMAIN=.kydohub.com
ALLOWED_ORIGINS=https://app.kydohub.com,https://preview.kydohub.com,https://local.kydohub.test
VITE_API_BASE=https://api.kydohub.com
```

## 7) Done Criteria

* Web & mobile logins exchange and refresh as specified
* CSRF enforced on all non-GET browser requests
* Guard chain active on every protected route
* `/me/context` drives navigation and actions; no hardcoded gates in FE
* EV bump triggers `401 EV_OUTDATED` → silent refresh → UI updates
* Acceptance flows all pass in staging

## 8) Changelog

* 2025-10-10: Initial consolidation of Auth & Onboarding docs and specs.
