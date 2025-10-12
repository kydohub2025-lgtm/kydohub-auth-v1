import time
import pytest
from fastapi.testclient import TestClient

from apps.backend.app.main import create_app
from apps.backend.app.core import config as config_mod
from apps.backend.app.routers import auth_exchange as ex_mod
from apps.backend.app.security import token_service as ts_mod
from apps.backend.app.services import auth_state_cache as cache_mod


class DummySettings:
    APP_NAME = "kydohub-backend"
    APP_STAGE = "dev"
    API_BASE_PATH = "/api/v1"
    LOG_LEVEL = "ERROR"

    # DB/Cache (not used directly here)
    MONGODB_URI = "mongodb://example"
    MONGODB_DB = "kydohub"
    MONGO_CONNECT_TIMEOUT_MS = 2000
    MONGO_SOCKET_TIMEOUT_MS = 10000
    REDIS_URL = None

    # Supabase
    SUPABASE_URL = "https://xyzcompany.supabase.co"
    SUPABASE_JWT_SECRET = "super-secret-dev"

    # JWT (dummy values; token_service is patched for Supabase only here)
    JWT_PRIVATE_KEY_PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBALXc\n-----END RSA PRIVATE KEY-----"
    JWT_PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAA==\n-----END PUBLIC KEY-----"
    JWT_ISS = "kydohub-api"
    JWT_AUD = "kydohub-app"
    JWT_ACCESS_TTL_SEC = 600
    JWT_REFRESH_TTL_SEC = 3600

    # Web security / Cookies
    ALLOWED_ORIGINS = "http://localhost,http://testserver"
    ALLOWED_ORIGIN_LIST = ["http://localhost", "http://testserver"]
    COOKIE_DOMAIN = "testserver"  # so TestClient echoes cookies
    ACCESS_COOKIE = "kydo_sess"
    REFRESH_COOKIE = "kydo_refresh"
    CSRF_COOKIE = "kydo_csrf"
    CSRF_HEADER = "X-CSRF"

    # Rate limits (not exercised here)
    RATE_LIMITS_IP = "100/m"
    RATE_LIMITS_TENANT = "1000/m"


@pytest.fixture(autouse=True)
def patch_settings(monkeypatch):
    # Make all get_settings() return DummySettings where referenced
    monkeypatch.setattr(config_mod, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(ex_mod, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(ts_mod, "get_settings", lambda: DummySettings())
    yield


@pytest.fixture
def app(monkeypatch):
    """
    Full app with minimal fakes for Supabase verify and EV cache.
    We don't hit MongoDB in these tests.
    """
    # Supabase verify → a fixed subject
    def fake_verify_supabase(token: str, **kw):
        return {"sub": "u1", "aud": "authenticated", "iss": DummySettings.SUPABASE_URL, "exp": int(time.time()) + 300}

    monkeypatch.setattr(ts_mod, "verify_supabase_token", fake_verify_supabase)

    # EV cache fakes
    async def fake_get_ev(tid, uid): return 1
    async def fake_set_ev(tid, uid, value): return None

    monkeypatch.setattr(cache_mod, "get_ev", fake_get_ev)
    monkeypatch.setattr(cache_mod, "set_ev", fake_set_ev)

    # Exchange membership lookup → exactly one tenant (t1)
    async def fake_list_active_memberships(user_id: str):
        return [{"tenantId": "t1", "name": "Tenant One", "roles": ["teacher"]}]
    monkeypatch.setattr(ex_mod, "_list_active_memberships", fake_list_active_memberships)

    return create_app()


def test_cors_preflight_allowed_origin(app):
    """
    OPTIONS preflight from an allowed origin should be accepted and echo CORS headers.
    """
    client = TestClient(app)
    r = client.options(
        "/api/v1/auth/exchange",
        headers={
            "Origin": "http://testserver",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf",
        },
    )
    # With strict CORS, allowed origins should return 200 and include CORS headers
    assert r.status_code in (200, 204)
    # Starlette CORS typically echoes ACAO and ACAC for credentialed requests
    assert r.headers.get("Access-Control-Allow-Origin") == "http://testserver"
    assert r.headers.get("Access-Control-Allow-Credentials") in ("true", "True")


def test_cors_preflight_disallowed_origin(app, monkeypatch):
    """
    OPTIONS preflight from a disallowed origin should be rejected (403) or missing CORS headers.
    """
    client = TestClient(app)
    r = client.options(
        "/api/v1/auth/exchange",
        headers={
            "Origin": "http://malicious.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    # Our strict CORS middleware should not allow this origin.
    # Some implementations return 403; others 200 w/o ACAO. Assert it's NOT allowed.
    not_allowed = r.headers.get("Access-Control-Allow-Origin") != "http://malicious.example"
    assert r.status_code in (200, 204, 403)
    assert not_allowed


def test_csrf_missing_header_is_rejected(app):
    """
    Web refresh without X-CSRF (or mismatched) should return 403 CSRF_FAILED.
    We first perform /auth/exchange (web) to set refresh+csrf cookies, then call /auth/refresh without header.
    """
    client = TestClient(app)

    # Step 1: Create web session (sets kydo_refresh + kydo_csrf)
    r = client.post(
        "/api/v1/auth/exchange",
        json={"provider": "supabase", "token": "SUPA", "client": "web"},
        headers={"X-Client": "web"},
    )
    assert r.status_code == 204
    assert "kydo_refresh" in client.cookies
    assert "kydo_csrf" in client.cookies

    # Step 2: Call refresh WITHOUT X-CSRF header (should fail CSRF)
    r2 = client.post(
        "/api/v1/auth/refresh",
        json={},
        headers={
            "X-Client": "web",
            "Origin": "http://testserver",  # allowed origin
            # Intentionally omit X-CSRF header
        },
    )
    assert r2.status_code == 403, r2.text
    body = r2.json()
    assert body["error"]["code"] == "CSRF_FAILED"


def test_csrf_bad_origin_is_rejected_even_with_matching_token(app):
    """
    If Origin is not allow-listed, request must be rejected with ORIGIN_MISMATCH even if CSRF token matches.
    """
    client = TestClient(app)

    # Create web session to set cookies
    r = client.post(
        "/api/v1/auth/exchange",
        json={"provider": "supabase", "token": "SUPA", "client": "web"},
        headers={"X-Client": "web"},
    )
    assert r.status_code == 204
    csrf = client.cookies.get("kydo_csrf")
    assert csrf

    # Attempt refresh with correct X-CSRF but from a BAD origin
    r2 = client.post(
        "/api/v1/auth/refresh",
        json={},
        headers={
            "X-Client": "web",
            "Origin": "http://malicious.example",  # not in allow-list
            "X-CSRF": csrf,                        # matches cookie but origin is bad
        },
    )
    assert r2.status_code == 403, r2.text
    body = r2.json()
    assert body["error"]["code"] == "ORIGIN_MISMATCH"
