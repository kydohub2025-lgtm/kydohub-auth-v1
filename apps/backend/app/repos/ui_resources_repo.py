"""
repos/ui_resources_repo.py

Read UI resources (pages/actions) for a tenant.

Non-developer summary:
----------------------
This returns which pages and action-keys the UI should show for a tenant.
If nothing is configured yet, it safely returns empty lists.
"""

from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel, Field

from ..infra.mongo import get_db


class UIResourcesModel(BaseModel):
    """
    Minimal representation of a tenant's UI resources.
    """
    tenant_id: str = Field(..., alias="tenantId")
    pages: List[str] = Field(default_factory=list)
    actions: List[str] = Field(default_factory=list)

    class Config:
        allow_population_by_field_name = True


class UIResourcesRepo:
    """
    Collection shape (indicative):
      {
        tenantId: 't1',
        pages:   ['dashboard','students','reports'],
        actions: ['students.view','students.create', ...],
        updatedAt: ISODate(...)
      }

    Recommended indexes (see migration script):
      - unique { tenantId: 1 }
    """

    def __init__(self, collection_name: str = "ui_resources") -> None:
        self._col = get_db()[collection_name]

    async def get_for_tenant(self, tenant_id: str) -> UIResourcesModel:
        """
        Return configured UI resources for the tenant.
        If not found, returns an empty model (no pages/actions).
        """
        doc = await self._col.find_one(
            {"tenantId": tenant_id},
            projection={"_id": 0, "tenantId": 1, "pages": 1, "actions": 1},
        )
        if not doc:
            return UIResourcesModel(tenantId=tenant_id, pages=[], actions=[])
        # Normalize to strings only
        pages = [str(p) for p in (doc.get("pages") or []) if isinstance(p, str)]
        actions = [str(a) for a in (doc.get("actions") or []) if isinstance(a, str)]
        doc["pages"] = pages
        doc["actions"] = actions
        return UIResourcesModel(**doc)
