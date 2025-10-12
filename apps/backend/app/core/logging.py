"""
core/logging.py

JSON logging setup with request ID propagation.

Non-developer summary:
----------------------
This makes logs machine-readable and easy to filter. Each line includes a
requestId so you can trace one request across all components.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# Context variable set by RequestIdMiddleware
request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)


class JsonFormatter(logging.Formatter):
    """
    Minimal JSON log formatter that adds common fields and pulls requestId
    from the context variable set by the middleware.
    """

    def __init__(self, service: str, stage: str):
        super().__init__()
        self.service = service
        self.stage = stage

    def format(self, record: logging.LogRecord) -> str:
        # Base envelope
        payload: Dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "service": self.service,
            "stage": self.stage,
        }

        # Attach requestId if present
        rid = request_id_var.get()
        if rid:
            payload["requestId"] = rid

        # Include extras (safe subset)
        for key in ("tenantId", "userId", "operationId"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)

        # If an exception is present, add short info (stack handling left to handlers)
        if record.exc_info:
            payload["exc"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
            }

        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def _setup_handler(level: int, formatter: logging.Formatter) -> logging.Handler:
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(formatter)
    return handler


def configure_logging(level_str: str = "INFO") -> None:
    """
    Configure root, uvicorn, and FastAPI loggers to use JSON.

    Call this once at startup (main.py does this already).
    """
    level = getattr(logging, (level_str or "INFO").upper(), logging.INFO)

    # Import here to avoid circulars
    from .config import get_settings
    s = get_settings()

    formatter = JsonFormatter(service=s.APP_NAME, stage=s.APP_STAGE)
    handler = _setup_handler(level, formatter)

    # Root logger
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    root.setLevel(level)
    root.addHandler(handler)
    root.propagate = False

    # Align uvicorn/access loggers
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        lg = logging.getLogger(name)
        for h in list(lg.handlers):
            lg.removeHandler(h)
        lg.setLevel(level)
        lg.addHandler(handler)
        lg.propagate = False

    # Our app namespace gets the same handler/level
    app_logger = logging.getLogger("apps.backend")
    app_logger.setLevel(level)
    if not app_logger.handlers:
        app_logger.addHandler(handler)
    app_logger.propagate = False
