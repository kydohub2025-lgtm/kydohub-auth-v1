"""
db/migrations/001_auth_indexes.py

Creates indexes required by Auth (/me/context) with least-privilege & safety.

Security goals:
- Enforce 1:1 link to Supabase identity (unique users.supabaseId).
- Prevent duplicate memberships per (tenantId, userId).
- TTL for revocation lists (refresh tokens & JTI blocklist).
- Predictable names for indexes (easy to audit in Compass).

Run:
  python -m apps.backend.app.db.migrations.001_auth_indexes
"""

from __future__ import annotations

import asyncio

# Use your existing absolute import style to match current codebase
from apps.backend.app.infra.mongo import get_db, get_mongo_client


async def create_users_indexes() -> None:
    col = get_db()["users"]

    # Canonical ID is Mongo _id (we do NOT create an extra userId field).
    # Enforce 1:1 mapping with Supabase identity.
    await col.create_index(
        [("supabaseId", 1)],
        unique=True,
        name="uniq_supabaseId",
    )

    # Helpful lookups (optional). Keep if you often query by email.
    await col.create_index(
        [("profile.email", 1)],
        name="by_email",
    )


async def create_memberships_indexes() -> None:
    col = get_db()["memberships"]

    # Exactly one membership per (tenant, user)
    await col.create_index(
        [("tenantId", 1), ("userId", 1)],
        unique=True,
        name="uniq_tenant_user",
    )

    # Admin/reporting queries by role within a tenant
    await col.create_index(
        [("tenantId", 1), ("roles", 1)],
        name="by_tenant_roles",
    )

    # Common filter
    await col.create_index(
        [("tenantId", 1), ("status", 1)],
        name="by_tenant_status",
    )


async def create_roles_indexes() -> None:
    col = get_db()["roles"]
    await col.create_index(
        [("tenantId", 1), ("name", 1)],
        unique=True,
        name="uniq_tenant_role",
    )
    await col.create_index([("tenantId", 1)], name="by_tenant")


async def create_ui_resources_indexes() -> None:
    col = get_db()["ui_resources"]
    # One ui_resources document per tenant
    await col.create_index([("tenantId", 1)], unique=True, name="uniq_tenant")


async def create_refresh_sessions_indexes() -> None:
    col = get_db()["refresh_sessions"]
    # Auto-cleanup on expiresAt; 0 => expire at the exact timestamp
    await col.create_index(
        [("expiresAt", 1)],
        expireAfterSeconds=0,
        name="ttl_expires_at",
    )
    await col.create_index(
        [("tokenHash", 1), ("status", 1)],
        name="by_hash_status",
    )
    await col.create_index(
        [("userId", 1), ("tenantId", 1)],
        name="by_user_tenant",
    )


async def create_jti_blocklist_indexes() -> None:
    col = get_db()["jti_blocklist"]
    await col.create_index(
        [("expiresAt", 1)],
        expireAfterSeconds=0,
        name="ttl_expires_at",
    )
    await col.create_index(
        [("jti", 1)],
        unique=True,
        name="uniq_jti",
    )


async def run() -> None:
    await create_users_indexes()
    await create_memberships_indexes()
    await create_roles_indexes()
    await create_ui_resources_indexes()
    await create_refresh_sessions_indexes()
    await create_jti_blocklist_indexes()


if __name__ == "__main__":
    asyncio.run(run())
    # Ensure clean shutdown of the shared client (important for CLIs & CI)
    get_mongo_client().close()