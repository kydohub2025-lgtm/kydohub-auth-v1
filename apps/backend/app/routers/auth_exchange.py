"""
routers/auth_exchange.py

POST /auth/exchange
- Input: { provider: "supabase", token: "<supabase.jwt>", tenantHint?: "<tenantId|code>", device?: {...}, client?: "web"|"mobile" }
- Behavior: verify Supabase token; resolve tenant; mint KydoHub access token + refresh token; set cookies (web) or return JSON (mobile).
- Special: If user has multiple tenants and no hint, return 209 with { tenants: [...] } to let the client choose.

Non-developer summary:
----------------------
This endpoint converts a Supabase login into a KydoHub session. Web gets secure cookies;
mobile gets JSON tokens. If a user belongs to multiple tenants, we ask the client to
tell us which one to use (209 Tenant Choice).
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Header
from fastapi.responses import JSONResponse, Response

from ..core.config import get_settings
from ..core.errors import AppError
from ..infra.mongo import get_db
from ..repos.refresh_session_repo import RefreshSessionRepo
from ..services import auth_state_cache as cache
from ..security.token_service import verify_supabase_token, issue_access_token
from ..security.cookie_service import apply_web_login_cookies

router = APIRouter(prefix="/auth", tags=["auth"])

# ----- Request model -----

@dataclass
class ExchangeRequest:
    provider: str
    token: str
    tenantHint: Optional[str] = None
    client: Optional[str] = None  # "web" | "mobile"
    device: Optional[Dict[str, Any]] = None  # { name?, fingerprint? }


def _infer_client(header_client: Optional[str], body_client: Optional[str]) -> str:
    client = (header_client or body_client or "").lower()
    if client in ("web", "mobile"):
        return client
    # Default to web to encourage cookie mode for browsers
    return "web"


async def _list_active_memberships(user_id: str) -> List[Dict[str, Any]]:
    """
    Return active memberships for a user with tenant metadata (id + name).
    """
    db = get_db()
    cursor = db["memberships"].aggregate(
        [
            {"$match": {"userId": user_id, "status": "active"}},
            {"$lookup": {
                "from": "tenants",
                "localField": "tenantId",
                "foreignField": "tenantId",
                "as": "tenantDocs",
                "pipeline": [{"$project": {"_id": 0, "tenantId": 1, "name": 1}}]
            }},
            {"$addFields": {"tenant": {"$arrayElemAt": ["$tenantDocs", 0]}}},
            {"$project": {"_id": 0, "tenantId": 1, "roles": 1, "tenant": 1}},
        ]
    )
    results: List[Dict[str, Any]] = []
    async for doc in cursor:
        t = doc.get("tenant") or {"tenantId": doc.get("tenantId")}
        results.append({"tenantId": t.get("tenantId"), "name": t.get("name"), "roles": doc.get("roles", [])})
    return results


def _choose_tenant(memberships: List[Dict[str, Any]], tenant_hint: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Decide which tenant to use:
      - If tenantHint provided, return matching membership if present.
      - If exactly one active membership, return it.
      - Otherwise return None (caller should 209).
    """
    if tenant_hint:
        for m in memberships:
            if m.get("tenantId") == tenant_hint or (m.get("name") and m["name"] == tenant_hint):
                return m
        return None
    if len(memberships) == 1:
        return memberships[0]
    return None


@router.post("/exchange")
async def exchange(
    payload: Dict[str, Any] = Body(...),
    x_client: Optional[str] = Header(default=None, convert_underscores=False, alias="X-Client"),
):
    """
    Convert a Supabase access token into a KydoHub session.

    Request JSON (example):
    {
      "provider": "supabase",
      "token": "<supabase.jwt>",
      "tenantHint": "t1 | TENANTCODE?",
      "client": "web|mobile",
      "device": { "name": "Chrome on macOS", "fingerprint": "..." }
    }

    Responses:
      - 204 No Content + Set-Cookie (web)
      - 200 JSON { tokenType, access, expiresIn, refresh, tenant } (mobile)
      - 209 JSON { tenants: [{ tenantId, name }...] } if multiple tenants and no hint
    """
    s = get_settings()

    # ---- Parse & basic validation ----
    try:
        req = ExchangeRequest(
            provider=str(payload.get("provider", "")),
            token=str(payload.get("token", "")),
            tenantHint=payload.get("tenantHint"),
            client=payload.get("client"),
            device=payload.get("device"),
        )
    except Exception:
        raise AppError("BAD_REQUEST", "Invalid request body.", status=400)

    if req.provider.lower() != "supabase":
        raise AppError("BAD_REQUEST", "Unsupported provider.", status=400)
    if not req.token:
        raise AppError("BAD_REQUEST", "Missing provider token.", status=400)

    client_mode = _infer_client(x_client, req.client)  # "web" or "mobile"

    # ---- Verify Supabase token ----
    try:
        supa = verify_supabase_token(req.token)
    except Exception:
        raise AppError("UNAUTHENTICATED", "Invalid identity token.", status=401)

    user_id = str(supa.get("sub") or "")
    if not user_id:
        raise AppError("UNAUTHENTICATED", "Invalid identity token (no sub).", status=401)

    # ---- Determine tenant ----
    memberships = await _list_active_memberships(user_id)
    chosen = _choose_tenant(memberships, req.tenantHint)
    if not chosen:
        if len(memberships) == 0:
            raise AppError("PERMISSION_DENIED", "No active tenant membership.", status=403)
        return JSONResponse(
            status_code=209,
            content={"tenants": [{"tenantId": m["tenantId"], "name": m.get("name")} for m in memberships]},
        )

    tenant_id = str(chosen["tenantId"])

    # ---- Establish EV baseline ----
    ev = await cache.get_ev(tenant_id, user_id)
    if ev is None:
        await cache.set_ev(tenant_id, user_id, 1)
        ev = 1

    # ---- Mint tokens ----
    access_token, _exp = issue_access_token(user_id=user_id, tenant_id=tenant_id, ev=int(ev))

    # Persist refresh session with repo (hash-at-rest, TTL)
    refresh_repo = RefreshSessionRepo()
    refresh_token, _sess_id = await refresh_repo.create(
        user_id=user_id,
        tenant_id=tenant_id,
        ttl_seconds=s.JWT_REFRESH_TTL_SEC,
        device=req.device,
    )

    # ---- Return by client mode ----
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
            "tenant": {"tenantId": tenant_id, "name": chosen.get("name")},
        },
    )
