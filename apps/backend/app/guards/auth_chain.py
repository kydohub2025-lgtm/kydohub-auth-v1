"""
guards/auth_chain.py

Core authorization dependency chain:

  JWT → JTI → EV → Membership/Roles → RBAC prepare → ABAC attach → Tenant inject

Non-developer summary:
----------------------
Every protected API call passes through this checkpoint.

1) We read the user’s session token (from header/cookie) and verify it.
2) We make sure the session hasn’t been revoked (JTI check).
3) We confirm the session isn’t stale (EV version check).
4) We confirm the user actually belongs to the tenant in the token.
5) We load their roles and permissions and attach small “hints” (ABAC) such as
   which rooms or students they can see.

If any step fails, the request is denied (401/403). If it passes, the route
receives an AuthContext with userId, tenantId, roles, permissions, and ABAC.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Set

from bson import ObjectId
from fastapi import Request
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
    """Data attached to the request if the guard chain passes."""
    request_id: str
    client: str  # "web" or "mobile"
    tenant_id: ObjectId
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
    auth = request.headers.get("Authorization") or ""
    scheme, _ = get_authorization_scheme_param(auth)
    if scheme.lower() == "bearer":
        return "mobile"
    return "mobile"  # default bias helps with CSRF assumptions


def _extract_access_token(request: Request) -> str:
    """
    Get the access token first from Authorization: Bearer, otherwise from the access cookie.
    Raise UNAUTHENTICATED if not found.
    """
    s = get_settings()
    auth = request.headers.get("Authorization") or ""
    scheme, param = get_authorization_scheme_param(auth)
    if scheme.lower() == "bearer" and param:
        return param

    token = request.cookies.get(s.ACCESS_COOKIE)
    if token:
        return token

    raise AppError("UNAUTHENTICATED", "Missing access token.", status=401)


async def _check_jti_blocked(jti: str) -> None:
    """
    Deny request if JTI is blocked.
    Availability-first: if backend cache fails, service logs a warning and we proceed.
    """
    if await jti_is_blocked(jti):
        raise AppError("UNAUTHENTICATED", "Session has been revoked. Please sign in again.", status=401)


async def _check_ev_fresh(claim_ev: int, tenant_id: ObjectId, user_id: str) -> None:
    """
    If server EV > token EV, force refresh. If cache unavailable, allow (availability bias).
    """
    # Cache keys are strings; keep ObjectId as string when talking to cache
    current = await cache.get_ev(str(tenant_id), user_id)
    if current is None:
        return
    if int(current) > int(claim_ev):
        raise AppError("EV_OUTDATED", "Your session is outdated. Please refresh.", status=401)


async def _load_membership_and_perms(tenant_id: ObjectId, user_id: str) -> tuple[list[str], Set[str], dict]:
    """
    Load membership and compute permissions. Uses cache for permset if available.

    Returns:
      roles (list[str]), permissions (set[str]), abac (dict)
    """
    mrepo = MembershipRepo()
    membership = await mrepo.get(tenant_id, user_id)
    if membership is None or (membership.status or "").lower() != "active":
        raise AppError("PERMISSION_DENIED", "You do not have access to this tenant.", status=403)

    roles = membership.roles or []

    # Try cached permset first
    perms = await cache.get_permset(str(tenant_id), user_id)
    if perms is None:
        key = f"permset:{tenant_id}:{user_id}"
        async with cache.SingleFlight.key(key):
            # Double-check inside singleflight to avoid thundering herd
            perms = await cache.get_permset(str(tenant_id), user_id)
            if perms is None:
                rrepo = RoleRepo()
                perms = await rrepo.get_permset_for_roles(str(tenant_id), roles)
                await cache.set_permset(str(tenant_id), user_id, perms)

    # ABAC hints — pass through minimal lists from membership.attrs
    abac: dict = {}
    attrs = membership.attrs or {}
    if isinstance(attrs, dict):
        for key in ("rooms", "guardianOf"):
            val = attrs.get(key)
            if isinstance(val, (list, tuple)):
                abac[key] = list(val)

    return roles, set(perms or []), abac


async def auth_chain(request: Request) -> AuthContext:
    """
    FastAPI dependency to secure routes.

    Behavior:
      - Extract token (header/cookie).
      - Verify RS256 token (aud/iss/exp).
      - Deny if JTI is blocked.
      - Deny if EV is stale (server EV > token EV).
      - Ensure active membership, load roles & permset (with cache).
      - Attach ABAC hints and context for downstream.
    """
    s = get_settings()
    request_id = getattr(request.state, "request_id", None) or request.headers.get("X-Request-ID")
    client_mode = _extract_client_mode(request)

    # 1) Extract & verify token
    token = _extract_access_token(request)
    try:
        claims = verify_access_token(token)
    except Exception:
        # Avoid leaking crypto/validation details
        raise AppError("UNAUTHENTICATED", "Invalid or expired session.", status=401)

    user_id = str(claims.get("sub") or "")
    tenant_claim = str(claims.get("tid") or "")
    ev = int(claims.get("ev") or 0)
    jti = str(claims.get("jti") or "")

    # Convert tenantId from claim to ObjectId (critical for Mongo matching)
    if tenant_claim and ObjectId.is_valid(tenant_claim):
        tenant_id = ObjectId(tenant_claim)
    else:
        raise AppError("UNAUTHENTICATED", "Invalid tenant identifier.", status=401)

    if not user_id or not jti:
        raise AppError("UNAUTHENTICATED", "Malformed session.", status=401)

    # 2) JTI blocklist
    await _check_jti_blocked(jti)

    # 3) EV freshness
    await _check_ev_fresh(ev, tenant_id, user_id)

    # 4) Membership, permissions, ABAC
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
