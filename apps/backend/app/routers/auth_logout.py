"""
routers/auth_logout.py

POST /auth/logout
- Web:
    * Enforces CSRF (Origin/Referer + X-CSRF header matching cookie)
    * Blocks the current access token JTI (if present/valid)
    * Revokes the refresh session from cookie (best-effort)
    * Clears cookies (kydo_sess, kydo_refresh, kydo_csrf)
    * Returns 204 (idempotent)
- Mobile:
    * Blocks current access token JTI (if present/valid)
    * Optionally revokes provided refresh token { "refresh": "<token>" }
    * Returns 204

Non-developer summary:
----------------------
This safely signs the user out. On the web, we require a CSRF proof since the
browser sends cookies automatically; on mobile, CSRF isn’t needed. Either way,
we block the current access token and revoke any refresh token we’re given or
find in cookies. Calling logout multiple times is safe and always returns 204.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Dict, Any

from fastapi import APIRouter, Header, Request, Body
from fastapi.responses import Response

from ..core.config import get_settings
from ..core.errors import AppError
from ..security.cookie_service import clear_web_cookies
from ..security.token_service import verify_access_token
from ..services.jti_blocklist import block as block_jti
from ..repos.refresh_session_repo import RefreshSessionRepo

router = APIRouter(prefix="/auth", tags=["auth"])


def _infer_client(header_client: Optional[str], body_client: Optional[str]) -> str:
    v = (header_client or body_client or "").lower()
    return v if v in ("web", "mobile") else "web"


def _enforce_web_csrf(request: Request) -> None:
    """
    Web-only CSRF protection: require allowed Origin/Referer and matching X-CSRF header & cookie.
    """
    s = get_settings()
    allowed = set(s.ALLOWED_ORIGIN_LIST)

    origin = request.headers.get("Origin")
    referer = request.headers.get("Referer")
    if origin:
        if origin not in allowed:
            raise AppError("ORIGIN_MISMATCH", "Request origin is not allowed.", status=403, details={"origin": origin})
    elif referer:
        from urllib.parse import urlparse

        parsed = urlparse(referer)
        ref_origin = f"{parsed.scheme}://{parsed.netloc}"
        if ref_origin not in allowed:
            raise AppError("ORIGIN_MISMATCH", "Request referer is not allowed.", status=403, details={"referer": ref_origin})
    else:
        raise AppError("ORIGIN_MISMATCH", "Missing Origin/Referer for state-changing request.", status=403)

    header_name = s.CSRF_HEADER
    header_val = request.headers.get(header_name)
    cookie_val = request.cookies.get(s.CSRF_COOKIE)
    if not header_val or not cookie_val or header_val != cookie_val:
        raise AppError("CSRF_FAILED", "Invalid or missing CSRF token.", status=403)


def _extract_access_from_request(request: Request) -> Optional[str]:
    """
    Best-effort read of access token:
    - Authorization: Bearer <token>
    - or session cookie (web)
    Returns None if missing.
    """
    s = get_settings()
    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    token = request.cookies.get(s.ACCESS_COOKIE)
    return token if token else None


async def _revoke_refresh_from_cookie(request: Request) -> None:
    """
    If a refresh cookie is present (web), mark the corresponding DB session as revoked.
    Best-effort: errors are swallowed to keep logout responsive.
    """
    s = get_settings()
    refresh = request.cookies.get(s.REFRESH_COOKIE)
    if not refresh:
        return
    try:
        await RefreshSessionRepo().revoke_by_token(refresh)
    except Exception:
        pass  # degrade gracefully


async def _revoke_refresh_if_provided(refresh_token: Optional[str]) -> None:
    """
    If a mobile client provides a refresh token in JSON, revoke it.
    Best-effort: errors are swallowed to keep logout responsive.
    """
    if not refresh_token:
        return
    try:
        await RefreshSessionRepo().revoke_by_token(refresh_token)
    except Exception:
        pass  # degrade gracefully


@router.post("/logout")
async def logout(
    request: Request,
    payload: Dict[str, Any] = Body(default={}),
    x_client: Optional[str] = Header(default=None, convert_underscores=False, alias="X-Client"),
):
    """
    Invalidate the current session and remove refresh/cookies if applicable.
    Always returns 204, even if the user is already logged out.
    """
    s = get_settings()
    client_mode = _infer_client(x_client, payload.get("client"))

    # --- 1) CSRF (web only) ---
    if client_mode == "web":
        _enforce_web_csrf(request)

    # --- 2) Block current access JTI (if present/valid) ---
    access_token = _extract_access_from_request(request)
    if access_token:
        try:
            claims = verify_access_token(access_token)
            jti = str(claims.get("jti") or "")
            exp = int(claims.get("exp") or 0)
            now = int(datetime.now(tz=timezone.utc).timestamp())
            ttl = max(exp - now, 0) + 60  # buffer to outlive token by a bit
            if jti:
                await block_jti(jti, ttl)
        except Exception:
            # Invalid/expired access token is fine; we still proceed to clear/revoke refresh.
            pass

    # --- 3) Revoke refresh (web cookie or mobile-provided) ---
    if client_mode == "web":
        await _revoke_refresh_from_cookie(request)
    else:
        await _revoke_refresh_if_provided(payload.get("refresh"))

    # --- 4) Clear cookies for web and return 204 (idempotent) ---
    resp = Response(status_code=204)
    if client_mode == "web":
        clear_web_cookies(resp)
    return resp
