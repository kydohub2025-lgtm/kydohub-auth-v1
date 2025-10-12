"""
routers/me_context.py

GET /me/context
Returns the tenant-scoped authorization context:
- tenant, user, roles, permissions, ui_resources, abac, meta.ev

Non-developer summary:
----------------------
The frontend calls this after login/refresh to learn what to show:
navigation pages, allowed actions, and small hints to filter data
(rooms for staff, or which students a guardian can see).
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..guards.auth_chain import AuthContext, auth_chain
from ..infra.mongo import get_db
from ..repos.ui_resources_repo import UIResourcesRepo
from ..services import auth_state_cache as cache

router = APIRouter(tags=["me"])


@router.get("/me/context")
async def me_context(ctx: AuthContext = Depends(auth_chain)):
    """
    Build the /me/context response using:
      - AuthContext (already verified): userId, tenantId, roles, permissions, abac hints, ev
      - UI resources via UIResourcesRepo
      - Minimal tenant/user projection

    Security:
      - Requires a valid access token (handled by auth_chain).
      - Does NOT accept tenantId from the client.
    """
    tenant_id = ctx.tenant_id
    user_id = ctx.user_id

    # Roles/permset are already prepared by the guard chain.
    roles = ctx.roles
    permissions = sorted(ctx.permissions)  # stable order helps FE cache/diff

    # ABAC hints come from membership.attrs (via guard chain)
    abac = {
        "rooms": list((ctx.abac or {}).get("rooms", [])),
        "guardianOf": list((ctx.abac or {}).get("guardianOf", [])),
    }

    # UI resources via repo
    ui = await UIResourcesRepo().get_for_tenant(tenant_id)

    # Minimal tenant & user blocks (keep PII minimal)
    tdoc = await get_db()["tenants"].find_one(
        {"tenantId": tenant_id},
        projection={"_id": 0, "tenantId": 1, "name": 1, "timezone": 1},
    )
    tenant_block = {
        "tenantId": tenant_id,
        "name": (tdoc or {}).get("name"),
        "timezone": (tdoc or {}).get("timezone"),
    }

    udoc = await get_db()["users"].find_one(
        {"userId": user_id},
        projection={"_id": 0, "userId": 1, "name": 1, "avatarUrl": 1, "email": 1},
    )
    user_block = {
        "userId": user_id,
        "name": (udoc or {}).get("name"),
        "email": (udoc or {}).get("email"),
        "avatarUrl": (udoc or {}).get("avatarUrl"),
    }

    # EV from token for client; optionally compare with server EV for diagnostics
    server_ev = await cache.get_ev(tenant_id, user_id)
    meta = {"ev": ctx.ev if ctx.ev is not None else (server_ev or 0)}

    body = {
        "tenant": tenant_block,
        "user": user_block,
        "roles": roles,
        "permissions": permissions,
        "ui_resources": {"pages": ui.pages, "actions": ui.actions},
        "abac": abac,
        "meta": meta,
    }
    return JSONResponse(status_code=200, content=body)
