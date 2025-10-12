"""
routers/auth_switch.py

POST /auth/switch
- Switch the active tenant for the current user.
- Web: 204 + set cookies (CSRF required)
- Mobile: 200 JSON with new {access, refresh}
- Idempotency-Key supported for 120s to avoid duplicate rotations.

Non-developer summary:
----------------------
If a user can access multiple tenants, this endpoint re-mints their session
for the chosen tenant, with all safety checks (CSRF for web, membership check,
and optional idempotency to avoid accidental double-clicks).
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse, Response

from ..core.config import get_settings
from ..core.errors import AppError
from ..infra.mongo import get_db
from ..infra.redis import get_redis
from ..repos.membership_repo import MembershipRepo
from ..security.cookie_service import apply_web_login_cookies
from ..security.token_service import issue_access_token, verify_access_token
from ..services import auth_state_cache as cache

router = APIRouter(prefix="/auth", tags=["auth"])


def _infer_client(header_client: Optional[str], body_client: Optional[str]) -> str:
    v = (header_client or body_client or "").lower()
    return v if v in ("web", "mobile") else "web"


def _enforce_web_csrf(request: Request) -> None:
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

    header_val = request.headers.get(get_settings().CSRF_HEADER)
    cookie_val = request.cookies.get(get_settings().CSRF_COOKIE)
    if not header_val or not cookie_val or header_val != cookie_val:
        raise AppError("CSRF_FAILED", "Invalid or missing CSRF token.", status=403)


def _hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _persist_refresh_session(user_id: str, tenant_id: str, refresh_token: str, ttl_sec: int) -> None:
    now = datetime.now(tz=timezone.utc)
    expires_at = now + timedelta(seconds=int(ttl_sec))
    await get_db()["refresh_sessions"].insert_one(
        {
            "userId": user_id,
            "tenantId": tenant_id,
            "tokenHash": _hash_refresh(refresh_token),
            "status": "active",
            "createdAt": now,
            "expiresAt": expires_at,
        }
    )


async def _idempotency_load_or_store(key: Optional[str], value: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    If Idempotency-Key is provided and Redis is available:
      - First call stores the response payload for 120s.
      - Subsequent calls with the same key return the stored payload (no new rotation).
    Returns the stored payload if this is a repeat call; otherwise None.
    """
    if not key:
        return None
    r = get_redis()
    if r is None:
        return None

    redis_key = f"idem:switch:{key}"
    # Try to get an existing payload
    try:
        raw = await r.get(redis_key)
        if raw:
            return json.loads(raw)
        # Not found: store now
        await r.set(redis_key, json.dumps(value), ex=120, nx=True)
        return None
    except Exception:
        return None  # degrade gracefully


@router.post("/switch")
async def switch_tenant(
    request: Request,
    payload: Dict[str, Any] = Body(...),
    x_client: Optional[str] = Header(default=None, convert_underscores=False, alias="X-Client"),
    idem_key: Optional[str] = Header(default=None, convert_underscores=False, alias="Idempotency-Key"),
):
    """
    Switch the active tenant.

    Request JSON (example):
    {
      "tenantId": "t1",
      "client": "web|mobile"
    }
    """
    s = get_settings()
    target_tid = str(payload.get("tenantId") or "").strip()
    if not target_tid:
        raise AppError("BAD_REQUEST", "Missing tenantId.", status=400)

    client_mode = _infer_client(x_client, payload.get("client"))

    # Verify current access token to identify the caller
    try:
        # Accept token from Authorization header or kydo_sess cookie
        token = request.headers.get("Authorization") or request.cookies.get(s.ACCESS_COOKIE) or ""
        if token.lower().startswith("bearer "):
            token = token.split(" ", 1)[1].strip()
        claims = verify_access_token(token)
    except Exception:
        raise AppError("UNAUTHENTICATED", "Invalid or expired session.", status=401)

    user_id = str(claims.get("sub") or "")
    if not user_id:
        raise AppError("UNAUTHENTICATED", "Malformed session.", status=401)

    # Check membership in target tenant
    mrepo = MembershipRepo()
    membership = await mrepo.get(target_tid, user_id)
    if membership is None or (membership.status or "").lower() != "active":
        raise AppError("PERMISSION_DENIED", "You are not a member of the target tenant.", status=403)

    # CSRF for web
    if client_mode == "web":
        _enforce_web_csrf(request)

    # Prepare response payload (we may store/return this for idempotency)
    placeholder_payload = {"tenantId": target_tid, "tokenType": "Bearer"}

    # Idempotency: if there is a stored payload for this key, short-circuit with it.
    cached = await _idempotency_load_or_store(idem_key, placeholder_payload)
    if cached is not None:
        # Respond using cached mode (web/mobile). For web we still return 204, cookies unchanged.
        if client_mode == "web":
            return Response(status_code=204)
        return JSONResponse(status_code=200, content=cached)

    # EV baseline for the target tenant (seed to 1 if missing)
    ev = await cache.get_ev(target_tid, user_id)
    if ev is None:
        await cache.set_ev(target_tid, user_id, 1)
        ev = 1

    # Mint new access & refresh for the target tenant
    access_token, _exp = issue_access_token(user_id=user_id, tenant_id=target_tid, ev=int(ev))
    refresh_token = secrets.token_urlsafe(48)
    await _persist_refresh_session(user_id, target_tid, refresh_token, s.JWT_REFRESH_TTL_SEC)

    # Return per client type
    if client_mode == "web":
        resp = Response(status_code=204)
        apply_web_login_cookies(resp, access_token=access_token, refresh_token=refresh_token)
        return resp

    return JSONResponse(
        status_code=200,
        content={
            "tokenType": "Bearer",
            "access": access_token,
            "expiresIn": int(s.JWT_ACCESS_TTL_SEC),
            "refresh": refresh_token,
            "tenant": {"tenantId": target_tid},
        },
    )
