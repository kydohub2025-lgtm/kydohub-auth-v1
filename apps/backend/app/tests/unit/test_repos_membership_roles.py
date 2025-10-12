import asyncio
import pytest

from apps.backend.app.repos.membership_repo import MembershipRepo, MembershipModel
from apps.backend.app.repos.role_repo import RoleRepo
from apps.backend.app.infra import mongo as mongo_mod


# -------- In-memory fake Mongo collections with async interface --------

class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration

    # Compatibility with .find(..., limit=)
    def limit(self, n):
        return FakeCursor(self._docs[:n])


class FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    async def find_one(self, query, projection=None):
        for d in self._docs:
            match = all(d.get(k) == v for k, v in query.items())
            if match:
                # apply simple projection include
                if projection:
                    proj = {k: d.get(k) for k, v in projection.items() if v and k in d}
                    return proj
                return d
        return None

    def find(self, query, projection=None, limit=0):
        filtered = []
        for d in self._docs:
            ok = True
            for k, cond in query.items():
                if isinstance(cond, dict) and "$in" in cond:
                    if d.get(k) not in set(cond["$in"]):
                        ok = False; break
                else:
                    if d.get(k) != cond:
                        ok = False; break
            if ok:
                if projection:
                    filtered.append({k: d.get(k) for k, v in projection.items() if v and k in d})
                else:
                    filtered.append(d)
        if limit and limit > 0:
            filtered = filtered[:limit]
        return FakeCursor(filtered)


class FakeDB:
    def __init__(self, data_by_collection):
        self._data = data_by_collection

    def __getitem__(self, name):
        return FakeCollection(self._data.get(name, []))


@pytest.fixture
def patch_db(monkeypatch):
    """
    Provide a fake DB with 'memberships' and 'roles' collections.
    """
    data = {
        "memberships": [
            {"tenantId": "t1", "userId": "u1", "status": "active", "roles": ["teacher"], "attrs": {"rooms": ["r1", "r2"]}},
            {"tenantId": "t1", "userId": "u2", "status": "suspended", "roles": ["teacher"], "attrs": {}},
        ],
        "roles": [
            {"tenantId": "t1", "name": "teacher", "permissions": ["students.view", "attendance.mark"]},
            {"tenantId": "t1", "name": "assistant", "permissions": ["students.view"]},
        ],
    }
    fake_db = FakeDB(data)
    monkeypatch.setattr(mongo_mod, "get_db", lambda: fake_db)
    yield


@pytest.mark.asyncio
async def test_membership_repo_get_active(patch_db):
    repo = MembershipRepo()
    m = await repo.get("t1", "u1")
    assert isinstance(m, MembershipModel)
    assert m.status == "active"
    assert m.roles == ["teacher"]
    assert m.attrs["rooms"] == ["r1", "r2"]


@pytest.mark.asyncio
async def test_membership_repo_get_none_for_missing(patch_db):
    repo = MembershipRepo()
    m = await repo.get("t1", "uX")
    assert m is None


@pytest.mark.asyncio
async def test_role_repo_permset_flatten(patch_db):
    repo = RoleRepo()
    perms = await repo.get_permset_for_roles("t1", ["teacher", "assistant"])
    assert "students.view" in perms
    assert "attendance.mark" in perms
    # dedupe check: calling again should return a set with no duplicates
    perms2 = await repo.get_permset_for_roles("t1", ["assistant", "teacher"])
    assert perms == perms2
