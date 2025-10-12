"""
db/migrations/001_auth_indexes.py

Creates indexes required by Auth & /me/context.

Non-developer summary:
----------------------
Indexes make queries fast and keep data consistent. This script adds them for
memberships, roles, ui_resources, refresh_sessions, and jti_blocklist. It also
adds TTLs so expired sessions/block entries clean themselves up automatically.
"""

from __future__ import annotations

import asyncio
from typing import Sequence

from apps.backend.app.infra.mongo import get_db, get_mongo_client


async def create_memberships_indexes():
    col = get_db()["memberships"]
    # Unique (tenantId, userId) guarantees one membership per tenant per user
    await col.create_index([("tenantId", 1), ("userId", 1)], unique=True, name="uniq_tenant_user")
    # Helpful when querying by roles in admin tools
    await col.create_index([("tenantId", 1), ("roles", 1)], name="by_tenant_roles")


async def create_roles_indexes():
    col = get_db()["roles"]
    await col.create_index([("tenantId", 1), ("name", 1)], unique=True, name="uniq_tenant_role")
    await col.create_index([("tenantId", 1)], name="by_tenant")


async def create_ui_resources_indexes():
    col = get_db()["ui_resources"]
    await col.create_index([("tenantId", 1)], unique=True, name="uniq_tenant")
    # Optional: if you frequently filter pages/actions separately, add specific indexes as needed.


async def create_refresh_sessions_indexes():
    col = get_db()["refresh_sessions"]
    # Clean up expired sessions automatically
    # TTL index: docs expire when 'expiresAt' < now; expireAfterSeconds=0 means "at the time in the field".
    await col.create_index([("expiresAt", 1)], expireAfterSeconds=0, name="ttl_expires_at")
    # Fast lookups by tokenHash and status
    await col.create_index([("tokenHash", 1), ("status", 1)], name="by_hash_status")
    # Helpful dashboards/analytics
    await col.create_index([("userId", 1), ("tenantId", 1)], name="by_user_tenant")


async def create_jti_blocklist_indexes():
    col = get_db()["jti_blocklist"]
    # Expire block entries automatically when their window ends
    await col.create_index([("expiresAt", 1)], expireAfterSeconds=0, name="ttl_expires_at")
    await col.create_index([("jti", 1)], unique=True, name="uniq_jti")


async def create_tenants_users_indexes():
    # Optional but recommended for referential integrity and quick lookups
    tcol = get_db()["tenants"]
    await tcol.create_index([("tenantId", 1)], unique=True, name="uniq_tenantId")
    ucol = get_db()["users"]
    await ucol.create_index([("userId", 1)], unique=True, name="uniq_userId")


async def run():
    await create_memberships_indexes()
    await create_roles_indexes()
    await create_ui_resources_indexes()
    await create_refresh_sessions_indexes()
    await create_jti_blocklist_indexes()
    await create_tenants_users_indexes()


if __name__ == "__main__":
    # Allow running as a simple script: `python apps/backend/app/db/migrations/001_auth_indexes.py`
    asyncio.run(run())
    # Ensure connections are closed cleanly in local runs
    get_mongo_client().close()
