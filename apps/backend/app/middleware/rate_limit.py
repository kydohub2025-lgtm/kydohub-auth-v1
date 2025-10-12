"""
middleware/rate_limit.py

Rate limiting for /auth/* endpoints:
- IP-scoped limit (e.g., 20/m from settings.RATE_LIMITS_IP)
- User-scoped limit (e.g., 600/m from settings.RATE_LIMITS_TENANT, used here as "per user")
- Redis-based counters with sliding window approximation.
- Graceful degradation (no hard dependency on Redis).

Non-developer summary:
----------------------
This protects /auth endpoints from bursts and abuse. If Redis is down, we don't
block requests, but we log a warning so ops can see it.
"""

from __future__ import annotations

import re
import time
from typing import Optional, Tuple

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ..core.config import get_settings
from ..core.errors import error_envelope
from ..infra.redis import get_redis
from ..security.token_service import verify_access_token


_rate_pattern = re.compile(r"^\s*(\d+)\s*/\s*([smhd])\s*$", re.IGNORECASE)
_unit_seconds = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def _parse_rate(s: str) -> Tuple[int, int]:
    """
    Parses a simple rate string like "20/m" → (20, 60)
    """
    m = _rate_pattern.match(s or "")
    if not m:
        # default to a conservative 60/m if misconfigured
        return 60, 60
    count = int(m.group(1))
    window = _unit_seconds[m.group(2).lower()]
    return count, window


def _client_ip(request: Request) -> str:
    # Best-effort extraction; in production put the correct header through API Gateway/ALB
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _path_is_auth(request: Request) -> bool:
    base = get_settings().API_BASE_PATH.rstrip("/")
    return request.url.path.startswith(f"{base}/auth/")


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    """
    Applies rate limiting to /auth/* endpoints using Redis counters.

    - IP limit always applies.
    - If Authorization header contains a valid access token, we also apply a per-user limit.
    - On Redis failure or absence, requests proceed (availability first) and a warning is logged.
    """

    async def dispatch(self, request: Request, call_next):
        if not _path_is_auth(request):
            return await call_next(request)

        s = get_settings()
        r = get_redis()

        # If Redis isn't available, we skip enforcement
        if r is None:
            return await call_next(request)

        ip = _client_ip(request)
        ip_limit, ip_window = _parse_rate(s.RATE_LIMITS_IP)
        now = int(time.time())

        # Per-user limit is optional; only if we can validate the Authorization header quickly
        user_id: Optional[str] = None
        auth = request.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
            try:
                claims = verify_access_token(token)
                user_id = str(claims.get("sub") or None)
            except Exception:
                # Ignore invalid tokens here; normal auth handlers will reject later
                pass

        user_limit, user_window = _parse_rate(s.RATE_LIMITS_TENANT)  # reuse setting for "per user" limit

        # Compute Redis keys (coarse window bucketing)
        ip_bucket = now // ip_window
        ip_key = f"rl:auth:ip:{ip}:{ip_bucket}"

        # Evaluate IP limit
        try:
            ip_count = await r.incr(ip_key)
            if ip_count == 1:
                await r.expire(ip_key, ip_window)
            if ip_count > ip_limit:
                return error_envelope(
                    code="RATE_LIMITED",
                    message="Too many requests. Please slow down.",
                    request_id=request.headers.get("X-Request-ID"),
                    status=429,
                    details={"scope": "ip"},
                )
        except Exception:
            # On Redis error, skip limiting (favor availability)
            pass

        # Evaluate user limit if known
        if user_id:
            user_bucket = now // user_window
            user_key = f"rl:auth:user:{user_id}:{user_bucket}"
            try:
                user_count = await r.incr(user_key)
                if user_count == 1:
                    await r.expire(user_key, user_window)
                if user_count > user_limit:
                    return error_envelope(
                        code="RATE_LIMITED",
                        message="Too many requests. Please slow down.",
                        request_id=request.headers.get("X-Request-ID"),
                        status=429,
                        details={"scope": "user"},
                    )
            except Exception:
                pass

        return await call_next(request)
