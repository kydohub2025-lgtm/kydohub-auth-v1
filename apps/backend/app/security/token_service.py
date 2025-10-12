"""
security/token_service.py

- verify_supabase_token()  -> Validate Supabase HS256 token
- issue_access_token()     -> Issue KydoHub RS256 access token (with deterministic 'kid')
- verify_access_token()    -> Validate KydoHub RS256 access token (clock-skew aware)

Non-developer summary:
----------------------
We accept a Supabase token only at /auth/exchange (HS256). After that, we mint
our own RS256 access tokens signed with our keypair. Tokens carry:
  sub (user), tid (tenant), ev (epoch), jti (random), iat, exp, aud, iss.
We include a stable 'kid' header computed from the public key, so clients or
downstream services can discover/verify via /.well-known/jwks.json.
"""

from __future__ import annotations

import base64
import hashlib
import os
import time
import uuid
from typing import Dict, Tuple

import jwt

from ..core.config import get_settings


# ---------------- Utilities ----------------

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _pem_to_der_public_key(pem: str) -> bytes:
    """
    Convert PEM public key to DER SubjectPublicKeyInfo for hashing.
    """
    from cryptography.hazmat.primitives import serialization
    key = serialization.load_pem_public_key(pem.encode("utf-8"))
    return key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def _compute_kid_from_public_pem(public_pem: str) -> str:
    """
    Deterministic key id (kid) derived from the public key:
    kid = base64url(sha256(SubjectPublicKeyInfo DER))
    """
    der = _pem_to_der_public_key(public_pem.strip())
    digest = hashlib.sha256(der).digest()
    return _b64url(digest)[:16]  # short but unique enough for rotation tracking


# ---------------- Supabase (HS256) ----------------

def verify_supabase_token(token: str) -> Dict:
    """
    Verify HS256 Supabase access token using SUPABASE_JWT_SECRET.
    Returns decoded claims or raises jwt exceptions.
    """
    s = get_settings()
    return jwt.decode(
        token,
        key=s.SUPABASE_JWT_SECRET,
        algorithms=["HS256"],
        options={"require": ["sub", "exp"]},
        audience=None,  # Supabase tokens use 'aud':'authenticated' but we don't enforce here
        issuer=s.SUPABASE_URL,
        leeway=0,
    )


# ---------------- KydoHub RS256 ----------------

_CLOCK_SKEW_LEEWAY = 120  # seconds


def issue_access_token(*, user_id: str, tenant_id: str, ev: int) -> Tuple[str, int]:
    """
    Issue a short-lived RS256 access token.

    Returns: (jwt, exp)
    """
    s = get_settings()
    now = int(time.time())
    exp = now + int(s.JWT_ACCESS_TTL_SEC)
    jti = str(uuid.uuid4())

    claims = {
        "sub": user_id,
        "tid": tenant_id,
        "ev": int(ev),
        "jti": jti,
        "iat": now,
        "exp": exp,
        "aud": s.JWT_AUD,
        "iss": s.JWT_ISS,
    }

    # Compute deterministic kid from PUBLIC key so JWKS & tokens stay in sync
    kid = _compute_kid_from_public_pem(s.JWT_PUBLIC_KEY_PEM)

    headers = {"kid": kid, "alg": "RS256", "typ": "JWT"}
    token = jwt.encode(claims, key=s.JWT_PRIVATE_KEY_PEM, algorithm="RS256", headers=headers)
    return token, exp


def verify_access_token(token: str) -> Dict:
    """
    Verify an RS256 access token. Accepts small clock skew.
    """
    s = get_settings()
    return jwt.decode(
        token,
        key=s.JWT_PUBLIC_KEY_PEM,
        algorithms=["RS256"],
        audience=s.JWT_AUD,
        issuer=s.JWT_ISS,
        leeway=_CLOCK_SKEW_LEEWAY,
        options={"require": ["sub", "tid", "ev", "jti", "exp", "iss", "aud"]},
    )
