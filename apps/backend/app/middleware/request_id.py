"""
middleware/request_id.py

Guarantees an X-Request-ID for every request, makes it available in:
  - request.state.request_id (for handlers)
  - logging context (JSON logs include it)

Also sets 'Cache-Control: no-store' on responses to prevent caching of
sensitive auth responses by intermediaries.

Non-developer summary:
----------------------
This adds a unique id to each request so we can trace it across services
and logs. If the frontend provides one, we keep it; otherwise we create one.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from ..core.logging import request_id_var


class RequestIdMiddleware(BaseHTTPMiddleware):
    """
    - Accept or generate a request id.
    - Store it in request.state and logging context.
    - Echo it back in the response header.
    - Mark responses as non-cacheable (defense-in-depth for auth flows).
    """

    header_name: str = "X-Request-ID"

    async def dispatch(self, request: Request, call_next):
        incoming: Optional[str] = request.headers.get(self.header_name)
        rid = incoming.strip() if incoming else str(uuid.uuid4())

        # Expose to handlers and logging
        request.state.request_id = rid
        token = request_id_var.set(rid)
        try:
            response: Response = await call_next(request)
        finally:
            # Restore previous context to avoid leaking the id across requests
            request_id_var.reset(token)

        # Echo request id + disable caching
        response.headers[self.header_name] = rid
        # Avoid storing sensitive responses in caches/intermediaries
        if "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        return response
