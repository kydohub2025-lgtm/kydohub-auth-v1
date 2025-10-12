"""
core/config.py

Typed settings loader for the KydoHub backend.

Non-developer summary:
----------------------
This reads environment variables (like database URLs and cookie names), validates
them, sets sensible defaults for dev, and exposes them to the rest of the app via
get_settings(). That way, every module uses the same configuration.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import List, Optional

from pydantic import BaseSettings, AnyUrl, validator


class Settings(BaseSettings):
    # ----- Service -----
    APP_NAME: str = "kydohub-backend"
    APP_STAGE: str = os.getenv("APP_STAGE", "dev")  # dev|staging|prod
    API_BASE_PATH: str = os.getenv("API_BASE_PATH", "/api/v1")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    # ----- Database / Cache -----
    MONGODB_URI: AnyUrl = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    MONGODB_DB: str = os.getenv("MONGODB_DB", "kydohub")
    MONGO_CONNECT_TIMEOUT_MS: int = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "2000"))
    MONGO_SOCKET_TIMEOUT_MS: int = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS", "10000"))

    REDIS_URL: Optional[AnyUrl] = os.getenv("REDIS_URL") or None  # optional

    # ----- Supabase (IdP) -----
    SUPABASE_URL: AnyUrl = os.getenv("SUPABASE_URL", "https://example.supabase.co")
    SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "dev-only-change-me")

    # ----- JWT (KydoHub RS256) -----
    JWT_PRIVATE_KEY_PEM: str = os.getenv("JWT_PRIVATE_KEY_PEM", "")
    JWT_PUBLIC_KEY_PEM: str = os.getenv("JWT_PUBLIC_KEY_PEM", "")
    JWT_ISS: str = os.getenv("JWT_ISS", "kydohub-api")
    JWT_AUD: str = os.getenv("JWT_AUD", "kydohub-app")
    JWT_ACCESS_TTL_SEC: int = int(os.getenv("JWT_ACCESS_TTL_SEC", "900"))       # 15 min
    JWT_REFRESH_TTL_SEC: int = int(os.getenv("JWT_REFRESH_TTL_SEC", "1209600"))  # 14 days

    # ----- Web security / Cookies -----
    # Comma-separated list of allowed browser origins (no trailing slashes)
    ALLOWED_ORIGINS: str = os.getenv("ALLOWED_ORIGINS", "http://localhost,http://127.0.0.1,http://testserver")
    COOKIE_DOMAIN: str = os.getenv("COOKIE_DOMAIN", ".kydohub.com")  # e.g., ".kydohub.com" or "testserver"
    ACCESS_COOKIE: str = os.getenv("ACCESS_COOKIE", "kydo_sess")
    REFRESH_COOKIE: str = os.getenv("REFRESH_COOKIE", "kydo_refresh")
    CSRF_COOKIE: str = os.getenv("CSRF_COOKIE", "kydo_csrf")
    CSRF_HEADER: str = os.getenv("CSRF_HEADER", "X-CSRF")

    # Derived: parsed list of origins
    ALLOWED_ORIGIN_LIST: List[str] = []

    # ----- Rate limits (applied to /auth/*) -----
    # Simple "count/window" syntax, e.g., "20/m", "600/m". See middleware/rate_limit.py
    RATE_LIMITS_IP: str = os.getenv("RATE_LIMITS_IP", "20/m")
    RATE_LIMITS_TENANT: str = os.getenv("RATE_LIMITS_TENANT", "600/m")

    @validator("ALLOWED_ORIGIN_LIST", pre=True, always=True)
    def build_allowed_origin_list(cls, v, values) -> List[str]:
        raw = values.get("ALLOWED_ORIGINS") or ""
        items = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
        return items

    @validator("JWT_PRIVATE_KEY_PEM", "JWT_PUBLIC_KEY_PEM", pre=True, always=True)
    def strip_key_whitespace(cls, v: str) -> str:
        # Avoid leading/trailing whitespace that can sneak in via env files.
        return (v or "").strip()

    class Config:
        env_file = ".env.local"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Cached accessor so the app constructs Settings only once per process.
    """
    return Settings()
