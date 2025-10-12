import hashlib
import json
import time
import pytest
from fastapi.testclient import TestClient

from apps.backend.app.main import create_app
from apps.backend.app.core import config as config_mod
from apps.backend.app.routers import auth_exchange as ex_mod
from apps.backend.app.routers import auth_refresh as rf_mod
from apps.backend.app.routers import me_context as me_mod
from apps.backend.app.security import token_service as ts_mod
from apps.backend.app.services import auth_state_cache as cache_mod
from apps.backend.app.services import jti_blocklist as jti_mod
from apps.backend.app.repos import membership_repo as mem_mod
from apps.backend.app.repos import role_repo as role_mod


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

    MONGODB_URI = "mongodb://example"
    MONGODB_DB = "kydohub"
    MONGO_CONNECT_TIMEOUT_MS = 2000
    MONGO_SOCKET_TIMEOUT_MS = 10000
    REDIS_URL = None

    SUPABASE_URL = "https://xyzcompany.supabase.co"
    SUPABASE_JWT_SECRET = "super-secret-dev"

    JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY
    JWT_PUBLIC_KEY_PEM = TEST_PUBLIC_KEY
    JWT_ISS = "kydohub-api"
    JWT_AUD = "kydohub-app"
    JWT_ACCESS_TTL_SEC = 600
    JWT_REFRESH_TTL_SEC = 3600

    ALLOWED_ORIGINS = "http://localhost,http://testserver"
    COOKIE_DOMAIN = "testserver"
    ACCESS_COOKIE = "kydo_sess"
    REFRESH_COOKIE = "kydo_refresh"
    CSRF_COOKIE = "kydo_csrf"
    CSRF_HEADER = "X-CSRF"
    ALLOWED_ORIGIN_LIST = ["http://localhost", "http://testserver"]


@pytest.fixture(autouse=True)
def patch_settings(monkeypatch):
    monkeypatch.setattr(config_mod, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(ts_mod, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(ex_mod, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(rf_mod, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(me_mod, "get_settings", lambda: DummySettings())
    yield


@pytest.fixture
def app(monkeypatch):
    # In-memory EV and refresh stores
    ev_store = {}
    refresh_store = {}

    async def fake_get_ev(tid, uid): return ev_store.get((tid, uid))
    async def fake_set_ev(tid, uid, value): ev_store[(tid, uid)] = int(value)

    monkeypatch.setattr(cache_mod, "get_ev", fake_get_ev)
    monkeypatch.setattr(cache_mod, "set_ev", fake_set_ev)

    async def fake_get_permset(tid, uid): return None
    async def fake_set_permset(tid, uid, perms, ttl_sec=900): return None

    monkeypatch.setattr(cache_mod, "get_permset", fake_get_permset)
    monkeypatch.setattr(cache_mod, "set_permset", fake_set_permset)

    class FakeMembership:
        status = "active"
        roles = ["teacher"]
        attrs = {"guardianOf": ["s1"]}

    async def fake_mem_get(self, tid, uid):
        if tid == "t1" and uid == "u1":
            return FakeMembership()
        return None

    monkeypatch.setattr(mem_mod.MembershipRepo, "get", fake_mem_get)

    async def fake_permset_for_roles(self, tid, names):
        return {"students.view", "attendance.mark"}

    monkeypatch.setattr(role_mod.RoleRepo, "get_permset_for_roles", fake_permset_for_roles)

    def fake_verify_supabase(token: str, **kw):
        return {"sub": "u1", "aud": "authenticated", "iss": "https://xyzcompany.supabase.co", "exp": int(time.time()) + 300}

    monkeypatch.setattr(ts_mod, "verify_supabase_token", fake_verify_supabase)

    async def fake_list_active_memberships(user_id: str):
        return [{"tenantId": "t1", "name": "Tenant One", "roles": ["teacher"]}]

    monkeypatch.setattr(ex_mod, "_list_active_memberships", fake_list_active_memberships)

    def _hash_refresh(tok: str) -> str:
        return hashlib.sha256(tok.encode("utf-8")).hexdigest()

    async def fake_persist_session(user_id, tenant_id, refresh_token, ttl_sec, device):
        refresh_store[_hash_refresh(refresh_token)] = {
            "userId": user_id,
            "tenantId": tenant_id,
            "status": "active",
            "expiresAt": int(time.time()) + ttl_sec,
        }
        return "sess1"

    monkeypatch.setattr(ex_mod, "_persist_refresh_session", fake_persist_session)

    async def fake_find_active_refresh(token_hash: str):
        doc = refresh_store.get(token_hash)
        if not doc:
            return None
        if doc["expiresAt"] <= int(time.time()) or doc["status"] != "active":
            return None
        return {"userId": doc["userId"], "tenantId": doc["tenantId"], "expiresAt": doc["expiresAt"]}

    monkeypatch.setattr(rf_mod, "_find_active_refresh_session", fake_find_active_refresh)

    async def fake_rotate_refresh_session(user_id, tenant_id, old_hash, ttl_sec):
        if old_hash in refresh_store:
            refresh_store[old_hash]["status"] = "rotated"
        new_token = "RNEW_MOBILE"
        refresh_store[_hash_refresh(new_token)] = {
            "userId": user_id,
            "tenantId": tenant_id,
            "status": "active",
            "expiresAt": int(time.time()) + ttl_sec,
        }
        return new_token

    monkeypatch.setattr(rf_mod, "_rotate_refresh_session", fake_rotate_refresh_session)

    async def fake_block(jti: str, ttl_sec: int): return None
    monkeypatch.setattr(jti_mod, "block", fake_block)

    # Minimal UI resources for context
    async def fake_ui_res(tid: str):
        return {"pages": ["dashboard"], "actions": ["students.view"]}

    monkeypatch.setattr(me_mod, "_load_ui_resources", fake_ui_res)

    return create_app()


def test_mobile_flow_exchange_context_refresh_logout(app):
    client = TestClient(app)

    # 1) /auth/exchange (mobile) → 200 JSON with access/refresh
    r = client.post(
        "/api/v1/auth/exchange",
        json={"provider": "supabase", "token": "SUPA", "client": "mobile"},
        headers={"X-Client": "mobile"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    access = body["access"]
    refresh = body["refresh"]
    assert body["tenant"]["tenantId"] == "t1"
    assert access and refresh

    # 2) /me/context using Bearer access
    r2 = client.get("/api/v1/me/context", headers={"Authorization": f"Bearer {access}"})
    assert r2.status_code == 200, r2.text
    ctx = r2.json()
    assert "students.view" in ctx["permissions"]
    assert ctx["abac"]["guardianOf"] == ["s1"]

    # 3) /auth/refresh (mobile JSON) → 200 JSON new pair
    r3 = client.post(
        "/api/v1/auth/refresh",
        json={"client": "mobile", "refresh": refresh},
        headers={"X-Client": "mobile"},
    )
    assert r3.status_code == 200, r3.text
    new_pair = r3.json()
    assert new_pair["access"] and new_pair["refresh"]

    # 4) /auth/logout with Bearer access → 204 (client should drop tokens)
    r4 = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {access}", "X-Client": "mobile"})
    assert r4.status_code == 204
