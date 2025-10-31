"""
infra/mongo.py

MongoDB (Mongo Atlas) client provider using Motor (async).

Non-developer summary:
----------------------
We create one global Mongo client and reuse it across requests (and Lambda warm
invocations). This is faster and more reliable than opening a new connection
for every request. Timeouts are tuned to fail fast if the database is not reachable.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import WriteConcern, ReadPreference
from pymongo.read_concern import ReadConcern
from pymongo.errors import ServerSelectionTimeoutError

from app.core.config import get_settings


# ---------------------------------------------------------------------------
# Global Mongo client (singleton, reused across process/Lambda invocations)
# ---------------------------------------------------------------------------
_client: Optional[AsyncIOMotorClient] = None


# ---------------------------------------------------------------------------
# Core: client accessor
# ---------------------------------------------------------------------------
def get_mongo_client() -> AsyncIOMotorClient:
    """
    Lazily create (and then reuse) the AsyncIOMotorClient.

    Ensures .env.local is loaded before using the URI.
    """
    global _client
    if _client is None:
        settings = get_settings()
        uri = str(settings.MONGODB_URI)  # ✅ Convert AnyUrl -> str for Motor
        print(f"[infra.mongo] Initializing Mongo client with URI: {uri}")
        try:
            _client = AsyncIOMotorClient(
                uri,
                serverSelectionTimeoutMS=settings.MONGO_CONNECT_TIMEOUT_MS,
                socketTimeoutMS=settings.MONGO_SOCKET_TIMEOUT_MS,
                uuidRepresentation="standard",
            )
        except Exception as e:
            print(f"[infra.mongo] ❌ Failed to create Mongo client: {e}")
            raise
    return _client


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def get_db() -> AsyncIOMotorDatabase:
    """
    Return the application's default database object (e.g., 'kydohub').
    """
    settings = get_settings()
    return get_mongo_client()[settings.MONGODB_DB]


def get_transaction_opts():
    """
    Standardized transaction/read/write concerns for critical writes.
    """
    return {
        "read_preference": ReadPreference.PRIMARY,
        "write_concern": WriteConcern("majority"),
        "read_concern": ReadConcern("majority"),
    }


# ---------------------------------------------------------------------------
# Lifecycle helpers
# ---------------------------------------------------------------------------
async def init_mongo() -> bool:
    """
    Called on FastAPI startup to verify Mongo connectivity.
    Returns True if ping succeeds, False otherwise.
    """
    client = get_mongo_client()
    try:
        await client.admin.command("ping")
        print("✅ [infra.mongo] MongoDB connection successful")
        return True
    except ServerSelectionTimeoutError as e:
        print(f"❌ [infra.mongo] MongoDB not reachable: {e}")
        return False
    except Exception as e:
        print(f"❌ [infra.mongo] Unexpected Mongo error: {e}")
        return False


async def close_mongo_client() -> None:
    """
    Close the global Mongo client (rarely needed in Lambda; useful in local tests).
    """
    global _client
    if _client is not None:
        print("[infra.mongo] Closing MongoDB client")
        _client.close()
        _client = None


# ---------------------------------------------------------------------------
# Optional local test runner (run `python app/infra/mongo.py`)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    async def _test():
        ok = await init_mongo()
        if ok:
            db = get_db()
            print(f"Connected DB: {db.name}")
            print("Collections:", await db.list_collection_names())
        await close_mongo_client()

    asyncio.run(_test())
