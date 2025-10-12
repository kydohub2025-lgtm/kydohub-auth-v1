"""
guards/decorators.py

Human-friendly decorator to enforce RBAC on route handlers.

Non-developer summary:
----------------------
Use @requires("students.view", "attendance.mark") on any route to ensure the
caller has those permissions. If not, the API returns a clear 403 error with
details (which permissions were missing).
"""

from __future__ import annotations

from functools import wraps
from typing import Callable, Iterable, Set

from fastapi import Depends

from .auth_chain import AuthContext, auth_chain
from ..core.errors import AppError


def requires(*permissions: str) -> Callable:
    """
    Decorator factory for permission checks.

    Usage:
        @router.get("/students")
        @requires("students.view")
        async def list_students(ctx: AuthContext = Depends(auth_chain)):
            ...

    Behavior:
      - Reads the permission set from ctx.permissions (produced by the guard chain).
      - Ensures EVERY requested permission is present; otherwise 403 PERMISSION_DENIED.
    """
    required: Set[str] = {p.strip() for p in permissions if p and p.strip()}

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, ctx: AuthContext = Depends(auth_chain), **kwargs):
            missing = sorted([p for p in required if p not in ctx.permissions])
            if missing:
                raise AppError(
                    "PERMISSION_DENIED",
                    "You do not have permission to perform this action.",
                    status=403,
                    details={"missing": missing},
                )
            return await func(*args, ctx=ctx, **kwargs)

        return wrapper

    return decorator
