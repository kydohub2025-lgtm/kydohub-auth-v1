import time
import pytest
from fastapi.testclient import TestClient

from apps.backend.app.main import create_app
from apps.backend.app.core import config as config_mod
from apps.backend.app.routers import auth_exchange as ex_mod
from apps.backend.app.security import token_service as ts_mod
from apps.backend.app.services import auth_state_cache as cache_mod
from apps.backend.app.repos import refresh_session_repo as rs_repo_mod


# --- Minimal test keys for RS256 issuing (we patch Supabase verify only) ---
TEST_PRIVATE_KEY = """-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBAMsGq2eJ8qzJ7w2x6oQnOa4lYfD7r7C6k6C4g2Yv6RrQ7I1X5xqP
3dQ3O8pD2v9s6lE0jQ2h4Cqz6Qv3w3Fz8cECAwEAAQJAbqK9iYvJ1w7u3r2ZP+qv
0f6Wn1j1fGm4o4i9h6KQe7N2V8v1e8t8b4T3YkJ9x5W2gZx5b9QpV6Jt2lQ8qzq6
AQIhAPWQm6bA9d6i8i1yQf9qfU5kz3o5c1i6Z9YHkA3xg0tFAiEA03m8FQ8a3m+N
Z8nS1xwR8G8L2d4vX8UQvGJXrQ4NYL8CIQDjT3yq3G7JQqzJ6T4m9C6uF3vE8o9G
Vg0Hnq2V9GQ7uQIhAKQX3q3wP8Yp6v8mZL8qG5kU6Y4e3r2Q9p3wz8aVt1PBAiEA
t6m9yq3G6n8pX9yQ7t8b6n3q5r7t2p8mX4n7q8p6r7k=
-----END RSA PRIVATE KEY-----"""
TEST_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAMsGq2eJ8qzJ7w2x6oQnOa4lYfD7r7C6
k6C4g2Yv6RrQ7I1X5xqP3dQ3O8pD2v9s6lE0jQ2h4Cqz6Qv3w3Fz8cECAwEAAQ==
-----END PUBLIC KEY-----"""


class DummySettings:
    APP_NAME = "kydohub-backend"
    APP_STAGE = "dev"
    API_BASE_PATH = "/api/v1"
    LOG_LEVEL = "ERROR"

    # DB/Cache (unused here)
    MONGODB_URI = "mongodb://example"
    MONGODB_DB = "kydohub"
    MONGO_CONNECT_TIMEOUT_MS = 2000
    MONGO_SOCKET_TIMEOUT_MS = 10000
    REDIS_URL = None

    # Supabase
    SUPABASE_URL = "https://xyzcompany.supabase.co"
    SUPABASE_JWT_SECRET = "super-secret-dev"

    # JWT
    JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY
    JWT_PUBLIC_KEY_PEM = TEST_PUBLIC_KEY
    JWT_ISS = "kydohub-api"
    JWT_AUD = "kydohub-app"
    JWT_ACCESS_TTL_SEC = 600
    JWT_REFRESH_TTL_SEC = 3600

    # Web security / Cookies
    ALLOWED_ORIGINS = "http://localhost,http://testserver"
    ALLOWED_ORIGIN_LIST = ["http://localhost", "http://testserver"]
    COOKIE_DOMAIN = "testserver"  # important so TestClient sends cookies back
    ACCESS_COOKIE = "kydo_sess"
    REFRESH_COOKIE = "kydo_refresh"
    CSRF_COOKIE = "kydo_csrf"
    CSRF_HEADER = "X-CSRF"

    # Rate limits (not part of this test)
    RATE_LIMITS_IP = "100/m"
    RATE_LIMITS_TENANT = "1000/m"


@pytest.fixture(autouse=True)
def patch_settings(monkeypatch):
    # Settings everywhere
    monkeypatch.setattr(config_mod, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(ts_mod, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(ex_mod, "get_settings", lambda: DummySettings())
    yield


@pytest.fixture
def app(monkeypatch):
    # Supabase verify → fixed sub
    def fake_verify_supabase(token: str, **kw):
        return {"sub": "u1", "aud": "authenticated", "iss": DummySettings.SUPABASE_URL, "exp": int(time.time()) + 300}
    monkeypatch.setattr(ts_mod, "verify_supabase_token", fake_verify_supabase)

    # EV cache fakes (not exercising EV logic here)
    async def fake_get_ev(tid, uid): return 1
    async def fake_set_ev(tid, uid, value): return None
    monkeypatch.setattr(cache_mod, "get_ev", fake_get_ev)
    monkeypatch.setattr(cache_mod, "set_ev", fake_set_ev)

    # Exchange memberships → exactly one tenant t1
    async def fake_list_active_memberships(user_id: str):
        return [{"tenantId": "t1", "name": "Tenant One", "roles": ["teacher"]}]
    monkeypatch.setattr(ex_mod, "_list_active_memberships", fake_list_active_memberships)

    # RefreshSessionRepo.create → return fixed tokens without touching DB
    created_tokens = {"web": "R_WEB_123", "mobile": "R_MOBILE_123"}
    async def fake_create(self, user_id, tenant_id, ttl_seconds, device=None, refresh_token=None):
        # If refresh_token provided, echo; else choose based on device/client naming
        tok = refresh_token or (created_tokens["web"] if (device or {}).get("name") == "browser" else created_tokens["web"])
        # For mobile flow below we’ll construct manually, so just return web here. We'll patch in the test call.
        return tok, "sess1"
    monkeypatch.setattr(rs_repo_mod.RefreshSessionRepo, "create", fake_create)

    return create_app()


def test_logout_web_csrf_and_cookie_revoke(monkeypatch, app):
    """
    1) /auth/exchange (web) → sets cookies
    2) /auth/logout without CSRF header (but with allowed Origin) → 403 CSRF_FAILED
    3) /auth/logout with correct CSRF + allowed Origin → 204
       - cookies cleared
       - RefreshSessionRepo.revoke_by_token called with cookie refresh
    """
    client = TestClient(app)

    # Track calls to revoke_by_token
    revoked = []
    async def fake_revoke_by_token(self, token: str):
        revoked.append(token)
    monkeypatch.setattr(rs_repo_mod.RefreshSessionRepo, "revoke_by_token", fake_revoke_by_token)

    # Step 1: exchange (web) — simulate a browser (device name drives nothing critical here)
    r = client.post(
        "/api/v1/auth/exchange",
        json={"provider": "supabase", "token": "SUPA", "client": "web", "device": {"name": "browser"}},
        headers={"X-Client": "web"},
    )
    assert r.status_code == 204
    assert "kydo_refresh" in client.cookies
    assert "kydo_csrf" in client.cookies
    refresh_cookie = client.cookies.get("kydo_refresh")
    csrf_cookie = client.cookies.get("kydo_csrf")

    # Step 2: logout without CSRF → 403
    r2 = client.post(
        "/api/v1/auth/logout",
        json={"client": "web"},
        headers={"X-Client": "web", "Origin": "http://testserver"},  # allowed origin, but missing X-CSRF
    )
    assert r2.status_code == 403, r2.text
    body = r2.json()
    assert body["error"]["code"] == "CSRF_FAILED"

    # Step 3: logout with CSRF → 204; cookies cleared and revoke called
    r3 = client.post(
        "/api/v1/auth/logout",
        json={"client": "web"},
        headers={"X-Client": "web", "Origin": "http://testserver", DummySettings.CSRF_HEADER: csrf_cookie},
    )
    assert r3.status_code == 204, r3.text
    # Cookies cleared in client jar
    assert client.cookies.get("kydo_sess") in (None, "")
    assert client.cookies.get("kydo_refresh") in (None, "")
    assert client.cookies.get("kydo_csrf") in (None, "")
    # Revoke called with the cookie value
    assert refresh_cookie in revoked


def test_logout_mobile_with_refresh_revoke(monkeypatch, app):
    """
    1) /auth/exchange (mobile) → JSON { access, refresh }
    2) /auth/logout (mobile) with Authorization + body { refresh } → 204
       - RefreshSessionRepo.revoke_by_token called with provided refresh
    """
    client = TestClient(app)

    # RefreshSessionRepo.create for mobile → return a known token
    async def fake_create_mobile(self, user_id, tenant_id, ttl_seconds, device=None, refresh_token=None):
        return "R_MOBILE_ABC", "sessM"
    monkeypatch.setattr(rs_repo_mod.RefreshSessionRepo, "create", fake_create_mobile)

    revoked = []
    async def fake_revoke_by_token(self, token: str):
        revoked.append(token)
    monkeypatch.setattr(rs_repo_mod.RefreshSessionRepo, "revoke_by_token", fake_revoke_by_token)

    # Step 1: exchange (mobile)
    r = client.post(
        "/api/v1/auth/exchange",
        json={"provider": "supabase", "token": "SUPA", "client": "mobile"},
        headers={"X-Client": "mobile"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    access = data["access"]
    refresh = data["refresh"]
    assert access and refresh == "R_MOBILE_ABC"

    # Step 2: logout with explicit refresh revoke
    r2 = client.post(
        "/api/v1/auth/logout",
        json={"client": "mobile", "refresh": refresh},
        headers={"X-Client": "mobile", "Authorization": f"Bearer {access}"},
    )
    assert r2.status_code == 204, r2.text
    assert refresh in revoked
