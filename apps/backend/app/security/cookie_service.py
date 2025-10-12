"""
security/cookie_service.py

Cookie builders for browser (web) sessions:
- kydo_sess   : HttpOnly access token cookie (short TTL)
- kydo_refresh: HttpOnly refresh cookie (long TTL), Path-scoped to /auth/refresh
- kydo_csrf   : readable CSRF cookie for double-submit (non-HttpOnly)

Non-developer summary:
----------------------
These helpers set/clear the three cookies exactly the same way every time.
That consistency prevents "login loop" issues and CORS/CSRF surprises.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Response

from ..core.config import get_settings


def _expiry(ts_seconds: int) -> datetime:
    """Convert a relative seconds-from-now TTL into an absolute UTC datetime."""
    return datetime.now(tz=timezone.utc) + timedelta(seconds=int(ts_seconds))


def generate_csrf_token() -> str:
    """Strong random value suitable for CSRF double-submit (sent as cookie and echoed in header)."""
    # 32 bytes -> 43 char urlsafe token; not a bearer credential, but keep it high entropy.
    return secrets.token_urlsafe(32)


def set_access_cookie(response: Response, token: str, ttl_seconds: Optional[int] = None) -> None:
    """
    Set kydo_sess (HttpOnly) with SameSite=Lax, Domain=.kydohub.com, Path=/, Secure.

    - Contains the short-lived access token (JWT).
    - HttpOnly prevents JavaScript access (mitigates XSS token theft).
    """
    s = get_settings()
    ttl = ttl_seconds if ttl_seconds is not None else s.JWT_ACCESS_TTL_SEC

    response.set_cookie(
        key=s.ACCESS_COOKIE,
        value=token,
        expires=_expiry(ttl),
        max_age=ttl,
        domain=s.COOKIE_DOMAIN,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",  # cross-subdomain navigation OK, CSRF still enforced
    )


def set_refresh_cookie(response: Response, token: str, ttl_seconds: Optional[int] = None) -> None:
    """
    Set kydo_refresh (HttpOnly) with SameSite=Lax, Domain=.kydohub.com, Path=/auth/refresh, Secure.

    - Contains the long-lived refresh token (opaque or JWT).
    - Path scoping limits automatic sending to only the refresh endpoint, reducing exposure.
    """
    s = get_settings()
    ttl = ttl_seconds if ttl_seconds is not None else s.JWT_REFRESH_TTL_SEC

    response.set_cookie(
        key=s.REFRESH_COOKIE,
        value=token,
        expires=_expiry(ttl),
        max_age=ttl,
        domain=s.COOKIE_DOMAIN,
        path="/auth/refresh",  # IMPORTANT: path scoped
        secure=True,
        httponly=True,
        samesite="lax",
    )


def set_csrf_cookie(response: Response, csrf_token: Optional[str] = None, ttl_seconds: Optional[int] = None) -> str:
    """
    Set kydo_csrf (readable, non-HttpOnly) with SameSite=Lax, Domain=.kydohub.com, Path=/, Secure.

    - The frontend reads this cookie and copies it into the X-CSRF header for unsafe requests.
    - This is not a secret bearer credential, but it must match exactly (double-submit).
    """
    s = get_settings()
    ttl = ttl_seconds if ttl_seconds is not None else s.JWT_REFRESH_TTL_SEC  # keep it as long as refresh by default
    token = csrf_token or generate_csrf_token()

    response.set_cookie(
        key=s.CSRF_COOKIE,
        value=token,
        expires=_expiry(ttl),
        max_age=ttl,
        domain=s.COOKIE_DOMAIN,
        path="/",
        secure=True,
        httponly=False,  # FE must be able to read it
        samesite="lax",
    )
    return token


def apply_web_login_cookies(
    response: Response,
    *,
    access_token: str,
    refresh_token: str,
    csrf_token: Optional[str] = None,
    access_ttl_seconds: Optional[int] = None,
    refresh_ttl_seconds: Optional[int] = None,
) -> str:
    """
    Convenience: set all three cookies after a successful /auth/exchange or /auth/switch (web).

    Returns:
      The CSRF token that was set (handy if the caller wants to also echo it in a JSON body for debugging).
    """
    set_access_cookie(response, access_token, ttl_seconds=access_ttl_seconds)
    set_refresh_cookie(response, refresh_token, ttl_seconds=refresh_ttl_seconds)
    csrf = set_csrf_cookie(response, csrf_token, ttl_seconds=refresh_ttl_seconds)
    return csrf


def clear_web_cookies(response: Response) -> None:
    """
    Clear all three cookies (used by /auth/logout and any forced sign-out flows).
    """
    s = get_settings()
    # expire immediately by setting max_age=0
    for name, path in (
        (s.ACCESS_COOKIE, "/"),
        (s.REFRESH_COOKIE, "/auth/refresh"),
        (s.CSRF_COOKIE, "/"),
    ):
        response.delete_cookie(
            key=name,
            domain=s.COOKIE_DOMAIN,
            path=path,
        )
