"""
routers/health.py

Health and readiness endpoints for deploys and runtime monitoring.

Non-developer summary:
----------------------
- /healthz   → "Is the process up?" (simple yes/no)
- /readyz    → "Are core dependencies ready?" (Mongo required; Redis optional)
This helps your deployment pipeline and SREs decide whether to route traffic to this instance.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

# These modules will be created in the next steps.
# They provide connection clients that are reused across requests (Lambda warm).
from ..infra.mongo import get_mongo_client
from ..infra.redis import get_redis


router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz():
    """
    Liveness probe.
    Returns 200 if the app process is running and able to respond to HTTP requests.
    No external dependencies are checked here.
    """
    return JSONResponse({"status": "ok"})


@router.get("/readyz")
async def readyz():
    """
    Readiness probe.
    - Checks MongoDB by issuing an admin 'ping' command.
    - If a Redis URL is configured, pings Redis as well.
    - Returns 200 if Mongo is reachable; otherwise returns 503 (degraded).
    The response always includes a 'dependencies' object for quick triage.
    """
    deps = {"mongo": False, "redis": None}

    # --- Mongo check (required) ---
    try:
        # Motor client exposes the synchronous admin.command in async style via await
        await get_mongo_client().admin.command("ping")
        deps["mongo"] = True
    except Exception:
        deps["mongo"] = False

    # --- Redis check (optional) ---
    r = get_redis()
    if r is None:
        deps["redis"] = None  # intentionally disabled (no REDIS_URL configured)
    else:
        try:
            await r.ping()
            deps["redis"] = True
        except Exception:
            deps["redis"] = False

    # If Mongo is down, we consider the service not ready (degraded)
    status_text = "ok" if deps["mongo"] else "degraded"
    status_code = 200 if deps["mongo"] else 503

    return JSONResponse({"status": status_text, "dependencies": deps}, status_code=status_code)
