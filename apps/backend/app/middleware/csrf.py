"""
middleware/csrf.py

CSRF defense for browser-based (cookie) sessions:
- Enforces allow-listed Origin/Referer for unsafe methods.
- Requires a matching CSRF header and CSRF cookie (double-submit).
- Applies only when session cookies are present (web cookie mode).
"""

from __future__ import annotations

from typing import Callable, Optional
from urllib.parse import urlparse

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from ..core.config import get_settings
from ..core.errors import AppError


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class CSRFMiddleware(BaseHTTPMiddleware):
    """
    When does this run?
    -------------------
    - Only for state-changing methods (POST/PUT/PATCH/DELETE).
    - Only if we detect cookie-based session usage (presence of session/refresh cookie).

    What does it verify?
    --------------------
    1) Origin/Referer: must match one of the configured ALLOWED_ORIGINS.
    2) Double-submit token: header X-CSRF must exactly equal the value of the CSRF cookie.

    What it does NOT affect:
    ------------------------
    - Bearer-token mobile clients (they won't send our cookies).
    - Safe methods (GET/HEAD/OPTIONS).
    """

    def __init__(self, app):
        super().__init__(app)
        s = get_settings()
        self.allowed_origins = set(s.ALLOWED_ORIGIN_LIST)
        self.header_name = s.CSRF_HEADER
        self.cookie_name = s.CSRF_COOKIE
        self.access_cookie = s.ACCESS_COOKIE
        self.refresh_cookie = s.REFRESH_COOKIE

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip for safe methods
        if request.method not in UNSAFE_METHODS:
            return await call_next(request)

        # Only enforce CSRF if this looks like a web cookie session
        if not self._has_web_session_cookie(request):
            # Likely a mobile/bearer client; CSRF not applicable
            return await call_next(request)

        # 1) Origin / Referer checks (defense in depth)
        self._enforce_same_site_origin(request)

        # 2) Double-submit token check
        self._enforce_double_submit(request)

        # If all checks pass, continue
        return await call_next(request)

    # ---------------- Internal helpers ----------------

    def _has_web_session_cookie(self, request: Request) -> bool:
        """
        Returns True if request carries our session/refresh cookies,
        indicating a browser cookie flow.
        """
        cookies = request.cookies or {}
        return (self.access_cookie in cookies) or (self.refresh_cookie in cookies)

    def _enforce_same_site_origin(self, request: Request) -> None:
        """
        Allow only requests originating from our allow-listed frontend origins.
        We prefer the Origin header; if missing (older browsers), we fall back to Referer.
        """
        origin = request.headers.get("Origin")
        if origin:
            if origin not in self.allowed_origins:
                # Unknown Origin attempting a state change
                raise AppError(
                    "ORIGIN_MISMATCH",
                    "Request origin is not allowed.",
                    status=403,
                    details={"origin": origin},
                )
            return

        # Fallback: derive origin from Referer, if present
        referer = request.headers.get("Referer")
        if referer:
            parsed = urlparse(referer)
            ref_origin = f"{parsed.scheme}://{parsed.netloc}"
            if ref_origin not in self.allowed_origins:
                raise AppError(
                    "ORIGIN_MISMATCH",
                    "Request referer is not allowed.",
                    status=403,
                    details={"referer": ref_origin},
                )
            return

        # Neither Origin nor Referer present: reject to be safe
        raise AppError(
            "ORIGIN_MISMATCH",
            "Missing Origin/Referer for state-changing request.",
            status=403,
        )

    def _enforce_double_submit(self, request: Request) -> None:
        """
        Require header X-CSRF (or configured name) to match the CSRF cookie value exactly.
        """
        header_val: Optional[str] = request.headers.get(self.header_name)
        cookie_val: Optional[str] = request.cookies.get(self.cookie_name)

        if not header_val or not cookie_val:
            raise AppError(
                "CSRF_FAILED",
                "Missing CSRF token.",
                status=403,
                details={"header": bool(header_val), "cookie": bool(cookie_val)},
            )

        if header_val != cookie_val:
            raise AppError(
                "CSRF_FAILED",
                "Invalid CSRF token.",
                status=403,
            )
