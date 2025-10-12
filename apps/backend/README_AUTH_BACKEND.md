# KydoHub Backend — Auth & Onboarding

Production-grade FastAPI backend for **Authentication, Authorization & Onboarding**.

This README is a practical guide for:
- running locally (dev),
- understanding the web vs. mobile flows,
- configuring environment variables,
- running migrations & tests,
- troubleshooting common errors,
- and deploying to AWS Lambda.

---

## Quick start

### 1) Prereqs
- Python **3.11** (or newer)
- MongoDB (Atlas or local)
- **Redis** (optional but recommended for performance/rate limits)
- OpenSSL (to generate RS256 keys for JWTs)

### 2) Create `.env.local`

Put this in `apps/backend/.env.local` (values shown are examples — use your real dev creds):

```env
# --- Service ---
APP_STAGE=dev
API_BASE_PATH=/api/v1
LOG_LEVEL=INFO

# --- Mongo ---
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=kydohub

# --- Redis (optional) ---
REDIS_URL=redis://localhost:6379

# --- Supabase (IdP) ---
SUPABASE_URL=https://YOURPROJECT.supabase.co
SUPABASE_JWT_SECRET=your-dev-hs256-secret

# --- JWT (KydoHub RS256) ---
# See "Generate JWT keys" below
JWT_PRIVATE_KEY_PEM="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
JWT_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
JWT_ISS=kydohub-api
JWT_AUD=kydohub-app
JWT_ACCESS_TTL_SEC=900          # 15 minutes
JWT_REFRESH_TTL_SEC=1209600     # 14 days

# --- Web security / Cookies ---
ALLOWED_ORIGINS=http://localhost,http://127.0.0.1,http://testserver
COOKIE_DOMAIN=.kydohub.com      # for local TestClient use: COOKIE_DOMAIN=testserver
ACCESS_COOKIE=kydo_sess
REFRESH_COOKIE=kydo_refresh
CSRF_COOKIE=kydo_csrf
CSRF_HEADER=X-CSRF

# --- Rate limits for /auth/* ---
RATE_LIMITS_IP=20/m
RATE_LIMITS_TENANT=600/m
