---
doc_type: user_stories
feature_slug: auth-onboarding
version: 0.2.1
status: draft
last_updated: 2025-10-05T23:59:00Z
owners:
  product: "TBD"
  qa: "TBD"
priorityFramework: "MoSCoW"
estimationUnit: "storyPoints"
---

# Title
Authentication & RBAC Onboarding — User Stories

## Story Set Overview
- **MVP vs Later**
  - **MVP:** session exchange, `/me/context` render, silent refresh on EV changes, tenant switch, logout.
  - **Later:** anomaly signals during refresh, enterprise SSO, passkeys.
- **Dependencies**
  - Supabase (IdP), Redis (EV/permset/JTI, optional), MongoDB Atlas, Notifications (invites), Cloudflare Pages + API Gateway/Lambda.
- **Assumptions**
  - No tokens stored in JS; cookies are SoT.
  - Redis may be unavailable; reads degrade to DB recompute; writes fail closed.

---

## Stories

### US-auth-onboarding-01 — Exchange session after Supabase login
**As a** signed-in user at Supabase  
**I want** my browser session exchanged for secure HttpOnly cookies  
**So that** I can use the app without exposing tokens to JS

**Description**
- After Supabase success, FE calls `POST /auth/exchange`; backend sets access/refresh/CSRF cookies; FE fetches `/me/context`.

**Acceptance Criteria (Gherkin)**
```

Scenario: Successful exchange after Supabase login
Given I have just completed Supabase login
When the app calls POST /auth/exchange
Then the server sets HttpOnly access and refresh cookies
And a CSRF cookie/token is set for unsafe methods
And a subsequent GET /me/context succeeds

Scenario: Exchange with non-member
Given I completed Supabase login with an email not invited to the tenant
When the app calls POST /auth/exchange
Then the server responds 403 without setting cookies
And the UI shows a neutral "no access" message

```

**Edge Cases**
- Supabase token audience mismatch; clock skew within 2 minutes.

**Negative Tests**
- Replay of an old Supabase token → 401/400 with neutral error.

**Non-Functional Notes**
- P95 end-to-first-context ≤ 1.5s.

**Traceability**
- **Acceptance Criteria IDs:** [`AC-auth-onboarding-01`]
- **Endpoints (operationId):** [`auth.exchange`, `me.context`]
- **DB Fields:** [`membership.tenant_id`, `membership.roles`, `user.lastLogoutAt`]

**Permissions**
- Allowed: any authenticated user; 403 if not tenant member.

**Priority:** Must  
**Estimate:** 5  
**Test Types:** integration, e2e  
**Critical Paths:** `exchange→context`  
**Open Questions:** Cookie domain for CF Pages vs API.

---

### US-auth-onboarding-02 — Build UI from `/me/context`
**As a** signed-in user  
**I want** the app to render only the pages/actions I’m allowed  
**So that** I don’t see forbidden features

**Description**
- FE loads `/me.context` and constructs navigation and action gates from `menuModel` + `permissions`.

**Acceptance Criteria (Gherkin)**
```

Scenario: Context drives allowed UI
Given I am a teacher in Tenant A
When the app calls GET /me/context
Then the navigation shows only teacher pages
And actions render only when required ⊆ permissions

Scenario: Forbidden page deep link
Given I deep-link to an admin-only route
When the route guard checks permissions
Then I see 403 UI (or redirect to a safe page)

```

**Edge Cases**
- Empty permission set (suspended user) → “No access in this tenant” screen.

**Negative Tests**
- Client attempts to pass a tenantId → ignored server-side.

**Non-Functional Notes**
- Context payload < 32KB; P95 ≤ 200ms on warm paths.

**Traceability**
- **AC IDs:** [`AC-auth-onboarding-01`, `AC-auth-onboarding-06`]
- **Endpoints:** [`me.context`]
- **DB Fields:** [`membership.roles`, `membership.abac.rooms`]

**Permissions:** Any authenticated user.  
**Priority:** Must — **Estimate:** 5 — **Tests:** unit (gates), e2e — **Critical Paths:** `context-render`

---

### US-auth-onboarding-03 — Silent refresh on EV change
**As a** user with changed permissions  
**I want** the app to refresh silently when entitlements change  
**So that** my UI updates without manual reload

**Description**
- Guarded call returns 401 `EV_OUTDATED` → FE calls `POST /auth/refresh` → retries the original request once and rebuilds UI.

**Acceptance Criteria (Gherkin)**
```

Scenario: EV changed by admin
Given my role was edited by an admin
And my next guarded request uses an access cookie with old EV
When the server responds 401 EV_OUTDATED
Then the client silently calls POST /auth/refresh
And the retried request succeeds
And the UI updates using new /me/context

```

**Edge Cases**
- Refresh token rotation; reuse attempt → 403 and sign-out.

**Negative Tests**
- Refresh called with missing cookie → 401 and redirect to login.

**Non-Functional Notes**
- Refresh path P95 ≤ 400ms on warm Redis; ≤ 800ms during Redis outage.

**Traceability**
- **AC IDs:** [`AC-auth-onboarding-02`, `AC-auth-onboarding-08`]
- **Endpoints:** [`auth.refresh`, `me.context`]
- **DB Fields:** [`session.familyVersion`, `user.lastLogoutAt`]

**Permissions:** Any authenticated user.  
**Priority:** Must — **Estimate:** 3 — **Tests:** integration, e2e — **Critical Paths:** `401→refresh→retry`

---

### US-auth-onboarding-04 — Tenant switch
**As a** multi-tenant user  
**I want** to switch the active tenant safely  
**So that** my context and permissions reflect the selected tenant

**Description**
- FE opens picker → calls `POST /auth/switch` → cookies re-minted → fetch `/me/context`.

**Acceptance Criteria (Gherkin)**
```

Scenario: Switch to another tenant I belong to
Given I belong to Tenant A and Tenant B
When I choose Tenant B and call POST /auth/switch
Then the server re-mints cookies scoped to Tenant B
And GET /me/context shows pages/actions for Tenant B

Scenario: Switch to unauthorized tenant
Given I do not belong to Tenant C
When I attempt POST /auth/switch with tenantId C
Then the server returns 403 and keeps the current tenant active

```

**Edge Cases**
- Rapid toggle A↔B within 10s; ensure context invalidation.

**Negative Tests**
- Client-supplied tenantId mismatched with membership → 403.

**Non-Functional Notes**
- P95 switch (call + context) ≤ 800ms.

**Traceability**
- **AC IDs:** [`AC-auth-onboarding-03`]
- **Endpoints:** [`auth.switch`, `me.context`]
- **DB Fields:** [`membership.tenant_id`, `membership.roles`]

**Permissions:** Only members of target tenant.  
**Priority:** Must — **Estimate:** 5 — **Tests:** e2e — **Critical Paths:** `switch→context`

---

### US-auth-onboarding-05 — Secure logout with JTI block
**As a** signed-in user  
**I want** to log out securely  
**So that** my session cannot be reused

**Description**
- `POST /auth/logout` clears cookies and records JTI blocklist (or DB fields if Redis unavailable).

**Acceptance Criteria (Gherkin)**
```

Scenario: Successful logout
Given I am signed in
When I call POST /auth/logout
Then the server clears all session cookies
And subsequent requests are denied with 401 until a new exchange

```

**Edge Cases**
- Concurrent tabs; all must see 401 after logout.

**Negative Tests**
- Calling logout without a valid session → 204 idempotent response.

**Non-Functional Notes**
- Audit log entry is recorded.

**Traceability**
- **AC IDs:** [`AC-auth-onboarding-01`]
- **Endpoints:** [`auth.logout`]
- **DB Fields:** [`session.jti`, `user.lastLogoutAt`]

**Permissions:** Any authenticated user.  
**Priority:** Must — **Estimate:** 2 — **Tests:** integration, e2e — **Critical Paths:** `logout→deny`

---

### US-auth-onboarding-06 — Read-path resilience without Redis
**As a** signed-in user during cache outage  
**I want** guarded reads to keep working  
**So that** I can continue using the app with minimal delay

**Description**
- If Redis is down, server recomputes permset and EV from Mongo synchronously; no bypass of checks.

**Acceptance Criteria (Gherkin)**
```

Scenario: Redis outage on first guarded request
Given Redis is unavailable
When I perform a guarded GET
Then the server recomputes my permset from Mongo
And the request succeeds if I am authorized
And the latency remains ≤ 800ms P95 at 50 RPS

```

**Edge Cases**
- Circuit breaker trips when DB latency spikes → 503 to shed load.

**Negative Tests**
- Return 503 for privileged writes when safety checks cannot complete.

**Non-Functional Notes**
- Emit redis_unavailable and permset_recompute metrics.

**Traceability**
- **AC IDs:** [`AC-auth-onboarding-07`]
- **Endpoints:** [`me.context` (as representative guarded read)]
- **DB Fields:** [`membership.roles`, `membership.permissions_flat`]

**Permissions:** N/A beyond normal authz.  
**Priority:** Should — **Estimate:** 3 — **Tests:** resilience, perf — **Critical Paths:** `fallback-read`

---

### US-auth-onboarding-07 — CSRF protection on unsafe methods
**As a** signed-in user  
**I want** protection from CSRF on unsafe calls  
**So that** only deliberate actions succeed

**Description**
- Unsafe methods must include CSRF header that matches the CSRF cookie; FE component ensures this automatically.

**Acceptance Criteria (Gherkin)**
```

Scenario: CSRF header present
Given I am signed in
When the client sends a POST with a valid X-CSRF header
Then the server accepts the request if authorized

Scenario: Missing/invalid CSRF
Given I am signed in
When the client sends a POST without a valid X-CSRF
Then the server returns 403 with a neutral message

````

**Edge Cases**
- SameSite=Lax vs Strict during cross-site redirects.

**Negative Tests**
- Attempt to forge form POST from another origin → 403.

**Non-Functional Notes**
- No inline scripts; strong CSP enforced in FE build.

**Traceability**
- **AC IDs:** [`AC-auth-onboarding-05`]
- **Endpoints:** [any unsafe op; auth endpoints already covered]
- **DB Fields:** none

**Permissions:** N/A beyond normal authz.  
**Priority:** Must — **Estimate:** 3 — **Tests:** integration, security — **Critical Paths:** `csrf-guard`

---

## Backlog Summary
- **MVP:** `US-auth-onboarding-01`, `US-auth-onboarding-02`, `US-auth-onboarding-03`, `US-auth-onboarding-04`, `US-auth-onboarding-05`
- **Post-MVP:** `US-auth-onboarding-06`, `US-auth-onboarding-07`
- **Spikes (optional):**
  - `SPK-auth-onboarding-01` — Cookie domain strategy across CF Pages + API (timebox: 1d)
  - `SPK-auth-onboarding-02` — EV/JTI metrics dashboard (timebox: 1d)

---

## Machine Summary (for Cursor)
```json
{
  "featureSlug": "auth-onboarding",
  "stories": [
    {
      "id": "US-auth-onboarding-01",
      "title": "Exchange session after Supabase login",
      "acIds": ["AC-auth-onboarding-01"],
      "operationIds": ["auth.exchange","me.context"],
      "dbFields": ["membership.tenant_id","membership.roles","user.lastLogoutAt"],
      "priority": "Must",
      "estimate": 5,
      "testTypes": ["integration","e2e"],
      "criticalPaths": ["exchange->context"]
    },
    {
      "id": "US-auth-onboarding-02",
      "title": "Build UI from /me/context",
      "acIds": ["AC-auth-onboarding-01","AC-auth-onboarding-06"],
      "operationIds": ["me.context"],
      "dbFields": ["membership.roles","membership.abac.rooms"],
      "priority": "Must",
      "estimate": 5,
      "testTypes": ["unit","e2e"],
      "criticalPaths": ["context-render"]
    },
    {
      "id": "US-auth-onboarding-03",
      "title": "Silent refresh on EV change",
      "acIds": ["AC-auth-onboarding-02","AC-auth-onboarding-08"],
      "operationIds": ["auth.refresh","me.context"],
      "dbFields": ["session.familyVersion","user.lastLogoutAt"],
      "priority": "Must",
      "estimate": 3,
      "testTypes": ["integration","e2e"],
      "criticalPaths": ["401->refresh->retry"]
    },
    {
      "id": "US-auth-onboarding-04",
      "title": "Tenant switch",
      "acIds": ["AC-auth-onboarding-03"],
      "operationIds": ["auth.switch","me.context"],
      "dbFields": ["membership.tenant_id","membership.roles"],
      "priority": "Must",
      "estimate": 5,
      "testTypes": ["e2e"],
      "criticalPaths": ["switch->context"]
    },
    {
      "id": "US-auth-onboarding-05",
      "title": "Secure logout with JTI block",
      "acIds": ["AC-auth-onboarding-01"],
      "operationIds": ["auth.logout"],
      "dbFields": ["session.jti","user.lastLogoutAt"],
      "priority": "Must",
      "estimate": 2,
      "testTypes": ["integration","e2e"],
      "criticalPaths": ["logout->deny"]
    },
    {
      "id": "US-auth-onboarding-06",
      "title": "Read-path resilience without Redis",
      "acIds": ["AC-auth-onboarding-07"],
      "operationIds": ["me.context"],
      "dbFields": ["membership.roles","membership.permissions_flat"],
      "priority": "Should",
      "estimate": 3,
      "testTypes": ["resilience","perf"],
      "criticalPaths": ["fallback-read"]
    },
    {
      "id": "US-auth-onboarding-07",
      "title": "CSRF protection on unsafe methods",
      "acIds": ["AC-auth-onboarding-05"],
      "operationIds": [],
      "dbFields": [],
      "priority": "Must",
      "estimate": 3,
      "testTypes": ["integration","security"],
      "criticalPaths": ["csrf-guard"]
    }
  ],
  "mvp": [
    "US-auth-onboarding-01",
    "US-auth-onboarding-02",
    "US-auth-onboarding-03",
    "US-auth-onboarding-04",
    "US-auth-onboarding-05"
  ],
  "postMvp": ["US-auth-onboarding-06","US-auth-onboarding-07"],
  "impactAreas": ["frontend","backend","tests"],
  "references": {
    "prd": "prd.md",
    "frontend": "frontend_spec.md",
    "backend": "backend_spec.md"
  }
}
````
