"""
middleware/security_headers.py

Baseline security headers applied to all responses.

Non-developer summary:
----------------------
These headers harden the API by preventing common attacks (content-type sniffing,
clickjacking) and by limiting how much referrer information the browser sends.
A stricter Content Security Policy (CSP) should be configured at the CDN/API edge.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from starlette.responses import Response
from fastapi import Request


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Apply a minimal set of security headers to every response.

    Notes:
    - We do not set CSP here (prefer the CDN/API Gateway for CSP).
    - We do not set HSTS here; that should be enforced on the public HTTPS domain at the edge.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        resp: Response = await call_next(request)

        # Prevent content-type sniffing
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        # Disallow embedding the API in iframes
        resp.headers.setdefault("X-Frame-Options", "DENY")
        # Limit referrer data on cross-origin requests
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")

        # If you later want to add a minimal CSP from the app, uncomment and tune:
        # resp.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none';")

        return resp
