"""
schemas/me_context_dto.py

Typed response model for GET /me/context.

Non-developer summary:
----------------------
This is the contract the frontend expects after login/refresh: which pages to
show, what actions are allowed, and small hints for filtering (ABAC). We
upgraded `ui_resources` from string lists to rich objects so the server can
fully drive the UI (title, path, required permissions, ordering, etc.).
"""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field, validator


# -----------------------------
# Tenant / User
# -----------------------------
class TenantDTO(BaseModel):
    tenantId: str = Field(..., description="Tenant identifier")
    name: Optional[str] = Field(None, description="Tenant display name")
    timezone: Optional[str] = Field(None, description="IANA timezone, e.g. 'America/Vancouver'")

    class Config:
        extra = "ignore"
        orm_mode = True


class UserDTO(BaseModel):
    userId: str = Field(..., description="User identifier (subject)")
    name: Optional[str] = Field(None)
    email: Optional[str] = Field(None)
    avatarUrl: Optional[str] = Field(None)

    class Config:
        extra = "ignore"
        orm_mode = True


# -----------------------------
# Rich UI resources (V2)
# -----------------------------
class UiPageDTO(BaseModel):
    """
    One navigable page/section in the UI for this tenant.
    The frontend renders navigation from this list and gates each entry with <Acl requires={requires}>.
    """
    id: str = Field(..., description="Stable page key, e.g. 'students'")
    title: str = Field(..., description="Human friendly title")
    path: str = Field(..., description="Route path, e.g. '/students'")
    requires: List[str] = Field(default_factory=list, description="Permission keys required to see this page")
    icon: Optional[str] = Field(None, description="Optional icon key")
    order: Optional[int] = Field(None, description="Sort order (ascending). None treated as 0.")
    section: Optional[str] = Field(None, description="Optional section bucket, e.g. 'main' or 'admin'")

    @validator("id", "title", "path")
    def _strip_core(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v

    @validator("requires", pre=True)
    def _norm_requires(cls, v):
        if v is None:
            return []
        try:
            return [str(x).strip() for x in v]
        except Exception:
            return []


class UiActionDTO(BaseModel):
    """
    One actionable control (button/menu) that may appear in pages.
    The frontend gates controls with <Acl requires={requires}> and can use label/confirm for UX.
    """
    id: str = Field(..., description="Stable action key, e.g. 'student.create'")
    requires: List[str] = Field(default_factory=list, description="Permission keys required to use this action")
    label: Optional[str] = Field(None, description="Optional UI label")
    confirm: Optional[bool] = Field(None, description="Whether confirmation is recommended")

    @validator("id")
    def _strip_id(cls, v: str) -> str:
        return v.strip()

    @validator("requires", pre=True)
    def _norm_requires(cls, v):
        if v is None:
            return []
        try:
            return [str(x).strip() for x in v]
        except Exception:
            return []


class UIResourcesDTO(BaseModel):
    """
    Tenant-owned catalog of pages/actions/feature flags that *could* be shown.
    Actual visibility depends on the user's permissions in /me/context.
    """
    pages: List[UiPageDTO] = Field(default_factory=list, description="Navigation entries with metadata")
    actions: List[UiActionDTO] = Field(default_factory=list, description="Action entries with metadata")
    featureFlags: Optional[Dict[str, bool]] = Field(default=None, description="Tenant-level feature toggles")

    class Config:
        extra = "ignore"
        orm_mode = True


# -----------------------------
# ABAC hints & meta
# -----------------------------
class ABACDTO(BaseModel):
    # Staff may see rooms they belong to; guardians may see students they are linked to.
    rooms: List[str] = Field(default_factory=list)
    guardianOf: List[str] = Field(default_factory=list)

    class Config:
        extra = "ignore"
        orm_mode = True


class MetaDTO(BaseModel):
    ev: int = Field(..., description="Authorization epoch for freshness checks")

    class Config:
        extra = "ignore"
        orm_mode = True


# -----------------------------
# Top-level /me/context DTO
# -----------------------------
class MeContextDTO(BaseModel):
    tenant: TenantDTO
    user: UserDTO
    roles: List[str] = Field(default_factory=list)
    permissions: List[str] = Field(default_factory=list, description="Flattened RBAC permission keys")
    ui_resources: UIResourcesDTO
    abac: ABACDTO
    meta: MetaDTO

    @validator("roles", "permissions", pre=True)
    def _normalize_lists(cls, v):
        # Accept sets or iterables; return a sorted unique list for stable diffs on FE.
        if v is None:
            return []
        if isinstance(v, set):
            return sorted(v)
        try:
            return sorted({str(x) for x in v})
        except Exception:
            return []

    class Config:
        extra = "ignore"
        allow_population_by_field_name = True
        orm_mode = True
