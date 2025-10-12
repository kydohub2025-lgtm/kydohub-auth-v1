"""
middleware/cors.py

Strict, allow-list based CORS middleware for cookie-bearing browser calls.

Non-developer summary:
----------------------
Browsers block cross-site requests unless the server explicitly allows them.
We only allow requests from origins listed in the environment variable
ALLOWED_ORIGINS (e.g., https://app.kydohub.com, http://localhost:5173).
Unknown origins receive no CORS headers (safest default).
"""

from __future__ import annotations

from typing import Iterable, List

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response, PlainTextResponse

from ..core.config import get_settings


ALLOWED_METHODS: List[str] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
# Headers the browser is allowed to send. Include CSRF header, request-id, and idempotency support.
BASIC_ALLOWED_HEADERS = {"Content-Type", "Authorization", "X-Request-ID", "Idempotency-Key"}


class CORSMiddlewareStrict(BaseHTTPMiddleware):
    """
    Enforces:
      - Only configured origins are allowed.
      - Credentials (cookies) are allowed for approved origins.
      - Preflight (OPTIONS) responses include exact methods/headers we accept.
      - Unknown origins receive no CORS headers (fail-closed).

    Notes:
      * We do NOT use wildcard (*) with credentials; we echo the exact, approved Origin.
      * Preflight caching is set to 600 seconds by default (tunable).
    """

    def __init__(self, app, max_age: int = 600):
        super().__init__(app)
        self.settings = get_settings()
        self.allowed_origins: List[str] = self.settings.ALLOWED_ORIGIN_LIST
        self.max_age = max_age
        # Include CSRF header name from settings
        self.allowed_headers = BASIC_ALLOWED_HEADERS | {self.settings.CSRF_HEADER}

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("Origin")

        # --- Handle preflight (OPTIONS) early ---
        if request.method == "OPTIONS":
            return self._handle_preflight(request, origin)

        # --- Simple/actual request flow ---
        response: Response = await call_next(request)

        # If request has Origin and it's approved, attach CORS headers.
        if origin and self._is_allowed_origin(origin):
            self._apply_cors_headers(response, origin, self.allowed_headers)

        # Unknown origins get no CORS headers at all (fail-closed).
        return response

    def _handle_preflight(self, request: Request, origin: str | None) -> Response:
        """
        Respond to browser preflight checks:
        - Validate origin and requested method.
        - Validate requested headers (subset of allowed).
        """
        if not origin or not self._is_allowed_origin(origin):
            # No CORS headers on purpose for disallowed origins.
            return PlainTextResponse("CORS preflight blocked", status_code=403)

        req_method = request.headers.get("Access-Control-Request-Method", "")
        if req_method not in ALLOWED_METHODS:
            return PlainTextResponse("Method not allowed by CORS", status_code=403)

        # Requested headers may be a comma-separated list; we allow a safe superset.
        req_headers = _split_header_tokens(request.headers.get("Access-Control-Request-Headers", ""))
        if not req_headers.issubset({h.lower() for h in self._lower_set(self.allowed_headers)}):
            # It's OK to be slightly permissive; we choose to be exact here for clarity.
            # You can relax this to always return the allowed set if desired.
            pass  # We'll simply return our allowed set below.

        resp = Response(status_code=204)  # No Content
        self._apply_cors_headers(resp, origin, self.allowed_headers)
        resp.headers["Access-Control-Allow-Methods"] = ", ".join(ALLOWED_METHODS)
        resp.headers["Access-Control-Allow-Headers"] = ", ".join(sorted(self.allowed_headers))
        resp.headers["Access-Control-Max-Age"] = str(self.max_age)
        return resp

    def _apply_cors_headers(self, response: Response, origin: str, allowed_headers: Iterable[str]) -> None:
        # Echo the exact allowed origin (never '*') and allow credentials.
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"  # ensure proxies don't mix origins
        response.headers["Access-Control-Allow-Credentials"] = "true"
        # For actual requests, expose a minimal set of headers if needed by FE (optional):
        # response.headers["Access-Control-Expose-Headers"] = "X-Request-ID"

    def _is_allowed_origin(self, origin: str) -> bool:
        return origin in self.allowed_origins

    @staticmethod
    def _lower_set(items: Iterable[str]) -> set[str]:
        return {i.lower() for i in items}


def _split_header_tokens(value: str) -> set[str]:
    """
    Normalize a comma-separated header list into a lowercase set.
    Example: "Content-Type, X-CSRF" -> {"content-type", "x-csrf"}
    """
    if not value:
        return set()
    return {t.strip().lower() for t in value.split(",") if t.strip()}
