# Authentication Context — Daycare SaaS

## Identity & Session Flow
- Identity Provider Supabase (sign-in, sign-up, SSO, MFA, password resets).  
- Login flow  
  1. Browser signs in via Supabase client.  
  2. Browser immediately calls `POST authexchange` with Supabase session.  
  3. Backend verifies with Supabase, creates session, sets HttpOnly cookies (access, refresh, csrf).  
  4. Browser discards Supabase session; cookies are now the source of truth.  

## Tokens & Cookies
- Access cookie (JWT)  
  - Claims `sub` (supabase_user_id), `tid`, `rids`, `ev`, `jti`, `exp`.  
  - TTL ~15–30 min.  
  - HttpOnly, Secure, SameSite=StrictLax.  
- Refresh cookie  
  - Opaque, rotated on each use.  
  - TTL 7–30 days.  
  - Stored hashed server-side.  
- CSRF cookie  
  - Non-HttpOnly.  
  - Must be echoed in header for POSTPUTPATCHDELETE.  

## Backend Endpoints
- `POST authexchange` → validate Supabase session, set cookies.  
- `POST authrefresh` → rotate refresh, set new access.  
- `POST authlogout` → revoke refresh.  
- `GET mecontext` → return pagesactions model for UI.  
- `POST authswitch` → tenant switch (new `tid`, new access cookie).  

## Enforcement
- Every request  
  - Verify JWT sigexp.  
  - Check JTI blocklist.  
  - Compare `token.ev` vs `Redis ev{tid}{uid}`.  
  - Load permset from Redis (or rebuild from Mongo).  
  - Check route permission.  
  - Inject `tenantId` server-side into all DB queries.  

## RBAC + ABAC
- Roles grant permissions (e.g., `students.read`, `attendance.mark`).  
- ABAC adds filters (e.g., teachers limited to certain rooms, parents limited to their children).  
- UI permissions model comes from `mecontext`; no hardcoding.  

## Redis Usage
- `ev{tid}{uid}` → entitlements version; bumps on any RBAC change.  
- `permset{tid}{uid}` → flattened list of permissions (TTL 5–15 min).  
- `jtiblock{jti}` → revoked tokens.  
- Graceful fallback if Redis is down, backend recomputes from Mongo (slower).  

## Security Controls
- HttpOnly, Secure cookies; no tokens in JS.  
- CSRF double-submit protection.  
- Headers HSTS, CSP (no inline scripts), X-Content-Type-Options, frame-ancestors, Referrer-Policy.  
- Rate limiting on `authexchange`, `authrefresh`, admin endpoints.  
- Audit log logins, exchanges, refreshes, role changes (never secrets).  

## ErrorRecovery Scenarios
- Access expired API → 401 EXPIRED → browser calls `authrefresh` silently.  
- RBAC changed API → 401 EV_OUTDATED → refresh → new UI menu.  
- Refresh revokedcompromised refresh fails → user redirected to login.  
- Tenant switch `authswitch` issues new cookies; API calls scoped to new tenant.  
- Supabase outage existing sessions continue until expiry; refresh may fail → re-login.  

## Executive Summary
- Identity at Supabase, authorization in Mongo, speed & revocation via Redis.  
- Cookies (not tokens in JS) are the source of truth.  
- UI is data-driven from `mecontext`.  
- RBACABAC changes take instant effect via ev versioning.  
