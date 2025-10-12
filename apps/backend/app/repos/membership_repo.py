"""
repos/membership_repo.py

Membership repository:
- Fetch a user's membership for a specific tenant.
- Optionally list memberships by role (for admin tools, future use).
- Shapes the minimal data we need for RBAC/ABAC and /me/context.

Non-developer summary:
----------------------
This reads the "link" between a user and a tenant. If a user is disabled or has
no membership in a tenant, we should not let them access that tenant's data.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict

from pydantic import BaseModel, Field

from ..infra.mongo import get_db


# ---------- Result models (typed, small) ----------

class MembershipModel(BaseModel):
    """
    Minimal representation of a membership document for runtime decisions.
    """
    tenant_id: str = Field(..., alias="tenantId")
    user_id: str = Field(..., alias="userId")
    status: str = Field(..., description="active|suspended|invited|removed")
    roles: List[str] = Field(default_factory=list)
    attrs: Dict[str, Any] = Field(default_factory=dict)  # ABAC hints (e.g., rooms, grade, etc.)

    class Config:
        allow_population_by_field_name = True


class MembershipRepo:
    """
    Read-only repository for membership data.

    Collection shape (indicative):
    --------------------------------
    db.memberships.insert_one({
      tenantId: 't1',
      userId: 'u1',
      status: 'active',
      roles: ['teacher'],
      attrs: { rooms: ['r1','r2'] },
      createdAt: ISODate(...),
      updatedAt: ISODate(...)
    })

    Indexes (recommended, configured in migrations/seed):
      - { tenantId: 1, userId: 1 } unique
      - { tenantId: 1, roles: 1 } (optional for admin queries)
    """

    def __init__(self, collection_name: str = "memberships") -> None:
        self._collection = get_db()[collection_name]

    async def get(self, tenant_id: str, user_id: str) -> Optional[MembershipModel]:
        """
        Return the membership for (tenant_id, user_id), or None if not found.

        We project only the needed fields to keep reads small and fast.
        """
        doc = await self._collection.find_one(
            {"tenantId": tenant_id, "userId": user_id},
            projection={"_id": 0, "tenantId": 1, "userId": 1, "status": 1, "roles": 1, "attrs": 1},
        )
        if not doc:
            return None
        return MembershipModel(**doc)

    async def list_by_roles(self, tenant_id: str, roles: List[str], limit: int = 100) -> List[MembershipModel]:
        """
        Return up to `limit` memberships in a tenant that include any of the given roles.
        Useful for admin/reporting tools; not used in hot paths.
        """
        cursor = self._collection.find(
            {"tenantId": tenant_id, "roles": {"$in": roles}},
            projection={"_id": 0, "tenantId": 1, "userId": 1, "status": 1, "roles": 1, "attrs": 1},
            limit=limit,
        )
        results: List[MembershipModel] = []
        async for doc in cursor:
            results.append(MembershipModel(**doc))
        return results
