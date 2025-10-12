"""
main.py

FastAPI application factory for the KydoHub backend (AWS Lambda compatible).

Non-developer summary (what this file does):
--------------------------------------------
- Sets up JSON logging (with requestId) and builds the FastAPI app.
- Adds middlewares (in a secure, intentional order):
    1) RequestId (adds/echoes X-Request-ID; sets Cache-Control: no-store)
    2) GZip (compress responses over 1KB)
    3) Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
    4) Auth rate limiting (IP + user for /auth/*, Redis-backed, graceful fallback)
    5) Strict CORS (credentials, allow-listed origins only)
- Mounts routes:
    - Health: /healthz, /readyz
    - All auth routes under API base path (e.g., /api/v1)
- Installs uniform error handlers so all errors look like:
    { "error": { "code", "message", "requestId", "details?" } }
- Exposes the AWS Lambda handler (via Mangum).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from mangum import Mangum

from .core.config import get_settings
from .core.logging import configure_logging
from .core.errors import (
    http_exception_handler,
    app_error_handler,
    validation_exception_handler,
    unhandled_exception_handler,
    AppError,
)
from .middleware.request_id import RequestIdMiddleware
from .middleware.security_headers import SecurityHeadersMiddleware
from .middleware.rate_limit import AuthRateLimitMiddleware
from .middleware.cors import CORSMiddlewareStrict
from .routers import health as health_router
from .routers.auth_routes_mount import register_routes as register_auth_routes


def create_app() -> FastAPI:
    """
    Build and configure the FastAPI application.

    Middleware order matters:
      1) RequestId → 2) GZip → 3) SecurityHeaders → 4) AuthRateLimit → 5) CORS
    """
    s = get_settings()

    # 1) Logging (structured JSON with requestId, service, stage)
    configure_logging(s.LOG_LEVEL)

    # 2) App instance
    app = FastAPI(
        title="KydoHub Backend",
        version="1.0.0",
        openapi_url="/openapi.json",  # keep OpenAPI available; can restrict per stage
        docs_url="/docs" if s.APP_STAGE != "prod" else None,  # hide Swagger in prod
        redoc_url=None,
    )

    # 3) Middlewares (secure order)
    app.add_middleware(RequestIdMiddleware)                 # adds/echoes X-Request-ID + Cache-Control: no-store
    app.add_middleware(GZipMiddleware, minimum_size=1024)   # compress larger payloads
    app.add_middleware(SecurityHeadersMiddleware)           # baseline security headers
    app.add_middleware(AuthRateLimitMiddleware)             # rate limiting for /auth/* (Redis-backed, graceful fallback)
    app.add_middleware(CORSMiddlewareStrict)                # strict allow-list CORS with credentials

    # CSRF: intentionally NOT global middleware.
    # We enforce CSRF inside sensitive web routes (/auth/refresh, /auth/switch)
    # using double-submit + Origin/Referer checks as per the security design.

    # 4) Routers
    # Health endpoints at root for infra checks (/healthz, /readyz)
    app.include_router(health_router.router, prefix="")
    # All auth & /me/context routes under API base path (e.g., /api/v1)
    register_auth_routes(app)

    # Minimal root route for quick diagnostics
    @app.get("/")
    async def root():
        return JSONResponse({"service": s.APP_NAME, "stage": s.APP_STAGE})

    # 5) Error handlers (uniform envelope everywhere)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    return app


# App instance for local uvicorn runs, e.g.:
# uvicorn apps.backend.app.main:app --reload --port 8000
app = create_app()

# AWS Lambda handler via Mangum (lifespan disabled to speed cold starts)
handler = Mangum(app, lifespan="off")
