"""
services/jti_blocklist.py

JTI blocklist service:
- block(jti, ttl_sec): mark a token id as revoked (TTL == refresh token lifetime)
- is_blocked(jti): check whether a token id is blocked

Non-developer summary:
----------------------
When someone logs out or we detect a suspicious refresh, we add that token's
unique id (JTI) to a blocklist. Any future use of that token is rejected.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from ..infra.redis import get_redis
from ..infra.mongo import get_db
from ..core.logging import logging


# ---------------- Redis-first implementation with Mongo fallback ----------------

def _mongo_collection():
    """
    Mongo fallback collection:
      - name: jti_blocklist
      - document shape: { jti, expiresAt: ISODate }
      - TTL index recommended on expiresAt
    """
    return get_db()["jti_blocklist"]


async def block(jti: str, ttl_sec: int) -> None:
    """
    Block a JTI for `ttl_sec` seconds. Best-effort writes to both Redis and Mongo.

    Why both?
    ---------
    - Redis = immediate, fast checks.
    - Mongo = durable fallback if Redis is down or evicts keys.
    """
    # 1) Redis (best-effort)
    r = get_redis()
    if r is not None:
        try:
            await r.set(f"jti:block:{jti}", "1", ex=int(ttl_sec))
        except Exception:
            logging.getLogger(__name__).warning("redis_block_jti_failed", extra={"jti": jti})

    # 2) Mongo fallback (best-effort)
    try:
        expires_at = datetime.now(tz=timezone.utc) + timedelta(seconds=int(ttl_sec))
        await _mongo_collection().update_one(
            {"jti": jti},
            {"$set": {"jti": jti, "expiresAt": expires_at}},
            upsert=True,
        )
    except Exception:
        logging.getLogger(__name__).warning("mongo_block_jti_failed", extra={"jti": jti})


async def is_blocked(jti: str) -> bool:
    """
    Return True if the JTI is currently blocked. Favor availability:
    - Check Redis first (fast).
    - If Redis down or miss, check Mongo fallback.
    - If everything fails, assume not blocked (False) but log a warning.
    """
    # Redis check
    r = get_redis()
    if r is not None:
        try:
            val = await r.get(f"jti:block:{jti}")
            if val is not None:
                return True
        except Exception:
            logging.getLogger(__name__).warning("redis_is_blocked_failed", extra={"jti": jti})

    # Mongo fallback
    try:
        doc = await _mongo_collection().find_one({"jti": jti}, projection={"_id": 0, "expiresAt": 1})
        if doc and isinstance(doc.get("expiresAt"), datetime):
            if doc["expiresAt"] > datetime.now(tz=timezone.utc):
                return True
    except Exception:
        logging.getLogger(__name__).warning("mongo_is_blocked_failed", extra={"jti": jti})

    # Favor availability if both backends failed
    return False
