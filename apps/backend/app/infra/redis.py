"""
infra/redis.py

Optional Redis client provider (Amazon ElastiCache recommended).

Non-developer summary:
----------------------
Redis accelerates certain checks (permissions, EV, token blocklists). If it's not
configured, the app still works by falling back to Mongo — just a little slower.
"""

from __future__ import annotations

from typing import Optional

from ..core.config import get_settings

# Try to import the modern asyncio Redis client.
try:
    import redis.asyncio as redis  # type: ignore
except Exception:  # pragma: no cover - import-time fallback
    redis = None  # Redis support not available in this environment


# Global singleton client reused across the process (if configured).
_redis_client: Optional["redis.Redis"] = None  # type: ignore[name-defined]


def get_redis() -> Optional["redis.Redis"]:  # type: ignore[name-defined]
    """
    Return the global Redis client if REDIS_URL is configured and the redis library is available.
    Otherwise return None so callers can degrade gracefully.

    Non-developer summary:
    ----------------------
    If this returns None:
      - Redis is intentionally disabled (no URL), or
      - The redis library wasn't available in the environment.
    Our code checks for None and uses the database as a fallback.
    """
    global _redis_client
    s = get_settings()

    # If no URL configured or the library is missing, Redis is disabled.
    if not s.REDIS_URL or redis is None:
        return None

    if _redis_client is None:
        _redis_client = redis.from_url(str(s.REDIS_URL), decode_responses=True)  # type: ignore[union-attr]

    return _redis_client


async def close_redis() -> None:
    """
    Close the global Redis client (useful for local tests).
    """
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()  # graceful close for asyncio client
        except Exception:
            # Some redis client versions use `close()` instead of `aclose()`
            try:
                _redis_client.close()  # type: ignore[attr-defined]
            except Exception:
                pass
        finally:
            _redis_client = None
