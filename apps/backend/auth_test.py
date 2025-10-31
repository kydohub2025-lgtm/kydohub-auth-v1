import os
import json
import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Load environment variables
# ---------------------------------------------------------------------------
load_dotenv(".env.local")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
BACKEND_URL = os.getenv("BACKEND_URL")
TEST_EMAIL = os.getenv("TEST_EMAIL")
TEST_PASSWORD = os.getenv("TEST_PASSWORD")

def log_header(title: str):
    print("\n" + "=" * 80)
    print(f"🔹 {title}")
    print("=" * 80)

# ---------------------------------------------------------------------------
# Step 1: Login to Supabase and get access_token
# ---------------------------------------------------------------------------
def get_supabase_token():
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    }
    resp = requests.post(url, headers=headers, json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"❌ Supabase login failed: {resp.status_code} {resp.text}")
    data = resp.json()
    access_token = data["access_token"]
    print(f"✅ Supabase login OK — user_id: {data['user']['id']}")
    return access_token

# ---------------------------------------------------------------------------
# Step 2: Exchange Supabase token with backend
# ---------------------------------------------------------------------------
def exchange_with_backend(supabase_token):
    url = f"{BACKEND_URL}/api/v1/auth/exchange"
    headers = {
        "accept": "application/json",
        "Content-Type": "application/json",
        "X-Client": "mobile"
    }
    payload = {
        "provider": "supabase",
        "token": supabase_token
    }
    resp = requests.post(url, headers=headers, json=payload)
    if resp.status_code not in (200, 204):
        raise RuntimeError(f"❌ Backend exchange failed: {resp.status_code} {resp.text}")
    data = resp.json() if resp.content else {}

    access_token = data.get("access")
    refresh_token = data.get("refresh")

    print(f"✅ Backend exchange OK — tenant: {data.get('tenant', {}).get('tenantId')}")
    print("\n--- KydoHub Tokens ---")
    print("Access token (FULL):")
    print(access_token or "<none>")
    print("\nRefresh token (first 80 chars):")
    print(f"{(refresh_token or '')[:80]}...")
    print()

    return data

# ---------------------------------------------------------------------------
# Step 3: Call /me/context using KydoHub access token
# ---------------------------------------------------------------------------
def get_context(access_token):
    url = f"{BACKEND_URL}/api/v1/me/context"
    headers = {
        "accept": "application/json",
        "Authorization": f"Bearer {access_token}"
    }
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        print("\n❌ Context fetch failed.")
        print(f"Status: {resp.status_code}")
        print(f"Response: {resp.text}")
        print(f"\n🔑 Access token (FULL):\n{access_token}\n")
        raise RuntimeError(f"Context fetch failed with status {resp.status_code}")
    data = resp.json()
    print(f"✅ Context OK — user: {data.get('user', {}).get('email')}")
    print("\n--- Debug: Access token used for /me/context ---")
    print(access_token)
    print()
    print("--- /me/context response ---")
    print(json.dumps(data, indent=2))
    print()
    return data

# ---------------------------------------------------------------------------
# MAIN FLOW
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    log_header("STEP 1 — Supabase Login")
    supa_token = get_supabase_token()

    log_header("STEP 2 — KydoHub Exchange")
    backend_data = exchange_with_backend(supa_token)
    access_token = backend_data.get("access")

    log_header("STEP 3 — Fetch Context")
    try:
        context = get_context(access_token)
    except Exception as e:
        print(f"⚠️  {e}")
        print("You can reuse the printed access token above for manual Swagger/Postman testing.")
        exit(1)

    log_header("✅ SUMMARY")
    print(json.dumps({
        "supabase_user": TEST_EMAIL,
        "tenantId": backend_data.get("tenant", {}).get("tenantId"),
        "tenantName": backend_data.get("tenant", {}).get("name"),
        "access_token_snippet": access_token[:50] + "...",
        "context_roles": context.get("roles"),
    }, indent=2))
    print("\n🎉 End-to-end authentication test completed successfully.")
