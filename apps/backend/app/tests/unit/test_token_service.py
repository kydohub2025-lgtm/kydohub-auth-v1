import time
import types
import jwt
import pytest

from apps.backend.app.security import token_service


# --- Test RSA keys (static, dev-safe) ---
TEST_PRIVATE_KEY = """-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAtHkM1kOkU8zM+1o1kF2ZqN+3r8lA5X9z0v8wQj3n2Yx8Zr5T
Y3xW2s0W8M7i9o0iA3Q7GqZqP4Jt3s4x0V4xr3R5J8yq7dA7Bx2n6m3+f6gq0/8G
o2q1qQhYV/UQm0JQy1oK5t2H9q0mKk4j6LQxX3wQk3e8y2B9r7m8b3Xo8E6aQ3y/
m2uWjY3NQeQe6K7WcM8bqJ2e2o4rYzY0hK7Gq4p2d3R0z7b6x4v7p1oG1xH8p0lG
RjW9prL5a6e6N1z2y2N0Xxv5wJ6kq9cQF5s6KQIDAQABAoIBAQCm2f0q7YwK6k2u
Hw0pA6x5s4q7l1e7y7l9l5G6iQ7l5Y3Yt4G2vH9Wm3t5m3F/6dE2t6p6p7vYwqzN
8Ytq3v6rX2kU6sGxXgBz2z4E3b8lK3nO3c9Wwq8qk3V7t3F2o8rJ7WmQ6PzWm5lK
8V4tP7f1X2lR6wXx2mQp5rj7P9eX4dB2cVd5m8xQjCq3lN2u1h7o1e2kGQ==
-----END RSA PRIVATE KEY-----"""

# Public key matching the above private key (for RS256 verify)
TEST_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtHkM1kOkU8zM+1o1kF2Z
qN+3r8lA5X9z0v8wQj3n2Yx8Zr5TY3xW2s0W8M7i9o0iA3Q7GqZqP4Jt3s4x0V4x
r3R5J8yq7dA7Bx2n6m3+f6gq0/8Go2q1qQhYV/UQm0JQy1oK5t2H9q0mKk4j6LQx
X3wQk3e8y2B9r7m8b3Xo8E6aQ3y/m2uWjY3NQeQe6K7WcM8bqJ2e2o4rYzY0hK7G
q4p2d3R0z7b6x4v7p1oG1xH8p0lGRjW9prL5a6e6N1z2y2N0Xxv5wJ6kq9cQF5s6
KQIDAQAB
-----END PUBLIC KEY-----"""


class DummySettings:
    # Minimal settings needed by token_service
    SUPABASE_URL = "https://xyzcompany.supabase.co"
    SUPABASE_JWT_SECRET = "super-secret-dev"
    JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY
    JWT_PUBLIC_KEY_PEM = TEST_PUBLIC_KEY
    JWT_ISS = "kydohub-api"
    JWT_AUD = "kydohub-app"
    JWT_ACCESS_TTL_SEC = 1200
    JWT_REFRESH_TTL_SEC = 1209600


@pytest.fixture(autouse=True)
def patch_settings(monkeypatch):
    """
    Make token_service.get_settings() return our DummySettings for all tests here.
    """
    monkeypatch.setattr(token_service, "get_settings", lambda: DummySettings())


def test_verify_supabase_token_hs256_ok():
    """
    Create a Supabase-like HS256 token and verify it with our secret.
    """
    now = int(time.time())
    payload = {
        "sub": "user-123",
        "aud": "authenticated",
        "iss": "https://xyzcompany.supabase.co",
        "iat": now,
        "exp": now + 300,
    }
    token = jwt.encode(payload, key=DummySettings.SUPABASE_JWT_SECRET, algorithm="HS256")
    claims = token_service.verify_supabase_token(token)
    assert claims["sub"] == "user-123"
    assert claims["aud"] == "authenticated"


def test_issue_and_verify_access_token_rs256_ok():
    """
    Issue a KydoHub RS256 token and verify its claims and header (kid present).
    """
    token, exp = token_service.issue_access_token(user_id="user-123", tenant_id="tenant-xyz", ev=3)
    assert isinstance(token, str)
    assert exp > int(time.time())

    claims = token_service.verify_access_token(token)
    assert claims["sub"] == "user-123"
    assert claims["tid"] == "tenant-xyz"
    assert claims["ev"] == 3
    assert claims["aud"] == DummySettings.JWT_AUD
    assert claims["iss"] == DummySettings.JWT_ISS
    assert "jti" in claims and isinstance(claims["jti"], str) and len(claims["jti"]) > 0

    # Ensure header has a kid
    header = jwt.get_unverified_header(token)
    assert header.get("kid")


def test_clock_skew_leeway_accepts_just_expired_token():
    """
    Token that expired a few seconds ago (within leeway) should still verify.
    """
    # Create a token with exp = now - 60 (within 120s leeway)
    now = int(time.time())
    payload = {
        "sub": "user-123",
        "tid": "tenant-xyz",
        "ev": 1,
        "jti": "abc123",
        "iat": now - 300,
        "exp": now - 60,
        "aud": DummySettings.JWT_AUD,
        "iss": DummySettings.JWT_ISS,
    }
    token = jwt.encode(payload, key=DummySettings.JWT_PRIVATE_KEY_PEM, algorithm="RS256", headers={"kid": "test"})
    # Should not raise
    claims = token_service.verify_access_token(token)
    assert claims["sub"] == "user-123"
