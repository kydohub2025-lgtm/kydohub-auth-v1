"""
repos/role_repo.py

Role repository:
- Load role documents for a tenant.
- Flatten them into a stable set of permission strings for RBAC checks.
- Keep results small and deterministic so they cache well.

Non-developer summary:
----------------------
A user's roles (e.g., "teacher") translate into a list of "can do" strings
(e.g., "students.view"). We fetch the role docs and flatten them into one set.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Set

from pydantic import BaseModel, Field

from ..infra.mongo import get_db


# ---------- Result models (minimal) ----------

class RoleModel(BaseModel):
    """
    Minimal in-memory representation of a role.
    """
    tenant_id: str = Field(..., alias="tenantId")
    name: str
    # Permissions are stored as strings like "resource.action".
    permissions: List[str] = Field(default_factory=list)

    class Config:
        allow_population_by_field_name = True


class RoleRepo:
    """
    Read-only repository for role data.

    Expected collection shape (indicative):
    ---------------------------------------
    db.roles.insert_one({
      tenantId: 't1',
      name: 'teacher',
      permissions: ['students.view', 'attendance.mark'],
      createdAt: ISODate(...),
      updatedAt: ISODate(...)
    })

    Indexes (recommended via migrations/seed):
      - { tenantId: 1, name: 1 } unique
    """

    def __init__(self, collection_name: str = "roles") -> None:
        self._collection = get_db()[collection_name]

    async def list_by_names(self, tenant_id: str, names: List[str]) -> List[RoleModel]:
        """
        Fetch role documents by names for a given tenant.
        """
        if not names:
            return []
        cursor = self._collection.find(
            {"tenantId": tenant_id, "name": {"$in": names}},
            projection={"_id": 0, "tenantId": 1, "name": 1, "permissions": 1},
        )
        results: List[RoleModel] = []
        async for doc in cursor:
            results.append(RoleModel(**doc))
        return results

    @staticmethod
    def flatten_permissions(roles: List[RoleModel]) -> Set[str]:
        """
        Merge and normalize permissions from a list of roles.

        Rules:
          - Deduplicate (use a set).
          - Strip whitespace; skip empty strings.
          - Keep plain strings like "resource.action" only (no wildcards here).
        """
        perms: Set[str] = set()
        for r in roles:
            for p in r.permissions or []:
                p = (p or "").strip()
                if not p:
                    continue
                perms.add(p)
        return perms

    async def get_permset_for_roles(self, tenant_id: str, names: List[str]) -> Set[str]:
        """
        Convenience: fetch roles by name and flatten to a permission set.
        """
        roles = await self.list_by_names(tenant_id, names)
        return self.flatten_permissions(roles)
