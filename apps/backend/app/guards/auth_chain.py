"""
guards/auth_chain.py

Core authorization dependency chain:

  JWT → JTI → EV → Membership/Roles → RBAC prepare → ABAC attach → Tenant inject

Non-developer summary:
----------------------
Every protected request passes through this "checkpoint". If the token is bad,
blocked, stale, or the user doesn't belong to the tenant, the request is denied.
Otherwise we attach useful context (who/tenant/permissions) to use later.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set

from fastapi import Depends, Header, Request
from fastapi.security.utils import get_authorization_scheme_param

from ..core.config import get_settings
from ..core.errors import AppError
from ..security.token_service import verify_access_token
from ..services.jti_blocklist import is_blocked as jti_is_blocked
from ..services import auth_state_cache as cache
from ..repos.membership_repo import MembershipRepo
from ..repos.role_repo import RoleRepo


@dataclass
class AuthContext:
    """
    Data attached to the request if the guard chain passes.
    """
    request_id: str
    client: str  # "web" or "mobile"
    tenant_id: str
    user_id: str
    roles: list[str] = field(default_factory=list)
    permissions: Set[str] = field(default_factory=set)
    abac: Dict[str, Any] = field(default_factory=dict)
    ev: int = 0
    jti: str = ""


def _extract_client_mode(request: Request) -> str:
    """
    Distinguish 'web' (cookies) vs 'mobile' (bearer token) for downstream behavior/telemetry.
    """
    s = get_settings()
    cookies = request.cookies or {}
    if s.ACCESS_COOKIE in cookies or s.REFRESH_COOKIE in cookies:
        return "web"
    # Heuristic: treat explicit Bearer as mobile; can be used by web too.
    auth = request.headers.get("Authorization") or ""
    scheme, _ = get_authorization_scheme_param(auth)
    if scheme.lower() == "bearer":
        return "mobile"
    return "mobile"  # default: safer on CSRF assumptions


def _extract_access_token(request: Request) -> str:
    """
    Get the access token first from Authorization: Bearer, otherwise from the kydo_sess cookie.
    Raise UNAUTHENTICATED if not found.
    """
    s = get_settings()
    auth = request.headers.get("Authorization") or ""
    scheme, param = get_authorization_scheme_param(auth)
    if scheme.lower() == "bearer" and param:
        return param

    # Cookie mode
    token = request.cookies.get(s.ACCESS_COOKIE)
    if token:
        return token

    raise AppError("UNAUTHENTICATED", "Missing access token.", status=401)


async def _check_jti_blocked(jti: str) -> None:
    """
    Deny request if JTI is blocked.
    Favor availability: if backends fail to answer, treat as not blocked but log is emitted by service.
    """
    if await jti_is_blocked(jti):
        raise AppError("UNAUTHENTICATED", "Session has been revoked. Please sign in again.", status=401)


async def _check_ev_fresh(claim_ev: int, tenant_id: str, user_id: str) -> None:
    """
    If server EV is greater than the token's EV, force a refresh.
    If cache is unavailable and we can't determine EV, we allow the request (availability bias).
    A later route may still return EV_OUTDATED on sensitive actions if stricter checks are added.
    """
    current = await cache.get_ev(tenant_id, user_id)
    if current is None:
        return  # Availability over strictness; can be tightened later with DB fallback.
    if int(current) > int(claim_ev):
        raise AppError("EV_OUTDATED", "Your session is outdated. Please refresh.", status=401)


async def _load_membership_and_perms(tenant_id: str, user_id: str) -> tuple[list[str], Set[str], dict]:
    """
    Load membership and compute permissions. Use cache for permset if available.

    Returns:
      roles, permissions(set), abac(dict)
    """
    mrepo = MembershipRepo()
    membership = await mrepo.get(tenant_id, user_id)
    if membership is None or (membership.status or "").lower() != "active":
        raise AppError("PERMISSION_DENIED", "You do not have access to this tenant.", status=403)

    roles = membership.roles or []

    # Try permset cache
    perms = await cache.get_permset(tenant_id, user_id)
    if perms is None:
        # Single-flight recompute to avoid thundering herd
        key = f"permset:{tenant_id}:{user_id}"
        async with cache.SingleFlight.key(key):
            # Another concurrent request may have filled it already:
            perms = await cache.get_permset(tenant_id, user_id)
            if perms is None:
                rrepo = RoleRepo()
                perms = await rrepo.get_permset_for_roles(tenant_id, roles)
                await cache.set_permset(tenant_id, user_id, perms)

    # ABAC hints (minimal): rooms for staff; guardianOf for parents; pass-through from membership.attrs
    abac: dict = {}
    attrs = membership.attrs or {}
    if isinstance(attrs, dict):
        for key in ("rooms", "guardianOf"):
            if key in attrs and isinstance(attrs[key], (list, tuple)):
                abac[key] = list(attrs[key])

    return roles, perms, abac


async def auth_chain(request: Request) -> AuthContext:
    """
    FastAPI dependency to secure routes.

    Usage:
        @router.get("/secure")
        async def secure_endpoint(ctx: AuthContext = Depends(auth_chain)):
            return {"user": ctx.user_id, "permissions": sorted(ctx.permissions)}

    Behavior:
      - Extract token (header or cookie).
      - Verify RS256 token (aud/iss/exp).
      - Deny if JTI is blocked.
      - Deny if EV is stale (server EV > token EV).
      - Ensure active membership, load roles & permset (with cache).
      - Attach ABAC hints and context for downstream.
    """
    s = get_settings()
    request_id = getattr(request.state, "request_id", None) or request.headers.get("X-Request-ID")
    client_mode = _extract_client_mode(request)

    # 1) Extract and verify token
    token = _extract_access_token(request)
    try:
        claims = verify_access_token(token)
    except Exception as e:
        # Map PyJWT errors to 401 with safe message; details omitted for security
        msg = "Invalid or expired session."
        raise AppError("UNAUTHENTICATED", msg, status=401)

    user_id = str(claims.get("sub") or "")
    tenant_id = str(claims.get("tid") or "")
    ev = int(claims.get("ev") or 0)
    jti = str(claims.get("jti") or "")

    if not user_id or not tenant_id or not jti:
        raise AppError("UNAUTHENTICATED", "Malformed session.", status=401)

    # 2) JTI blocklist check
    await _check_jti_blocked(jti)

    # 3) EV freshness
    await _check_ev_fresh(ev, tenant_id, user_id)

    # 4) Membership & permissions (RBAC), ABAC hints
    roles, perms, abac = await _load_membership_and_perms(tenant_id, user_id)

    return AuthContext(
        request_id=request_id or "",
        client=client_mode,
        tenant_id=tenant_id,
        user_id=user_id,
        roles=roles,
        permissions=perms,
        abac=abac,
        ev=ev,
        jti=jti,
    )
