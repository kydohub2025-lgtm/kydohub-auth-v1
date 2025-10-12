"""
routers/auth_refresh.py

POST /auth/refresh
- Web: 204 No Content + rotate cookies (CSRF required)
- Mobile: 200 JSON tokens

Non-developer summary:
----------------------
This endpoint swaps an old refresh token for a new one ("rotation") and gives
the user a new short-lived access token. On the web, it also sets fresh cookies.
If someone tries to reuse an old refresh token, we reject it to keep accounts safe.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse, Response

from ..core.config import get_settings
from ..core.errors import AppError
from ..repos.refresh_session_repo import RefreshSessionRepo
from ..security.cookie_service import set_access_cookie, set_refresh_cookie
from ..security.token_service import issue_access_token
from ..services import auth_state_cache as cache

router = APIRouter(prefix="/auth", tags=["auth"])


def _infer_client(header_client: Optional[str], body_client: Optional[str]) -> str:
    client = (header_client or body_client or "").lower()
    if client in ("web", "mobile"):
        return client
    return "web"


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
    if not header_val or not cookie_val:
        raise AppError("CSRF_FAILED", "Missing CSRF token.", status=403)
    if header_val != cookie_val:
        raise AppError("CSRF_FAILED", "Invalid CSRF token.", status=403)


@router.post("/refresh")
async def refresh(
    request: Request,
    payload: Dict[str, Any] = Body(default={}),
    x_client: Optional[str] = Header(default=None, convert_underscores=False, alias="X-Client"),
):
    """
    Rotate the refresh token and mint a new access token.

    Web:
      - refresh cookie is read automatically, CSRF enforced, returns 204 with rotated cookies.

    Mobile:
      - expects { "refresh": "<token>" } in JSON, returns 200 JSON with new pair.
    """
    s = get_settings()
    client_mode = _infer_client(x_client, payload.get("client"))

    # ------------------ Acquire incoming refresh token ------------------
    if client_mode == "web":
        _enforce_web_csrf(request)
        refresh_token = request.cookies.get(s.REFRESH_COOKIE)
        if not refresh_token:
            raise AppError("UNAUTHENTICATED", "Missing refresh token.", status=401)
    else:
        refresh_token = payload.get("refresh")
        if not refresh_token or not isinstance(refresh_token, str):
            raise AppError("BAD_REQUEST", "Missing refresh token.", status=400)

    # ------------------ Validate session ------------------
    repo = RefreshSessionRepo()
    session = await repo.find_active_by_token(refresh_token)
    if not session:
        # Reuse or invalid token → deny without revealing which
        raise AppError("UNAUTHENTICATED", "Invalid or expired refresh.", status=401)

    user_id = session.user_id
    tenant_id = session.tenant_id

    # ------------------ EV baseline ------------------
    ev = await cache.get_ev(tenant_id, user_id)
    if ev is None:
        await cache.set_ev(tenant_id, user_id, 1)
        ev = 1

    # ------------------ New access + rotated refresh ------------------
    access_token, _exp = issue_access_token(user_id=user_id, tenant_id=tenant_id, ev=int(ev))
    new_refresh = await repo.rotate(user_id=user_id, tenant_id=tenant_id, old_token=refresh_token, ttl_seconds=s.JWT_REFRESH_TTL_SEC)

    # ------------------ Respond per client mode ------------------
    if client_mode == "web":
        resp = Response(status_code=204)
        set_access_cookie(resp, access_token)
        set_refresh_cookie(resp, new_refresh)
        # CSRF cookie remains unchanged; FE still echoes it.
        return resp

    # Mobile
    return JSONResponse(
        status_code=200,
        content={
            "tokenType": "Bearer",
            "access": access_token,
            "expiresIn": int(s.JWT_ACCESS_TTL_SEC),
            "refresh": new_refresh,
        },
    )
