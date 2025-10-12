"""
schemas/me_context_dto.py

Typed response model for GET /me/context.

Non-developer summary:
----------------------
This is the contract the frontend expects after login/refresh: which pages to
show, what actions are allowed, and small hints for filtering (ABAC).
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, validator


class TenantDTO(BaseModel):
    tenantId: str = Field(..., description="Tenant identifier")
    name: Optional[str] = Field(None, description="Tenant display name")
    timezone: Optional[str] = Field(None, description="IANA timezone, e.g. 'America/Vancouver'")

    class Config:
        extra = "ignore"
        orm_mode = True


class UserDTO(BaseModel):
    userId: str = Field(..., description="User identifier")
    name: Optional[str] = Field(None)
    email: Optional[str] = Field(None)
    avatarUrl: Optional[str] = Field(None)

    class Config:
        extra = "ignore"
        orm_mode = True


class UIResourcesDTO(BaseModel):
    pages: List[str] = Field(default_factory=list, description="UI sections/pages enabled for this tenant")
    actions: List[str] = Field(default_factory=list, description="Action keys that may be feature-flagged in UI")

    @validator("pages", "actions", each_item=True)
    def _strip_items(cls, v: str) -> str:
        return v.strip()

    class Config:
        extra = "ignore"
        orm_mode = True


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
