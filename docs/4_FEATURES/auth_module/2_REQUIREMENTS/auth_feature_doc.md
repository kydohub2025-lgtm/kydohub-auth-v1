---
doc_type: feature_context
feature_slug: auth-onboarding
version: 0.2.1
status: generated
last_updated: 2025-10-05T23:59:59Z
packSizeTokens: ~500
dependencies: ["tenant","user","org-settings","notifications"]
impactAreas: ["frontend","backend","tests"]
compliance: ["FERPA","GDPR"]
changelog:
  - "2025-10-05T23:59:59Z created"
---

## Summary
Supabase-in-browser login, backend `/auth/exchange` to mint HttpOnly cookies, UI driven by `/me/context` (pages/actions), with RBAC+ABAC enforced per-tenant. Redis accelerates EV/permset/JTI; if Redis is down, reads recompute from Mongo and writes fail closed.

## Contracts (Atoms Only)

### Acceptance Criteria (IDs + short titles)
- AC-auth-onboarding-01 — Exchange → cookies → `/me/context` renders
- AC-auth-onboarding-02 — EV change → 401 → silent refresh → UI updates
- AC-auth-onboarding-03 — Tenant switch re-mints cookies + context updates
- AC-auth-onboarding-04 — Invite/founding binds membership + audited
- AC-auth-onboarding-05 — Security headers + SameSite + CSRF
- AC-auth-onboarding-06 — Optional ABAC hints in `/me/context`
- AC-auth-onboarding-07 — Redis-outage read recompute ≤800ms P95@50RPS; writes 503
- AC-auth-onboarding-08 — Role change during outage → 401 after recovery/refresh

### Endpoints (operationId → method path)
- auth.exchange → POST /auth/exchange
- auth.refresh → POST /auth/refresh
- auth.logout → POST /auth/logout
- auth.switch → POST /auth/switch
- me.context → GET /me/context

### Key DB Fields
- membership.tenant_id
- membership.roles
- membership.permissions_flat
- user.lastLogoutAt
- session.familyVersion
- (ABAC hints as derived attributes, not stored separately)

### Telemetry Events (names only)
- ui.auth.exchange.submit | ui.auth.exchange.complete | ui.auth.exchange.error
- ui.auth.refresh.complete | ui.auth.refresh.error
- ui.auth.context.view
- ui.auth.tenantSwitch.submit | ui.auth.tenantSwitch.complete | ui.auth.tenantSwitch.error
- ui.auth.guard.retry

### Budgets & SLOs (light)
- UX SLOs: pageLoadP95 ≤ 2.0s, actionP95 ≤ 1.5s
- Perf: TTI ≤ 2000ms, INP ≤ 200ms, auth-screen bundle ≤ 200 KB

### Observability Anchors
- Logs: tenantId, userId, correlationId, operationId
- Metrics: exchange_success_rate, refresh_success_rate, latency_p95_ms, ev_outdated_rate, redis_miss_ratio
- Alerts: exchange_failures_spike, refresh_failures_spike, errorRate>2%, latency>3s, redis_miss_ratio>0.3

## References (Canonical Docs)
- PRD: prd.md
- Frontend Spec: frontend_spec.md
- Backend Spec: backend_spec.md
- User Stories: user_stories.md

## Machine Summary (for Cursor)
```json
{
  "featureSlug": "auth-onboarding",
  "ac": [
    {"id":"AC-auth-onboarding-01","title":"Exchange → cookies → /me/context renders"},
    {"id":"AC-auth-onboarding-02","title":"EV change → 401 → silent refresh → UI updates"},
    {"id":"AC-auth-onboarding-03","title":"Tenant switch re-mints cookies + context updates"},
    {"id":"AC-auth-onboarding-04","title":"Invite/founding binds membership + audited"},
    {"id":"AC-auth-onboarding-05","title":"Security headers + SameSite + CSRF"},
    {"id":"AC-auth-onboarding-06","title":"Optional ABAC hints in /me/context"},
    {"id":"AC-auth-onboarding-07","title":"Redis-outage read recompute; writes 503"},
    {"id":"AC-auth-onboarding-08","title":"Role change during outage → 401 after recovery/refresh"}
  ],
  "operationIds": [
    "auth.exchange","auth.refresh","auth.logout","auth.switch","me.context"
  ],
  "dbFields": [
    "membership.tenant_id","membership.roles","membership.permissions_flat","user.lastLogoutAt","session.familyVersion"
  ],
  "telemetry": [
    "ui.auth.exchange.submit","ui.auth.exchange.complete","ui.auth.exchange.error",
    "ui.auth.refresh.complete","ui.auth.refresh.error",
    "ui.auth.context.view",
    "ui.auth.tenantSwitch.submit","ui.auth.tenantSwitch.complete","ui.auth.tenantSwitch.error",
    "ui.auth.guard.retry"
  ],
  "budgets": {
    "pageLoadP95Sec": 2.0,
    "actionP95Sec": 1.5,
    "ttiMs": 2000,
    "inpMs": 200,
    "bundleKb": 200
  },
  "observability": {
    "logFields":["tenantId","userId","correlationId","operationId"],
    "metrics":["exchange_success_rate","refresh_success_rate","latency_p95_ms","ev_outdated_rate","redis_miss_ratio"],
    "alerts":["exchange_failures_spike","refresh_failures_spike","errorRate>2%","latency>3s","redis_miss_ratio>0.3"]
  },
  "dependencies": ["tenant","user","org-settings","notifications"],
  "compliance": ["FERPA","GDPR"],
  "references": {
    "prd":"prd.md",
    "frontend":"frontend_spec.md",
    "backend":"backend_spec.md",
    "stories":"user_stories.md"
  }
}
````
