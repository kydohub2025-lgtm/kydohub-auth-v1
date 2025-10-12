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

from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import WriteConcern, ReadPreference
from pymongo.read_concern import ReadConcern

from ..core.config import get_settings


# Global singleton client reused across the process.
_client: Optional[AsyncIOMotorClient] = None


def get_mongo_client() -> AsyncIOMotorClient:
    """
    Lazily create (and then reuse) the AsyncIOMotorClient.

    Why a singleton?
    ----------------
    - In AWS Lambda, warm invocations reuse the same process, so keeping a single
      client dramatically reduces cold-time and connection overhead.
    - Motor/Mongo clients are thread-safe and designed to be reused.
    """
    global _client
    if _client is None:
        s = get_settings()
        _client = AsyncIOMotorClient(
            s.MONGODB_URI,
            serverSelectionTimeoutMS=s.MONGO_CONNECT_TIMEOUT_MS,  # how long to wait for server discovery
            socketTimeoutMS=s.MONGO_SOCKET_TIMEOUT_MS,            # network read/write timeout
            uuidRepresentation="standard",
        )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    """
    Return the application's default database object (e.g., 'kydohub').

    Typical usage (developers):
    ---------------------------
    db = get_db()
    await db.users.find_one({"_id": ...})
    """
    return get_mongo_client()[get_settings().MONGODB_DB]


def get_transaction_opts():
    """
    Standardized transaction/read/write concerns for critical writes.

    Non-developer summary:
    ----------------------
    These knobs tell Mongo to prefer primary for reads, wait for majority write
    acknowledgment, and read only committed data. We will use these for sensitive
    operations (like refresh rotation) later in the implementation.
    """
    return {
        "read_preference": ReadPreference.PRIMARY,
        "write_concern": WriteConcern("majority"),
        "read_concern": ReadConcern("majority"),
    }


async def close_mongo_client() -> None:
    """
    Close the global Mongo client (rarely needed in Lambda; useful in local tests).
    """
    global _client
    if _client is not None:
        _client.close()
        _client = None
