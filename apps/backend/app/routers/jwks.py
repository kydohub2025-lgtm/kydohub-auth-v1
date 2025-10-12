"""
routers/jwks.py

GET /.well-known/jwks.json  ->  { "keys": [ {kty, kid, alg, use, n, e} ] }

Non-developer summary:
----------------------
This publishes the active RS256 public key so other services can verify tokens.
The 'kid' matches the token header and changes automatically when keys rotate.
"""

from __future__ import annotations

import base64
from typing import Dict

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

from ..core.config import get_settings
from ..security.token_service import _compute_kid_from_public_pem  # reuse the same kid logic

router = APIRouter()


def _to_jwk_rsa_components(public_pem: str) -> Dict[str, str]:
    """
    Extract RSA modulus (n) and exponent (e) and return as base64url strings.
    """
    pub = serialization.load_pem_public_key(public_pem.encode("utf-8"))
    if not isinstance(pub, rsa.RSAPublicKey):
        raise ValueError("Configured public key is not RSA.")

    numbers = pub.public_numbers()
    n = numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big")
    e = numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, "big")

    def b64url(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")

    return {"n": b64url(n), "e": b64url(e)}


@router.get("/.well-known/jwks.json")
async def jwks():
    s = get_settings()
    kid = _compute_kid_from_public_pem(s.JWT_PUBLIC_KEY_PEM)
    comps = _to_jwk_rsa_components(s.JWT_PUBLIC_KEY_PEM)

    jwk = {
        "kty": "RSA",
        "kid": kid,
        "alg": "RS256",
        "use": "sig",
        "n": comps["n"],
        "e": comps["e"],
    }
    return JSONResponse(status_code=200, content={"keys": [jwk]})
