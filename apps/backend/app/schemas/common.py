"""
schemas/common.py

Shared DTOs used across endpoints (error envelope, simple helpers).

Non-developer summary:
----------------------
This describes the common JSON shapes we return, like the {error:{...}} object.
Having a typed model helps keep responses consistent and testable.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str = Field(..., description="Stable error code (e.g., PERMISSION_DENIED)")
    message: str = Field(..., description="Human-readable message (safe for UI)")
    requestId: Optional[str] = Field(None, description="Echoed request correlation id")
    details: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional structured context (e.g., which permissions were missing)",
    )


class ErrorEnvelope(BaseModel):
    error: ErrorBody

    class Config:
        extra = "ignore"
        allow_population_by_field_name = True
        orm_mode = True


# Optional helper if you want to type success wrappers later
class OkMessage(BaseModel):
    ok: bool = Field(True, description="Whether the operation succeeded")
    message: Optional[str] = Field(None, description="Optional success note")
