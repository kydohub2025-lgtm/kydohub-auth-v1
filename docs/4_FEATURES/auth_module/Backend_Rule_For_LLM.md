# Backend Rules for Cursor/ChatGPT (FastAPI + Beanie + Mongo + Redis + Celery)
## Scope
- Multi-tenant daycare backend using **FastAPI**, **Beanie/Motor (MongoDB Atlas)**, **Redis**, **Celery**, **S3**.
- JWT auth with **tenant isolation** at the data layer.

## 1) Dependencies & Config (must-follow)
- Use **pip-tools**: edit `requirements.in` / `requirements-dev.in` → compile to `requirements.txt` / `requirements-dev.txt` **with hashes**. CI/prod install with `--require-hashes`.
- Config via **Pydantic Settings** only. **No hardcoded secrets**. `.env` used only for local dev; prod reads from Secrets Manager.
- Envs: `dev`, `staging`, `prod` share the same keys.

## 2) Security & Auth (hard requirements)
- OAuth2 + **JWT** claims: `sub`, `tenant_id`, `tenant_code`, `roles`, `jti`, `iat`, `exp`.
- Token policy: access 15–30m; **rotating refresh**; **Redis blocklist** by `jti` (check on every request).
- Algorithms: **Dev HS256**, **Prod RS256/EdDSA with JWKS** (include `kid`).
- **CORS:** allow only our configured frontend origins (from settings).
- **Headers:** set `X-Content-Type-Options=nosniff`; protect docs/admin with `X-Frame-Options=DENY` or CSP `frame-ancestors`.
- Never log secrets/PII; hash passwords with **bcrypt/argon2**.

## 3) Multitenancy (always-on guardrails)
- Every document includes `tenant_id` and `audit{created_by,updated_by,created_at,updated_at}`.
- **All queries** are auto-scoped by `tenant_id` from a request context dependency. **No unscoped collection access.**
- All **unique indexes** are **compound with `tenant_id`**.

## 4) Project structure (generate code to fit this)
```

src/app/
main.py
settings.py
db.py
logging.py
multitenancy/{base_document.py, dependency.py}
security/{auth.py, jwts.py, password.py, rbac.py}
models/{tenant.py, user.py, child.py}
routers/{health.py, auth.py, tenants.py, users.py, children.py}
services/{email.py}
tasks/{celery_app.py, notifications.py}
utils/{pagination.py, responses.py}

```

## 5) API Contract (apply to every endpoint)
- Prefix **`/v1`**; use `response_model` with `exclude_none=True`.
- Pagination: `limit` (default 25, max 100) + `offset`. Provide filtering/sorting via query params.
- Support `Idempotency-Key` for retry-prone POSTs.
- Validate `Content-Type`; enforce request size caps; reasonable timeouts.
- OpenAPI UI enabled only in non-prod (or protected in prod).

## 6) Errors (uniform shape)
- Never expose stack traces. Return `{code, message, details?, request_id}` with correct HTTP status.
- Use FastAPI exception handlers; capture to **Sentry**.

## 7) Logging, Tracing, Metrics (instrument generated code)
- **Structured JSON logs** incl. `request_id`, `trace_id`, `tenant_id`, `user_id`, `route`, `status`, `dur_ms`.
- Accept/generate `X-Request-ID` and echo back.
- **OpenTelemetry** tracing (FastAPI, Mongo, Redis, Celery) export via OTLP.
- **Prometheus** metrics: latency histograms, error rate, DB timings, Celery queue lag, cache hit rate.
- Log sampling: ~1% of successful hot paths; **never** sample out errors/security logs.

## 8) Data & Indexing (for all models)
- Base class: `TenantDocument(Document)` with `tenant_id` + `audit`.
- Declare indexes in model Settings; **compound uniqueness with `tenant_id`**.
- Minimize PII; rely on Atlas encryption at rest; consider field-level encryption if needed.

## 9) Background Jobs & Cache
- **Celery** tasks are idempotent; retries with exponential backoff; separate `critical` and `bulk` queues.
- **Redis cache**: namespaced/versioned keys, TTL required, avoid stampedes (lock/SWR), invalidate on writes.

## 10) Health/Readiness
- `/healthz` (app up) and `/readyz` (Mongo/Redis/S3 reachable).
- Startup checks wire DB + Beanie; fail fast if settings invalid.

## 11) Code Quality (generation defaults)
- **Type hints everywhere**; ruff + black compliant; docstrings on public functions/classes.
- Services hold business logic; routers stay thin.
- Use `Depends(...)` for auth/tenant context; no global state.

## 12) Tests (what to always include)
- Unit tests for services/utils; integration tests for routers with test Mongo/Redis containers.
- Security/tenancy tests: cross-tenant access **must fail**.
- Smoke test for `/healthz` and one auth happy path.

## 13) CI/CD hooks the code depends on
- CI: ruff → black --check → (mypy optional) → pytest → **pip-audit** → build Docker → Trivy image scan.
- Install from locks with `--require-hashes`.
- Document migrations/index changes with each PR.

## 14) Things the model must NOT do
- ❌ Query without tenant filter or bypass tenancy helpers.
- ❌ Log secrets, tokens, or PII.
- ❌ Hardcode secrets, origins, or env-specific values.
- ❌ Open CORS to `*` in real code (tests may override).

## 15) Snippets the model should reuse
- **JWT payload fields**: `sub, tenant_id, tenant_code, roles, jti, iat, exp`.
- **Request context**: `ctx = Depends(get_ctx)` → use `ctx.tenant_id` in all data access paths.
- **Base document**: `class TenantDocument(Document): tenant_id: Indexed(str); audit: Audit`.
- **Audit update**: update `audit.updated_at/updated_by` on writes (service layer helper).
```
