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

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
try:
    # Pydantic v2
    from pydantic import ConfigDict, field_validator
    _IS_PYDANTIC_V2 = True
except Exception:  # pragma: no cover
    # Pydantic v1 fallback
    _IS_PYDANTIC_V2 = False
from bson import ObjectId

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

    if _IS_PYDANTIC_V2:
        # v2 config
        model_config = ConfigDict(populate_by_name=True)

        @field_validator("tenant_id", mode="before")
        @classmethod
        def _tenant_id_to_str(cls, v):
            # Accept ObjectId or str; store as str
            return str(v) if isinstance(v, ObjectId) else v

        @field_validator("attrs", mode="before")
        @classmethod
        def _attrs_default(cls, v):
            return v or {}

    else:  # Pydantic v1 compatibility
        class Config:
            allow_population_by_field_name = True

        @classmethod
        def __get_validators__(cls):
            yield cls._coerce

        @classmethod
        def _coerce(cls, values):
            # values may be dict during model init
            if isinstance(values, dict):
                v = values.get("tenantId")
                if isinstance(v, ObjectId):
                    values["tenantId"] = str(v)
                if values.get("attrs") is None:
                    values["attrs"] = {}
            return values


class MembershipRepo:
    """
    Read-only repository for membership data.

    Collection shape (indicative):
    --------------------------------
    db.memberships.insert_one({
      tenantId: ObjectId('...') or 't1',
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

    @staticmethod
    def _as_oid_or_same(v: str | Any) -> Any:
        """
        If v is a 24-hex string, return ObjectId(v); otherwise return v unchanged.
        Lets us query whether tenantId is stored as ObjectId or string.
        """
        if isinstance(v, str) and ObjectId.is_valid(v):
            return ObjectId(v)
        return v

    @staticmethod
    def _normalize_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert fields so the model can validate consistently.
        - tenantId: ObjectId -> str
        - attrs: None -> {}
        """
        if isinstance(doc.get("tenantId"), ObjectId):
            doc["tenantId"] = str(doc["tenantId"])
        if doc.get("attrs") is None:
            doc["attrs"] = {}
        if doc.get("roles") is None:
            doc["roles"] = []
        return doc

    async def get(self, tenant_id: str, user_id: str) -> Optional[MembershipModel]:
        """
        Return the membership for (tenant_id, user_id), or None if not found.

        We project only the needed fields to keep reads small and fast.
        """
        doc = await self._collection.find_one(
            {"tenantId": self._as_oid_or_same(tenant_id), "userId": user_id},
            projection={"_id": 0, "tenantId": 1, "userId": 1, "status": 1, "roles": 1, "attrs": 1},
        )
        if not doc:
            return None
        doc = self._normalize_doc(doc)
        return MembershipModel(**doc)

    async def list_by_roles(self, tenant_id: str, roles: List[str], limit: int = 100) -> List[MembershipModel]:
        """
        Return up to `limit` memberships in a tenant that include any of the given roles.
        Useful for admin/reporting tools; not used in hot paths.
        """
        cursor = self._collection.find(
            {"tenantId": self._as_oid_or_same(tenant_id), "roles": {"$in": roles}},
            projection={"_id": 0, "tenantId": 1, "userId": 1, "status": 1, "roles": 1, "attrs": 1},
            limit=limit,
        )
        results: List[MembershipModel] = []
        async for doc in cursor:
            results.append(MembershipModel(**self._normalize_doc(doc)))
        return results
