"""
routers/me_context.py

GET /me/context
Builds the tenant-scoped authorization context:
- tenant, user, roles, permissions, ui_resources (pages, actions, featureFlags), abac, meta.ev

Non-breaking changes:
- If UIResourcesRepo returns a Pydantic model, coerce to dict via .model_dump()
- Defensive normalization for pages/actions (works with legacy string entries or rich objects)
- Pages sorted by 'order' (None -> 0) for stable nav
- featureFlags defaults to {}
"""

from __future__ import annotations

from typing import Any, Dict, List

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..guards.auth_chain import AuthContext, auth_chain
from ..infra.mongo import get_db
from ..repos.ui_resources_repo import UIResourcesRepo
from ..services import auth_state_cache as cache

try:
    # pydantic v2
    from pydantic import BaseModel as PydanticBaseModel  # type: ignore
except Exception:  # pragma: no cover
    PydanticBaseModel = object  # fallback if not available

router = APIRouter(tags=["me"])


# -----------------------------
# small helpers
# -----------------------------

def _as_list_str(v: Any) -> List[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if isinstance(v, (set, tuple)):
        return [str(x).strip() for x in list(v) if str(x).strip()]
    s = str(v).strip()
    return [s] if s else []


def _coerce_page(p: Any) -> Dict[str, Any]:
    """
    Accept legacy string 'students' or rich page dict and return normalized dict.
    Required: id, title, path, requires(list)
    Optional: icon, order, section
    """
    if isinstance(p, str):
        pid = p.strip()
        if not pid:
            return {}
        return {
            "id": pid,
            "title": pid[:1].upper() + pid[1:],
            "path": f"/{pid}",
            "requires": [],
            "icon": None,
            "order": None,
            "section": None,
        }
    if isinstance(p, dict):
        pid = str(p.get("id", "")).strip()
        if not pid:
            return {}
        title = (p.get("title") or "").strip() or (pid[:1].upper() + pid[1:])
        path = (p.get("path") or "").strip() or f"/{pid}"
        requires = _as_list_str(p.get("requires"))
        icon = p.get("icon") if isinstance(p.get("icon"), str) else None
        order_val = p.get("order", None)
        try:
            order_val = int(order_val) if order_val is not None else None
        except Exception:
            order_val = None
        section = p.get("section") if isinstance(p.get("section"), str) else None
        return {
            "id": pid,
            "title": title,
            "path": path,
            "requires": requires,
            "icon": icon,
            "order": order_val,
            "section": section,
        }
    return {}


def _coerce_action(a: Any) -> Dict[str, Any]:
    """
    Accept legacy string 'student.create' or rich action dict and return normalized dict.
    Required: id, requires(list)
    Optional: label, confirm
    """
    if isinstance(a, str):
        aid = a.strip()
        if not aid:
            return {}
        return {"id": aid, "requires": [], "label": None, "confirm": None}
    if isinstance(a, dict):
        aid = str(a.get("id", "")).strip()
        if not aid:
            return {}
        requires = _as_list_str(a.get("requires"))
        label = a.get("label") if isinstance(a.get("label"), str) else None
        confirm = a.get("confirm")
        if confirm not in (None, True, False):
            confirm = None
        return {"id": aid, "requires": requires, "label": label, "confirm": confirm}
    return {}


def _to_mapping(obj: Any) -> Dict[str, Any]:
    """
    Coerce UI resources to a plain dict:
    - Pydantic v2: model_dump()
    - Pydantic v1: dict()
    - Fallback: __dict__ or {}
    """
    if obj is None:
        return {}
    # pydantic v2
    if hasattr(obj, "model_dump"):
        try:
            return obj.model_dump()  # type: ignore[attr-defined]
        except Exception:
            pass
    # pydantic v1
    if hasattr(obj, "dict"):
        try:
            return obj.dict()  # type: ignore[attr-defined]
        except Exception:
            pass
    # generic
    if hasattr(obj, "__dict__"):
        try:
            return dict(obj.__dict__)
        except Exception:
            pass
    # already a mapping?
    if isinstance(obj, dict):
        return obj
    return {}


# -----------------------------
# route
# -----------------------------

@router.get("/me/context")
async def me_context(ctx: AuthContext = Depends(auth_chain)):
    """
    Requires valid access token (handled by auth_chain).
    Does NOT accept tenantId from client.
    """
    db = get_db()

    tenant_oid: ObjectId = ctx.tenant_id
    user_id: str = ctx.user_id

    # ------------------------------
    # UI resources
    # ------------------------------
    ui_repo = UIResourcesRepo()
    ui_obj = await ui_repo.get_for_tenant(str(tenant_oid))  # may be pydantic model or dict
    ui = _to_mapping(ui_obj)

    raw_pages = ui.get("pages", []) or []
    raw_actions = ui.get("actions", []) or []
    feature_flags = ui.get("featureFlags", {}) or {}

    pages = [x for x in (_coerce_page(p) for p in raw_pages) if x.get("id")]
    pages.sort(key=lambda x: ((x.get("order") or 0), x.get("title", "").lower()))
    actions = [x for x in (_coerce_action(a) for a in raw_actions) if x.get("id")]

    if isinstance(feature_flags, dict):
        feature_flags = {str(k).strip(): bool(v) for k, v in feature_flags.items() if str(k).strip()}
    else:
        feature_flags = {}

    # ------------------------------
    # Tenant block (support both schemas)
    # ------------------------------
    tdoc = await db["tenants"].find_one(
        {"tenantId": tenant_oid},
        projection={
            "_id": 0,
            "tenantId": 1,
            "name": 1,
            "timezone": 1,
            "school.name": 1,
            "school.timeZone": 1,
        },
    )
    tenant_block = {
        "tenantId": str(tenant_oid),
        "name": (tdoc or {}).get("name") or (tdoc or {}).get("school", {}).get("name"),
        "timezone": (tdoc or {}).get("timezone") or (tdoc or {}).get("school", {}).get("timeZone"),
    }

    # ------------------------------
    # User block (support both schemas)
    # ------------------------------
    udoc = await db["users"].find_one(
        {"$or": [{"userId": user_id}, {"supabaseId": user_id}]},
        projection={
            "_id": 0,
            "userId": 1,
            "supabaseId": 1,
            "name": 1,
            "email": 1,
            "avatarUrl": 1,
            "profile.name": 1,
            "profile.email": 1,
            "profile.photoUrl": 1,
        },
    )
    user_block = {
        "userId": user_id,
        "name": (udoc or {}).get("name") or (udoc or {}).get("profile", {}).get("name"),
        "email": (udoc or {}).get("email") or (udoc or {}).get("profile", {}).get("email"),
        "avatarUrl": (udoc or {}).get("avatarUrl") or (udoc or {}).get("profile", {}).get("photoUrl"),
    }

    # ------------------------------
    # Roles / permissions / ABAC
    # ------------------------------
    roles = list(ctx.roles or [])
    permissions = sorted(list(ctx.permissions or set()))
    abac = {
        "rooms": list((ctx.abac or {}).get("rooms", [])),
        "guardianOf": list((ctx.abac or {}).get("guardianOf", [])),
    }

    # ------------------------------
    # EV (event version) for staleness detection
    # ------------------------------
    server_ev = await cache.get_ev(str(tenant_oid), user_id)
    meta = {"ev": ctx.ev if ctx.ev is not None else (server_ev or 0)}

    body: Dict[str, Any] = {
        "tenant": tenant_block,
        "user": user_block,
        "roles": roles,
        "permissions": permissions,
        "ui_resources": {
            "pages": pages,
            "actions": actions,
            "featureFlags": feature_flags,
        },
        "abac": abac,
        "meta": meta,
    }

    return JSONResponse(status_code=200, content=body)
