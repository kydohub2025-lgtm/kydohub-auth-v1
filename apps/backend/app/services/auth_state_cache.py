"""
services/auth_state_cache.py

Cache service for auth-related state:
- EV (epoch/version per {tenantId,userId})
- Permset (flattened RBAC permissions per {tenantId,userId})

Non-developer summary:
----------------------
This makes permission checks faster by keeping commonly used data in Redis.
If Redis isn't available, the app falls back to the database (a bit slower,
but it still works).
"""

from __future__ import annotations

import asyncio
import json
from typing import Optional, Set

from ..infra.redis import get_redis
from ..core.logging import logging  # reuse Python logging via our config


# Default TTL for permset cache: 15 minutes (900s).
DEFAULT_PERMSET_TTL = 900

# In-process "single-flight" locks per key to avoid thundering herd when Redis is cold.
_singleflight_locks: dict[str, asyncio.Lock] = {}


def _sf_lock(key: str) -> asyncio.Lock:
    """
    Get or create a per-key asyncio.Lock to serialize recomputations.
    This is process-local (works well for Lambda warm instances).
    """
    lock = _singleflight_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _singleflight_locks[key] = lock
    return lock


# ---------------------- EV ----------------------

async def get_ev(tenant_id: str, user_id: str) -> Optional[int]:
    """
    Return the cached EV (epoch/version) for {tenant,user}, or None if not cached/unavailable.
    """
    r = get_redis()
    if r is None:
        return None
    key = f"ev:{tenant_id}:{user_id}"
    try:
        val = await r.get(key)
        if val is None:
            return None
        return int(val)
    except Exception:
        # Don't fail the request because Redis is unavailable; let caller fall back to DB.
        logging.getLogger(__name__).warning("redis_get_ev_failed", extra={"key": key})
        return None


async def set_ev(tenant_id: str, user_id: str, value: int) -> None:
    """
    Set the EV (no TTL by design).
    """
    r = get_redis()
    if r is None:
        return
    key = f"ev:{tenant_id}:{user_id}"
    try:
        await r.set(key, int(value))
    except Exception:
        logging.getLogger(__name__).warning("redis_set_ev_failed", extra={"key": key})


# ---------------------- Permset ----------------------

async def get_permset(tenant_id: str, user_id: str) -> Optional[Set[str]]:
    """
    Return cached permission set for {tenant,user}, or None if not present/unavailable.

    Stored format in Redis: JSON array of strings.
    """
    r = get_redis()
    if r is None:
        return None
    key = f"permset:{tenant_id}:{user_id}"
    try:
        raw = await r.get(key)
        if raw is None:
            return None
        data = json.loads(raw)
        # Safety: ensure it's a set of strings
        return {str(p) for p in data if isinstance(p, str)}
    except Exception:
        logging.getLogger(__name__).warning("redis_get_permset_failed", extra={"key": key})
        return None


async def set_permset(tenant_id: str, user_id: str, perms: Set[str], ttl_sec: int = DEFAULT_PERMSET_TTL) -> None:
    """
    Cache a permission set for {tenant,user} with a TTL (seconds).
    """
    r = get_redis()
    if r is None:
        return
    key = f"permset:{tenant_id}:{user_id}"
    try:
        payload = json.dumps(sorted(perms))
        await r.set(key, payload, ex=int(ttl_sec))
    except Exception:
        logging.getLogger(__name__).warning("redis_set_permset_failed", extra={"key": key})


# ---------------------- Single-flight helper ----------------------

class SingleFlight:
    """
    A small helper to wrap expensive recomputations (like building a permset)
    so only one coroutine does the work and others await the result.

    Usage pattern:

        async with SingleFlight.key(f"permset:{tid}:{uid}") as sf:
            if await cache.get_permset(tid, uid) is None:
                perms = await recompute_from_mongo(...)
                await cache.set_permset(tid, uid, perms)
    """

    def __init__(self, key: str):
        self.key = key
        self._lock = _sf_lock(key)

    async def __aenter__(self):
        await self._lock.acquire()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        self._lock.release()

    @classmethod
    def key(cls, key: str) -> "SingleFlight":
        return cls(key)
