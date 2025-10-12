"""
core/errors.py

Uniform error envelope and exception handlers.

Non-developer summary:
----------------------
No matter where an error happens, the frontend sees the same structure:
{ error: { code, message, details?, requestId } }. This makes handling
and debugging consistent across the app.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def _get_request_id(request: Request) -> Optional[str]:
    # Prefer the value set by our RequestIdMiddleware, fallback to header.
    rid = getattr(request.state, "request_id", None)
    return rid or request.headers.get("X-Request-ID")


def error_envelope(
    *,
    code: str,
    message: str,
    status: int,
    request_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    """
    Build a JSON error response with the uniform envelope.
    """
    body = {
        "error": {
            "code": code,
            "message": message,
            "requestId": request_id,
        }
    }
    if details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


# ---------- AppError (preferred for domain-specific errors) ----------

class AppError(Exception):
    """
    Raise this from your code for well-defined errors, e.g.:

        raise AppError("PERMISSION_DENIED", "You do not have access.", status=403, details={...})
    """
    def __init__(self, code: str, message: str, *, status: int = 400, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


# ---------- Exception handlers plugged in main.py ----------

async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """
    Convert Starlette/FastAPI HTTPException into our envelope.
    """
    # Map common statuses to generic codes; you can extend this map as needed.
    code_map = {
        400: "BAD_REQUEST",
        401: "UNAUTHENTICATED",
        403: "PERMISSION_DENIED",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        415: "UNSUPPORTED_MEDIA_TYPE",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
    }
    code = code_map.get(exc.status_code, "ERROR")
    msg = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return error_envelope(
        code=code,
        message=msg,
        status=exc.status_code,
        request_id=_get_request_id(request),
    )


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """
    Convert our AppError into the envelope as-is.
    """
    return error_envelope(
        code=exc.code,
        message=exc.message,
        status=exc.status,
        request_id=_get_request_id(request),
        details=exc.details,
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """
    Convert FastAPI validation errors (pydantic) into a 422 envelope with field errors.
    """
    details = {"fields": exc.errors()}
    return error_envelope(
        code="VALIDATION_ERROR",
        message="Request validation failed.",
        status=422,
        request_id=_get_request_id(request),
        details=details,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all for anything else. We do not leak internal errors to clients.
    """
    # Optionally log here if you want, but logging is handled by core/logging configuration.
    return error_envelope(
        code="INTERNAL_ERROR",
        message="Unexpected error occurred.",
        status=500,
        request_id=_get_request_id(request),
    )
