#!/usr/bin/env python3
"""
Supabase Password Login (prints access_token JSON)
--------------------------------------------------

Hardcoded with:
  - Supabase URL: https://rkutfealtboqlmbupjuu.supabase.co
  - Supabase Anon Key: sb_publishable_FpH3DsE5O-76jhTGnEGnYg_MZqoshOb
  - Email: testuser1@kydohub.com
  - Password: AppViewX@123$#

Usage:
  python tools/supabase_password_login.py

Output:
  - Pretty JSON printed (includes access_token)
  - Also saved to tools/.supabase_token.json
"""

import sys
import json
import pathlib
import requests

DEFAULT_OUT = pathlib.Path(__file__).parent / ".supabase_token.json"

# -----------------------------------------------------------
# Hardcoded project + credentials
# -----------------------------------------------------------
SUPABASE_URL = "https://rkutfealtboqlmbupjuu.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_FpH3DsE5O-76jhTGnEGnYg_MZqoshOb"
EMAIL = "owner@kydohub.com"
PASSWORD = "AppViewX@123"
# -----------------------------------------------------------

def login_with_password() -> dict:
    """Authenticate to Supabase using password grant and return JSON."""
    token_url = SUPABASE_URL.rstrip("/") + "/auth/v1/token?grant_type=password"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    payload = {"email": EMAIL, "password": PASSWORD}

    resp = requests.post(token_url, headers=headers, json=payload, timeout=30)

    try:
        data = resp.json()
    except ValueError:
        resp.raise_for_status()
        raise

    if resp.status_code >= 400:
        raise SystemExit(
            f"[ERROR] {resp.status_code} from Supabase:\n"
            f"{json.dumps(data, indent=2)}"
        )

    if "access_token" not in data:
        raise SystemExit(
            f"[ERROR] Unexpected response (no access_token):\n"
            f"{json.dumps(data, indent=2)}"
        )

    return data

def main() -> None:
    data = login_with_password()

    # Print to console
    print(json.dumps(data, indent=2))

    # Save to file for later use (e.g. /auth/exchange)
    out_path = DEFAULT_OUT
    out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"\n[OK] Token JSON saved to: {out_path}", file=sys.stderr)
    if "access_token" in data:
        print("[TIP] access_token is ready to use with /auth/exchange.", file=sys.stderr)

if __name__ == "__main__":
    main()
