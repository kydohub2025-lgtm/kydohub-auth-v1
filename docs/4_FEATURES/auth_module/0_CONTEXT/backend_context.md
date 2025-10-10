# Backend Context — Daycare SaaS

## Hosting & Runtime
- **Framework:** FastAPI (Python, async, Pydantic, Beanie ODM for MongoDB).  
- **Deployment:** AWS Lambda behind API Gateway (HTTP API).  
- **Adapter:** Mangum (translates API Gateway events to ASGI for FastAPI).  
- **Infra-as-Code:** Terraform / SAM / Serverless Framework.  

## Core Responsibilities
- **Auth Integration:**  
  - Accept Supabase session token from frontend (`/auth/exchange`).  
  - Validate session, issue HttpOnly cookies (access + refresh).  
  - Provide `/auth/refresh`, `/auth/logout`, `/me/context`.  

- **Multi-Tenancy:**  
  - Tenant ID is injected server-side from session, never accepted from client.  
  - All queries scoped by `{ tenantId, ... }`.  

- **RBAC / Permissions:**  
  - Each membership has roles and entitlements.  
  - Return role-based menu/actions via `/me/context`.  
  - Enforce role/permission check per API route.  

- **Data:**  
  - MongoDB Atlas (multi-tenant).  
  - Collections: tenants, users, memberships, students, guardians, staff, rooms, attendance, messages.  
  - Use Beanie ODM models with compound indexes including `tenantId`.  

- **Cache:**  
  - Redis (ElastiCache Serverless or Upstash).  
  - Store EV (entitlements version), permset cache, and JTI blocklist.  

- **File Handling:**  
  - Provide `/files/presign` endpoint for S3 uploads/downloads.  
  - Enforce size/content-type limits.  

- **Async Jobs:**  
  - Heavy processes (reports, imports) via SQS + Lambda worker.  
  - Scheduled tasks (rollups, reminders) via EventBridge Scheduler.  

## Constraints & Limits
- API Gateway payload limit: 10 MB.  
- API Gateway timeout: 30 seconds.  
- Lambda max runtime: 15 minutes.  
- Use async + SQS/Step Functions for long-running tasks.  
- Connections to MongoDB Atlas: reuse client across invocations.  

## Security
- **Cookies:** HttpOnly, Secure, SameSite=Lax/Strict.  
- **JWTs:** Short-lived access, rotating refresh, JTI blocklist.  
- **CSRF:** Double-submit token on unsafe methods.  
- **Headers:** Apply HSTS, CSP, frame-ancestors, etc.  
- **Audit:** Log auth events, membership changes, role assignments.  

## Developer Notes
- Keep Lambdas lightweight; use Layers for dependencies.  
- Structure code with `/api`, `/core`, `/models`, `/repositories`, `/services`, `/workers`.  
- Always return errors in consistent JSON format with error codes.  
- Ensure endpoints are idempotent (use request IDs for PUT/PATCH/DELETE).  
- Add health endpoints (`/health/live`, `/health/ready`).  

