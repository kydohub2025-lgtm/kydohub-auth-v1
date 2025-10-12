import re
from fastapi import Response
import pytest

from apps.backend.app.security import cookie_service


class DummySettings:
    COOKIE_DOMAIN = ".kydohub.com"
    ACCESS_COOKIE = "kydo_sess"
    REFRESH_COOKIE = "kydo_refresh"
    CSRF_COOKIE = "kydo_csrf"
    JWT_ACCESS_TTL_SEC = 1200
    JWT_REFRESH_TTL_SEC = 1209600


@pytest.fixture(autouse=True)
def patch_settings(monkeypatch):
    # Make cookie_service.get_settings() return DummySettings for all tests
    monkeypatch.setattr(cookie_service, "get_settings", lambda: DummySettings())


def _cookies(resp: Response):
    # Starlette exposes multiple Set-Cookie headers via getlist
    return resp.headers.getlist("set-cookie")


def test_set_access_cookie_attributes():
    resp = Response()
    cookie_service.set_access_cookie(resp, token="access.jwt")
    setcookies = _cookies(resp)
    assert len(setcookies) == 1
    c = setcookies[0].lower()
    assert "kydo_sess=access.jwt" in c
    assert "domain=.kydohub.com" in c
    assert "path=/" in c
    assert "httponly" in c
    assert "secure" in c
    assert "samesite=lax" in c


def test_set_refresh_cookie_attributes_scoped_path():
    resp = Response()
    cookie_service.set_refresh_cookie(resp, token="refresh-secret")
    setcookies = _cookies(resp)
    assert len(setcookies) == 1
    c = setcookies[0].lower()
    assert "kydo_refresh=refresh-secret" in c
    assert "domain=.kydohub.com" in c
    assert "path=/auth/refresh" in c  # IMPORTANT: path scoped
    assert "httponly" in c
    assert "secure" in c
    assert "samesite=lax" in c


def test_set_csrf_cookie_is_readable_not_httponly():
    resp = Response()
    token = cookie_service.set_csrf_cookie(resp, csrf_token="csrf123")
    assert token == "csrf123"
    setcookies = _cookies(resp)
    assert len(setcookies) == 1
    c = setcookies[0].lower()
    assert "kydo_csrf=csrf123" in c
    assert "domain=.kydohub.com" in c
    assert "path=/" in c
    assert "httponly" not in c  # FE must read it
    assert "secure" in c
    assert "samesite=lax" in c


def test_apply_and_clear_web_cookies_triple():
    # Apply all three, then clear them
    resp = Response()
    cookie_service.apply_web_login_cookies(resp, access_token="a", refresh_token="r", csrf_token="c")
    setcookies = _cookies(resp)
    # Three cookies set in any order
    names = "".join(setcookies).lower()
    for name in ("kydo_sess=a", "kydo_refresh=r", "kydo_csrf=c"):
        assert name in names

    # Now clear
    resp2 = Response()
    cookie_service.clear_web_cookies(resp2)
    dels = _cookies(resp2)
    # Three delete-cookie headers with correct paths
    allhdr = "\n".join(dels).lower()
    assert "kydo_sess=" in allhdr and "path=/" in allhdr
    assert "kydo_refresh=" in allhdr and "path=/auth/refresh" in allhdr
    assert "kydo_csrf=" in allhdr and "path=/" in allhdr
