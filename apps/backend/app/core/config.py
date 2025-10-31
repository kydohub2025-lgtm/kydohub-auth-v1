"""
core/config.py

Typed settings loader for the KydoHub backend.
Pydantic v2 + pydantic-settings.
Ensures .env.local (or .env) is loaded automatically for local development.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import AnyUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Load environment early (.env.local preferred). We try both backend folder
# and repo root so it works no matter where you run uvicorn from.
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parents[2]          # .../apps/backend
ROOT_DIR = BACKEND_DIR.parents[1]                           # repo root

_env_candidates = [
    BACKEND_DIR / ".env.local",
    ROOT_DIR / ".env.local",
    BACKEND_DIR / ".env",
    ROOT_DIR / ".env",
]

_loaded = False
for _p in _env_candidates:
    if _p.exists():
        load_dotenv(_p, override=True)
        print(f"[config] ✅ Loaded environment from: {_p}")
        _loaded = True
        break

if not _loaded:
    print("[config] ⚠️ No .env.local or .env file found — using system environment only.")

# ---------------------------------------------------------------------------
# Settings Model
# ---------------------------------------------------------------------------
class Settings(BaseSettings):
    # ----- Service -----
    APP_NAME: str = "kydohub-backend"
    APP_STAGE: str = os.getenv("APP_STAGE", "dev")  # dev|staging|prod
    API_BASE_PATH: str = os.getenv("API_BASE_PATH", "/api/v1")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    # ----- Database / Cache -----
    # Store as plain strings so drivers can use them directly (no AnyUrl casting needed).
    MONGODB_URI: str = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    MONGODB_DB: str = os.getenv("MONGODB_DB", "kydohub_dev")
    MONGO_CONNECT_TIMEOUT_MS: int = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "2000"))
    MONGO_SOCKET_TIMEOUT_MS: int = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS", "10000"))

    REDIS_URL: Optional[str] = os.getenv("REDIS_URL") or None  # optional

    # ----- Supabase (IdP) -----
    SUPABASE_URL: AnyUrl = os.getenv("SUPABASE_URL", "https://example.supabase.co")
    SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "dev-only-change-me")

    # ----- JWT (KydoHub RS256) -----
    JWT_PRIVATE_KEY_PEM: str = os.getenv("JWT_PRIVATE_KEY_PEM", "")
    JWT_PUBLIC_KEY_PEM: str = os.getenv("JWT_PUBLIC_KEY_PEM", "")
    JWT_ISS: str = os.getenv("JWT_ISS", "kydohub-api")
    JWT_AUD: str = os.getenv("JWT_AUD", "kydohub-app")
    JWT_ACCESS_TTL_SEC: int = int(os.getenv("JWT_ACCESS_TTL_SEC", "900"))        # 15 min
    JWT_REFRESH_TTL_SEC: int = int(os.getenv("JWT_REFRESH_TTL_SEC", "1209600"))  # 14 days

    # ----- Web security / Cookies -----
    ALLOWED_ORIGINS: str = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost,http://127.0.0.1,http://testserver",
    )
    COOKIE_DOMAIN: str = os.getenv("COOKIE_DOMAIN", ".kydohub.com")
    ACCESS_COOKIE: str = os.getenv("ACCESS_COOKIE", "kydo_sess")
    REFRESH_COOKIE: str = os.getenv("REFRESH_COOKIE", "kydo_refresh")
    CSRF_COOKIE: str = os.getenv("CSRF_COOKIE", "kydo_csrf")
    # Align with design docs (double-submit header name).
    CSRF_HEADER: str = os.getenv("CSRF_HEADER", "X-CSRF-Token")

    ALLOWED_ORIGIN_LIST: List[str] = []

    # ----- Rate limits -----
    RATE_LIMITS_IP: str = os.getenv("RATE_LIMITS_IP", "20/m")
    RATE_LIMITS_TENANT: str = os.getenv("RATE_LIMITS_TENANT", "600/m")

    # ----- Pydantic Settings Config -----
    model_config = SettingsConfigDict(
        env_file=None,  # already loaded manually above
        case_sensitive=False,
        extra="ignore",
    )

    # ----- Validators -----
    @field_validator("ALLOWED_ORIGIN_LIST", mode="before")
    @classmethod
    def build_allowed_origin_list(cls, v, info):
        raw = os.getenv("ALLOWED_ORIGINS", "") or ""
        items = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
        return items

    @field_validator("JWT_PRIVATE_KEY_PEM", "JWT_PUBLIC_KEY_PEM", mode="before")
    @classmethod
    def strip_key_whitespace(cls, v: str) -> str:
        return (v or "").strip()

# ---------------------------------------------------------------------------
# Cached accessor
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so the app constructs Settings only once per process."""
    return Settings()
