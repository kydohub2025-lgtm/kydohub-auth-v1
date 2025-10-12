"""
repos/refresh_session_repo.py

Refresh session persistence for web/mobile auth flows.

Non-developer summary:
----------------------
This file manages long-lived refresh sessions in the database. We only store a
SHA-256 hash of the refresh token, not the token itself, and we mark sessions
"rotated" or "revoked" as needed for security.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from ..infra.mongo import get_db


def hash_refresh(token: str) -> str:
    """
    Hash a refresh token using SHA-256. Only the hash is stored in DB.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass
class RefreshSession:
    """
    Minimal view of a refresh session as used by routes.
    """
    user_id: str
    tenant_id: str
    expires_at: datetime


class RefreshSessionRepo:
    """
    Mongo collection: 'refresh_sessions'

    Document shape (indicative):
    {
      userId: 'u1',
      tenantId: 't1',
      tokenHash: '<sha256>',
      status: 'active'|'rotated'|'revoked'|'expired',
      createdAt: ISODate(...),
      expiresAt: ISODate(...),
      device: { name?, fingerprint? } // optional
    }

    Indexes (see migration script):
      - TTL on { expiresAt: 1 } with expireAfterSeconds: 0
      - { tokenHash: 1, status: 1 }
      - { userId: 1, tenantId: 1 }
    """

    def __init__(self, collection_name: str = "refresh_sessions") -> None:
        self._col = get_db()[collection_name]

    # ---------------- Creation ----------------

    async def create(
        self,
        *,
        user_id: str,
        tenant_id: str,
        ttl_seconds: int,
        device: Optional[Dict[str, Any]] = None,
        refresh_token: Optional[str] = None,
    ) -> Tuple[str, str]:
        """
        Create a new refresh session.

        Returns:
          (refresh_token, session_id)
        """
        now = datetime.now(tz=timezone.utc)
        exp = now + timedelta(seconds=int(ttl_seconds))
        token = refresh_token or secrets.token_urlsafe(48)
        doc = {
            "userId": user_id,
            "tenantId": tenant_id,
            "tokenHash": hash_refresh(token),
            "status": "active",
            "createdAt": now,
            "expiresAt": exp,
            "device": device or {},
        }
        result = await self._col.insert_one(doc)
        return token, str(result.inserted_id)

    # ---------------- Lookups ----------------

    async def find_active_by_token(self, token: str) -> Optional[RefreshSession]:
        """
        Find an active, non-expired session by raw refresh token.
        Returns None if not found or expired.
        """
        now = datetime.now(tz=timezone.utc)
        h = hash_refresh(token)
        doc = await self._col.find_one(
            {"tokenHash": h, "status": "active", "expiresAt": {"$gt": now}},
            projection={"_id": 0, "userId": 1, "tenantId": 1, "expiresAt": 1},
        )
        if not doc:
            return None
        return RefreshSession(user_id=str(doc["userId"]), tenant_id=str(doc["tenantId"]), expires_at=doc["expiresAt"])

    # ---------------- Rotation ----------------

    async def rotate(self, *, user_id: str, tenant_id: str, old_token: str, ttl_seconds: int) -> str:
        """
        Rotate an active session:
          - Mark the old session (by hash) as 'rotated'
          - Create a new 'active' session with a fresh token
        Returns:
          new_refresh_token
        """
        now = datetime.now(tz=timezone.utc)
        old_hash = hash_refresh(old_token)

        # Mark the old one as rotated (best-effort match by hash+user+tenant for safety)
        await self._col.update_one(
            {"tokenHash": old_hash, "userId": user_id, "tenantId": tenant_id, "status": "active"},
            {"$set": {"status": "rotated", "rotatedAt": now}},
        )

        # Insert new active session
        new_token = secrets.token_urlsafe(48)
        await self.create(user_id=user_id, tenant_id=tenant_id, ttl_seconds=ttl_seconds, refresh_token=new_token)
        return new_token

    # ---------------- Revocation ----------------

    async def revoke_by_token(self, token: str) -> None:
        """
        Revoke a session by raw refresh token (best-effort).
        Used by logout to invalidate the cookie-stored refresh.
        """
        now = datetime.now(tz=timezone.utc)
        h = hash_refresh(token)
        await self._col.update_one(
            {"tokenHash": h, "status": "active"},
            {"$set": {"status": "revoked", "revokedAt": now}},
        )

    async def revoke_all_for_user(self, user_id: str, tenant_id: Optional[str] = None) -> int:
        """
        Mass revoke: mark all active sessions for a user (optionally in a single tenant) as revoked.
        Returns the number of sessions matched.
        """
        now = datetime.now(tz=timezone.utc)
        q: Dict[str, Any] = {"userId": user_id, "status": "active"}
        if tenant_id:
            q["tenantId"] = tenant_id
        result = await self._col.update_many(q, {"$set": {"status": "revoked", "revokedAt": now}})
        return int(result.modified_count)
