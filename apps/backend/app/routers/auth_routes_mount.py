"""
routers/auth_routes_mount.py

Single hub for mounting all auth & context routes under the API base path.

Non-developer summary:
----------------------
We keep one function (`register_routes(app)`) that attaches the /auth/* endpoints
and /me/context under the versioned prefix (e.g., /api/v1). This keeps wiring
clean and makes it easy to change the base path later if needed.
"""

from __future__ import annotations

from fastapi import FastAPI

from ..core.config import get_settings

# Import the actual routers we previously implemented
from . import auth_exchange
from . import auth_refresh
from . import auth_logout
from . import auth_switch
from . import me_context


def register_routes(app: FastAPI) -> None:
    """
    Attach all auth & context routers under the API base path.

    Keeps health endpoints out of this (they live at root for infra compatibility).
    """
    base = get_settings().API_BASE_PATH.rstrip("/")
    app.include_router(auth_exchange.router, prefix=base)
    app.include_router(auth_refresh.router, prefix=base)
    app.include_router(auth_logout.router, prefix=base)
    app.include_router(auth_switch.router, prefix=base)
    app.include_router(me_context.router, prefix=base)
