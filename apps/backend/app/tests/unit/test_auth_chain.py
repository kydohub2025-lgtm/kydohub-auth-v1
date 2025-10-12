import time
import jwt
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from apps.backend.app.guards import auth_chain as auth_chain_mod


@pytest.fixture
def app(monkeypatch):
    """
    Build a tiny FastAPI app with a single protected route that depends on auth_chain.
    All external calls (JWT verify, cache, repos) are monkeypatched.
    """
    # --- Common fakes/state ---
    NOW = int(time.time())

    # 1) Token verification: return claims based on token string
    def fake_verify_access_token(token: str):
        if token == "good":
            return {"sub": "u1", "tid": "t1", "ev": 1, "jti": "j1", "iat": NOW - 10, "exp": NOW + 600, "aud": "kydohub-app", "iss": "kydohub-api"}
        if token == "blocked":
            return {"sub": "u1", "tid": "t1", "ev": 1, "jti": "jBLOCK", "iat": NOW - 10, "exp": NOW + 600, "aud": "kydohub-app", "iss": "kydohub-api"}
        if token == "stale":
            return {"sub": "u1", "tid": "t1", "ev": 1, "jti": "j2", "iat": NOW - 10, "exp": NOW + 600, "aud": "kydohub-app", "iss": "kydohub-api"}
        if token == "nomember":
            return {"sub": "uX", "tid": "t1", "ev": 1, "jti": "j3", "iat": NOW - 10, "exp": NOW + 600, "aud": "kydohub-app", "iss": "kydohub-api"}
        raise jwt.InvalidTokenError("bad token")

    monkeypatch.setattr(auth_chain_mod, "verify_access_token", fake_verify_access_token)

    # 2) JTI blocklist: only "jBLOCK" is blocked
    async def fake_is_blocked(jti: str) -> bool:
        return jti == "jBLOCK"

    monkeypatch.setattr(auth_chain_mod, "jti_is_blocked", fake_is_blocked)

    # 3) EV cache: return 2 (newer) when testing "stale", else 1
    async def fake_get_ev(tid: str, uid: str):
        if uid == "u1":
            return 2 if tid == "t1" else 1
        return 1

    monkeypatch.setattr(auth_chain_mod.cache, "get_ev", fake_get_ev)

    # 4) Membership repo: active for u1/t1 only
    class FakeMembership:
        status = "active"
        roles = ["teacher"]
        attrs = {"rooms": ["r1"]}

    async def fake_get_membership(tid: str, uid: str):
        if tid == "t1" and uid == "u1":
            return FakeMembership()
        return None  # no membership

    monkeypatch.setattr(auth_chain_mod.MembershipRepo, "get", lambda self, tid, uid: fake_get_membership(tid, uid))

    # 5) Role repo: teacher → students.view
    async def fake_permset_for_roles(tid, names):
        return {"students.view"} if "teacher" in names else set()

    monkeypatch.setattr(auth_chain_mod.RoleRepo, "get_permset_for_roles", lambda self, tid, names: fake_permset_for_roles(tid, names))

    # 6) Permset cache: bypass to force repo path
    async def fake_get_permset(tid, uid):
        return None

    async def fake_set_permset(tid, uid, perms):
        return None

    monkeypatch.setattr(auth_chain_mod.cache, "get_permset", fake_get_permset)
    monkeypatch.setattr(auth_chain_mod.cache, "set_permset", fake_set_permset)

    # --- Build app with protected route ---
    app = FastAPI()

    @app.get("/protected")
    async def protected(ctx: auth_chain_mod.AuthContext = Depends(auth_chain_mod.auth_chain)):
        return {
            "user": ctx.user_id,
            "tenant": ctx.tenant_id,
            "perms": sorted(ctx.permissions),
            "abac": ctx.abac,
        }

    return app


def _client(app: FastAPI) -> TestClient:
    return TestClient(app)


def test_auth_chain_success(app):
    client = _client(app)
    r = client.get("/protected", headers={"Authorization": "Bearer good"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"] == "u1"
    assert body["tenant"] == "t1"
    assert "students.view" in body["perms"]
    assert body["abac"]["rooms"] == ["r1"]


def test_auth_chain_jti_blocked(app):
    client = _client(app)
    r = client.get("/protected", headers={"Authorization": "Bearer blocked"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_auth_chain_ev_outdated(app):
    client = _client(app)
    r = client.get("/protected", headers={"Authorization": "Bearer stale"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "EV_OUTDATED"


def test_auth_chain_missing_membership(app):
    client = _client(app)
    r = client.get("/protected", headers={"Authorization": "Bearer nomember"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "PERMISSION_DENIED"
