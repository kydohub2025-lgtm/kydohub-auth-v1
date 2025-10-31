"""
security/token_service.py

- verify_supabase_token()  -> Validate Supabase token (RS256 via JWKS, or HS256 legacy)
- issue_access_token()     -> Issue KydoHub RS256 access token (with deterministic 'kid')
- verify_access_token()    -> Validate KydoHub RS256 access token (clock-skew aware)

Non-developer summary:
----------------------
We accept a Supabase token only at /auth/exchange. Modern Supabase projects sign
tokens with RS256 (public keys discoverable via JWKS); older ones may use HS256.
After verifying the Supabase token, we mint our own RS256 access tokens signed
by our keypair. Tokens carry:
  sub (user), tid (tenant), ev (epoch), jti (random), iat, exp, aud, iss.
We include a stable 'kid' header computed from the public key, so clients or
downstream services can discover/verify via /.well-known/jwks.json.
"""

from __future__ import annotations

import base64
import hashlib
import time
import uuid
from typing import Dict, Tuple

import jwt
from jwt import PyJWKClient, InvalidTokenError

from ..core.config import get_settings
from ..core.errors import AppError


# ---------------- Utilities ----------------

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _pem_to_der_public_key(pem: str) -> bytes:
    """
    Convert PEM public key to DER SubjectPublicKeyInfo for hashing.
    """
    from cryptography.hazmat.primitives import serialization  # lazy import
    key = serialization.load_pem_public_key(pem.encode("utf-8"))
    return key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def _compute_kid_from_public_pem(public_pem: str) -> str:
    """
    Deterministic key id (kid) derived from the public key:
    kid = base64url(sha256(SubjectPublicKeyInfo DER))[:16]
    """
    der = _pem_to_der_public_key(public_pem.strip())
    digest = hashlib.sha256(der).digest()
    return _b64url(digest)[:16]  # short but unique enough for rotation tracking


# ---------------- Supabase (RS256 via JWKS, or HS256 legacy) ----------------

def verify_supabase_token(token: str) -> Dict:
    """
    Verify a Supabase access token and return its decoded claims.

    - If header.alg starts with RS (e.g., RS256), verify using the project's JWKS:
        SUPABASE_JWKS_URL or <SUPABASE_URL>/auth/v1/keys
      and enforce audience "authenticated".
    - If header.alg starts with HS (e.g., HS256), verify using SUPABASE_JWT_SECRET
      (legacy mode), enforcing audience "authenticated".

    Raises:
      AppError("UNAUTHENTICATED", ...) on any verification failure.
    """
    s = get_settings()

    # 1) Inspect header to choose verification strategy
    try:
        header = jwt.get_unverified_header(token)
        alg = str(header.get("alg", "")).upper()
    except Exception as e:
        raise AppError("UNAUTHENTICATED", f"Invalid JWT header: {e}", status=401)

    try:
        if alg.startswith("RS"):
            # RS256 (modern Supabase). Use JWKS.
            jwks_url = getattr(s, "SUPABASE_JWKS_URL", None) or (
                s.SUPABASE_URL.rstrip("/") + "/auth/v1/keys"
            )
            jwks_client = PyJWKClient(jwks_url)
            signing_key = jwks_client.get_signing_key_from_jwt(token)

            payload = jwt.decode(
                token,
                key=signing_key.key,
                algorithms=["RS256"],
                audience="authenticated",
                options={"require": ["sub", "exp"]},
            )
            return payload

        elif alg.startswith("HS"):
            # HS256 (legacy Supabase).
            secret = getattr(s, "SUPABASE_JWT_SECRET", None)
            if not secret:
                raise AppError(
                    "UNAUTHENTICATED",
                    "Missing SUPABASE_JWT_SECRET for HS256 verification.",
                    status=401,
                )

            payload = jwt.decode(
                token,
                key=secret,
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["sub", "exp"]},
            )
            return payload

        else:
            raise AppError("UNAUTHENTICATED", f"Unsupported JWT alg: {alg}", status=401)

    except InvalidTokenError as e:
        # PyJWT verification error (bad signature, wrong aud/exp, etc.)
        raise AppError("UNAUTHENTICATED", f"Invalid identity token: {e}", status=401)
    except AppError:
        # Pass-through for our own explicit errors
        raise
    except Exception as e:
        # Any other unexpected failure
        raise AppError("UNAUTHENTICATED", f"Token verification failed: {e}", status=401)


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
