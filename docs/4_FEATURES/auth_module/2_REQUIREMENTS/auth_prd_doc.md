---
doc_type: prd
feature_slug: auth-onboarding
version: 0.2.1
status: draft
last_updated: 2025-10-05T23:20:00Z
owners:
  product: "TBD (You)"
  eng: "TBD"
  design: "TBD"
compliance: ["FERPA","GDPR"]
impactAreas: ["frontend","backend","tests"]
dependencies: ["tenant","user","org-settings","notifications"]
serverless: true
---
```

## Title

Authentication & RBAC Onboarding (Serverless + Cookie Sessions)

## Summary

Implement **browser sign-in via Supabase**, then **`POST /auth/exchange`** to mint **HttpOnly Secure SameSite** cookies (access/refresh/CSRF). The app shell and controls are driven by **`GET /me/context`** (roleNames, permissions, `menuModel`), and every guarded API call enforces **RBAC + ABAC** with **Redis for EV/permset/JTI**. If Redis is unavailable, the backend **recomputes from Mongo** (slower but correct) without bypassing authorization. This design fits **Cloudflare Pages (SPA) + AWS Lambda (FastAPI via Mangum) + API Gateway (HTTP API)**.   

## Problem Statement

We need a **zero-token-in-JS** authentication model that works with serverless cold starts and CDN-hosted SPA delivery, keeps UI gating dynamic (no hardcoded role checks), ensures instant RBAC updates, and protects tenant isolation. Supabase owns identity/MFA; our backend owns session cookies, authorization, and `/me/context`.  

## Goals & Non-Goals

**Goals**

* G1: **Supabase login → `/auth/exchange` → HttpOnly cookies** with CSRF on unsafe methods; **no tokens in JS**. 
* G2: **`/me/context`** returns `roleNames`, flattened `permissions`, and `menuModel` to drive pages/actions. 
* G3: **Redis EV/permset/JTI** on every guarded call; **graceful Mongo fallback** (recompute permset/EV; check JTI via DB fields) when Redis is down.  
* G4: **Invite + Founding tenant + Tenant switch (`/auth/switch`)** flows, with menus/actions rebuilt from new context. 
* G5: Defense-in-depth: SameSite cookies, CSRF, HSTS/CSP headers, rate limits on exchange/refresh, audit of auth & role changes. 

**Non-Goals**

* NG1: Building native password/MFA UIs (Supabase owns this). 
* NG2: Enterprise SSO (later).
* NG3: DB spec (already designed elsewhere).

## Users, Roles & Permissions (Conceptual)

Seed roles per tenant: owner/admin/teacher/assistant/parent/billing_manager/support_viewer. Permissions are `resource.action`; **ABAC** narrows scope (e.g., teachers limited to rooms; parents limited to their children; time windows for attendance).  

## Scope

**In-Scope (MVP)**

* Endpoints: **`/auth/exchange`**, **`/auth/refresh`**, **`/auth/logout`**, **`/auth/switch`**, **`/me/context`**; cookies are the source of truth. 
* **Redis keys**: `ev:{tenantId}:{userId}`, `permset:{tenantId}:{userId}`, `jti:block:{jti}` with **Mongo fallback** when Redis is unavailable. 
* Invite accept & founding tenant; tenant switch remints cookies and recomputes EV/permset; UI rebuilt from `/me/context`. 
* Security controls: SameSite+CSRF, HSTS/CSP, neutral errors; audit for exchanges/refresh/role changes; rate limits on exchange/refresh. 

**Future**

* Enterprise SSO, passkeys/WebAuthn at IdP, anomaly signals (device/UA/IP).

**Out-of-Scope**

* Payment onboarding, content moderation.

## Constraints & Assumptions

* **Hosting:** Frontend on **Cloudflare Pages** (alt: S3+CloudFront); Backend on **AWS Lambda + API Gateway (HTTP API)** via **Mangum**. 
* **TenantId** is injected server-side from session; ignore any client-provided tenant. 
* **401 EV_OUTDATED/EXPIRED** triggers silent refresh and a single retry (no popups). 

## UX Overview (Conceptual)

* **Login:** Supabase UI → **`/auth/exchange`** → cookies set → **`/me/context`** → UI builds nav/actions. 401 EV_OUTDATED/EXPIRED → silent `/auth/refresh` → retry once; seamless to user. 
* **Invite / Founding:** Invited or first user completes Supabase → **exchange** binds membership, seeds tenant (founding), and loads context. 
* **Tenant Switch:** Picker → **`/auth/switch`** → new cookies → fetch **`/me/context`** → rebuild nav/actions. 
* **Accessibility/i18n:** Keyboard-first forms, ARIA landmarks, EN baseline with locale-aware times.

## Dependencies & Integrations

* **Upstream:** Supabase (IdP), org-settings (policies), notifications (email/SMS).
* **Downstream:** Audit/logging, metrics, permission change events.
* **Conceptual events:** `auth.session.exchanged`, `auth.session.refreshed`, `auth.role.changed`, `auth.membership.activated`.

## Success Metrics & SLOs

* Login → Exchange → First API success ≥ **97%**; 401 EV_OUTDATED spikes **only after** role edits; P95 page ≤ 2s, action ≤ 1.5s. 

## **Redis Outage Behavior**

* **Reads:** Recompute **permset** and **EV** from Mongo synchronously; proceed only if checks pass (no bypass).
* **Writes/Privileged:** Require stable DB checks; if not confirmable, **fail closed** (503).
* **Token revocation:** If blocklist unavailable, validate against DB (`tokenFamilyVersion`, `lastLogoutAt`, `revokedAt`).
* **Thundering herd protection:** Single-flight per (tenantId,userId), bounded concurrency, short negative-cache TTL, circuit breaker if DB latency spikes.
* **User impact:** First guarded call may be slower; otherwise transparent. 

## Risks & Mitigations

* **Redis outage:** DB recompute path with alerts on miss ratio; backpressure to protect DB. 
* **Supabase outage:** Existing sessions OK until expiry; refresh may fail → prompt re-login. 
* **CSRF/XSS:** SameSite cookies + CSRF header; strict CSP (no inline). 
* **Tenant escape (IDOR):** Ignore client tenant; inject server-side; ABAC filters applied in queries. 

## Acceptance Criteria

* **AC-auth-onboarding-01 (must):** After Supabase sign-in, **`/auth/exchange`** sets HttpOnly cookies; **`/me/context`** returns `menuModel`; first API call P95 ≤ 1.5s. 
* **AC-auth-onboarding-02 (must):** Role/ABAC change → next guarded call returns **401 EV_OUTDATED** → silent `/auth/refresh` → UI menus/actions update without reload. 
* **AC-auth-onboarding-03 (should):** **`/auth/switch`** re-mints cookies; **`/me/context`** reflects new tenant pages/actions. 
* **AC-auth-onboarding-04 (should):** Invite/founding flows bind membership and seed tenant as required; audit records exchanges/activations. 
* **AC-auth-onboarding-05 (should):** Security headers (HSTS, CSP no-inline) + SameSite+CSRF enforced; neutral errors (no user enumeration). 
* **AC-auth-onboarding-06 (could):** **`/me/context`** may include ABAC hints to pre-filter UI (e.g., allowed rooms). 
* **AC-auth-onboarding-07 (must):** With Redis unavailable, a guarded **read** recomputes from Mongo and succeeds ≤ **800 ms P95** at 50 RPS; a guarded **write** returns **503** if safety checks can’t be confirmed. 
* **AC-auth-onboarding-08 (should):** After a role change during a Redis outage, subsequent requests yield **401 EV_OUTDATED** within one request after Redis recovery or after `/auth/refresh` re-mint. 

---

## Machine Summary (for Cursor)

```json
{
  "featureSlug": "auth-onboarding",
  "goals": [
    "Supabase-in-browser login; backend cookie sessions via /auth/exchange",
    "/me/context drives UI pages and actions",
    "Redis EV/permset/JTI on guarded requests with Mongo fallback",
    "Invite + founding tenant + safe tenant switch"
  ],
  "nonGoals": ["Native password/MFA UIs", "Enterprise SSO (later)", "DB spec"],
  "routesCore": ["/auth/exchange","/auth/refresh","/auth/logout","/auth/switch","/me/context"],
  "successSLOs": {"pageLoadP95Sec": 2.0, "actionP95Sec": 1.5},
  "acceptanceCriteria": [
    {"id":"AC-auth-onboarding-01","text":"Exchange sets cookies; /me/context renders; first API P95<=1.5s"},
    {"id":"AC-auth-onboarding-02","text":"EV change → 401 EV_OUTDATED → silent refresh → UI updates"},
    {"id":"AC-auth-onboarding-03","text":"Tenant switch re-mints cookies; context updates"},
    {"id":"AC-auth-onboarding-04","text":"Invite/founding bind membership; audited"},
    {"id":"AC-auth-onboarding-05","text":"Security headers + SameSite + CSRF"},
    {"id":"AC-auth-onboarding-06","text":"Optional ABAC hints in /me/context"},
    {"id":"AC-auth-onboarding-07","text":"Redis outage: read OK ≤800ms P95@50RPS; writes 503 if unsafe"},
    {"id":"AC-auth-onboarding-08","text":"Role change during outage → 401 EV_OUTDATED after recovery"}
  ],
  "dependencies": ["tenant","user","org-settings","notifications"],
  "compliance": ["FERPA","GDPR"],
  "observability": {
    "metrics":["exchange_success_rate","refresh_success_rate","latency_p95_ms","ev_outdated_rate","403_denied_rate"],
    "alerts":["exchange_failures_spike","refresh_failures_spike","redis_miss_ratio_high","403_rate_surge"]
  },
  "serverless": true,
  "references": {
    "authPart1":"Authentication Design Document - Part 1.docx",
    "authPart2":"Authentication Desing Document - Part 2.docx",
    "frontendContext":"frontend_context.md",
    "systemOverview":"system_overview_v3.md"
  }
}
```