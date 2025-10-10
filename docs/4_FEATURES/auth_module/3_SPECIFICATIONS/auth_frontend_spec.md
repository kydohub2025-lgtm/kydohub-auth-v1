---
doc_type: frontend_spec
feature_slug: auth-onboarding
version: 0.2.1
status: draft
last_updated: 2025-10-05T23:50:00Z
owners:
  eng_frontend: "TBD"
ui_context:
  library: "React"
  styling: "Tailwind + shadcn/ui"
  state: ["React Query","Zustand (light)"]
privacySensitive: true
---

# Title
Auth Onboarding UI (Supabase → Exchange → Cookie Sessions)

## Overview & Entry Points
- **Routes**
  - `/login` — Supabase-hosted (redirect) or embedded modal for sign-in; immediately calls **`POST /auth/exchange`** on success. :contentReference[oaicite:3]{index=3}
  - `/invite/accept` — informational landing that opens Supabase signup; on return, runs **exchange** and then fetches `/me/context`. :contentReference[oaicite:4]{index=4}
  - `/first-run` — founding tenant wizard entry (if user is the first member). :contentReference[oaicite:5]{index=5}
  - (No public `/signup` form owned by us; IdP owns login/signup/MFA.) :contentReference[oaicite:6]{index=6}
- **Navigation**
  - App shell loads, then **fetches `/me/context`** to build menus & actions; pages/actions appear only when `required ⊆ permissions`. :contentReference[oaicite:7]{index=7}
- **Guards**
  - **TenantLayout**: Fetches `/me/context` on mount/focus; if API returns **401 EV_OUTDATED/EXPIRED**, it silently calls **`POST /auth/refresh`** and retries once (no popups). :contentReference[oaicite:8]{index=8}
  - **Action gating**: UI renders controls only when `required ⊆ userPermissions` (from `/me/context`). :contentReference[oaicite:9]{index=9}

## Screen Inventory
1. **Login** — Supabase sign-in; after success, **ExchangeGate** sets session cookies via `/auth/exchange` then reloads context. :contentReference[oaicite:10]{index=10}  
2. **Invite Accept** — Explains invite; CTA opens Supabase signup; on return, ExchangeGate binds membership & redirects into app. :contentReference[oaicite:11]{index=11}  
3. **First-Run Wizard** — Founding tenant flow; seeded roles; ends by refetching `/me/context`. :contentReference[oaicite:12]{index=12}  
4. **Tenant Switch Modal** — Picker; on submit call `/auth/switch`, then refresh context and rebuild nav. :contentReference[oaicite:13]{index=13}  
5. **Error 401/403/429** — 401 handled silently (refresh+retry), 403 shows forbidden with support CTA, 429 shows throttle UX. :contentReference[oaicite:14]{index=14}

## States per Screen
- **Login**
  - *loading:* exchanging; *success:* cookies set, context loaded; *error:* exchange fails → show safe retry; *forbidden:* N/A (handled by IdP). :contentReference[oaicite:15]{index=15}
- **Invite Accept**
  - *success:* membership bound; *error:* expired/invalid invite → prompt to request a new invite (neutral copy). :contentReference[oaicite:16]{index=16}
- **First-Run Wizard**
  - *partial:* steps incomplete; *success:* tenant seeded; *error:* backend 422/409 → inline guidance; telemetry emitted. :contentReference[oaicite:17]{index=17}
- **Tenant Switch**
  - *loading:* switching; *success:* context rebuilt; *error:* show toast + stay in current tenant; never trust client `tenantId`. :contentReference[oaicite:18]{index=18}
- **Error Pages**
  - 401 auto-handled; 403/429 present user-friendly messaging with retry/back navigation. :contentReference[oaicite:19]{index=19}

## Components & Contracts (UI-only)
- **`ExchangeGate`**
  - **Responsibility:** After Supabase success, call `/auth/exchange`, set cookies, then `refetchContext()`.  
  - **Props:** `onSuccess()`, `onError(error)`.  
  - **Events:** emits `ui.auth.exchange.complete`. :contentReference[oaicite:20]{index=20}
- **`TenantLayout`**
  - **Responsibility:** Fetch `/me/context`, build nav from `menuModel`, guard routes, handle 401 silent refresh.  
  - **Props:** none; uses `useAuth()` and `useContextQuery()`. :contentReference[oaicite:21]{index=21}
- **`TenantSwitchModal`**
  - **Responsibility:** Let user select tenant; invokes `/auth/switch`; on success triggers `refetchContext()`.  
  - **Props:** `isOpen`, `onClose()`. :contentReference[oaicite:22]{index=22}
- **`ActionGate`**
  - **Responsibility:** Render children only when `required ⊆ permissions`.  
  - **Props:** `required: string[]`, `fallback?: ReactNode`. :contentReference[oaicite:23]{index=23}
- **`CsrfGuardedButton`**
  - **Responsibility:** For unsafe methods, ensures CSRF header is attached (reads `csrf` cookie).  
  - **Props:** `onClick()`, `disabled?`. :contentReference[oaicite:24]{index=24}

## Forms & Validation
- We **do not** implement password/MFA forms; Supabase owns them.  
- Client-side: validate tenant switching selection; neutral-copy errors (no user enumeration).  
- Unsafe actions must add `X-CSRF` header (double-submit cookie). :contentReference[oaicite:25]{index=25}

## Data Fetching & Caching
- **operationIds**
  - `auth.exchange`, `auth.refresh`, `auth.logout`, `auth.switch`, `me.context`. :contentReference[oaicite:26]{index=26}
- **Fetch timing**
  - On login success: `auth.exchange` → then `me.context`.  
  - On app mount/focus: `me.context` (background refetch on focus).  
  - On 401 EV_OUTDATED/EXPIRED: `auth.refresh` then retry once. :contentReference[oaicite:27]{index=27}
- **Cache policy**
  - React Query keys: `["me","context"]`; **staleTime**: 30s; refetch on window focus.  
  - **Invalidation:** after `auth.switch` and successful exchange/refresh, invalidate `["me","context"]`. :contentReference[oaicite:28]{index=28}
- **Pagination/Filtering**
  - Not applicable in this spec (context payload is small).  
- **Error handling**
  - 401: silent refresh + retry; 403: show forbidden; 429: backoff with user-friendly copy. :contentReference[oaicite:29]{index=29}

## State Management Strategy
- **Local state** for dialogs/wizards; server state via React Query.  
- Avoid storing any tokens in JS; rely on cookies for all calls. :contentReference[oaicite:30]{index=30}
- **Selectors** create minimal projections from `/me/context` for rendering menus & gates. :contentReference[oaicite:31]{index=31}

## Error, Empty, and Loading UX
- **Loading:** route-level skeleton until `/me/context` arrives.  
- **Empty:** if no pages available, show “No access in this tenant” with switch-tenant CTA.  
- **Error:** include correlationId if provided; retry buttons for safe operations. :contentReference[oaicite:32]{index=32}

## Accessibility (A11y)
- Keyboard-first navigation, visible focus, ARIA landmarks.  
- `aria-live="polite"` for async status (exchange/refresh/guarded fetch).  
- Respect reduced motion preference; no auth info conveyed by color only. :contentReference[oaicite:33]{index=33}

## Internationalization (i18n)
- Namespace: `authOnboarding.*`.  
- All user-facing strings externalized; timezones from tenant default with user override. :contentReference[oaicite:34]{index=34}

## Performance
- **Budgets:** TTI ≤ 2000ms, INP ≤ 200ms, route bundle ≤ 200KB on auth screens.  
- Defer heavy libs (QR/TOTP not used here); prefetch `/me/context` after exchange. :contentReference[oaicite:35]{index=35}

## Telemetry (no PII in payloads)
- `ui.auth.exchange.submit|complete|error`  
- `ui.auth.refresh.complete|error`  
- `ui.auth.context.view` (on successful `/me/context`)  
- `ui.auth.tenantSwitch.submit|complete|error`  
- `ui.auth.guard.retry` (when 401 retry is triggered) :contentReference[oaicite:36]{index=36}

## Security & Privacy (UI layer)
- **Never store tokens** in JS; use HttpOnly cookies only.  
- **CSRF** header on unsafe methods; **SameSite Strict/Lax** cookies as policy dictates.  
- **Neutral errors** (no account existence leaks); **do not** expose tenant IDs in client controls. :contentReference[oaicite:37]{index=37}

## Non-Functional UX & Resilience
- If Redis is down, backend recomputes permissions from Mongo; the UI behavior is unchanged except a brief delay on first guarded call. Handle via normal loading states. :contentReference[oaicite:38]{index=38}

## Open Questions
- Whether `/login` embeds Supabase modal or uses full redirect (UX preference). :contentReference[oaicite:39]{index=39}
- Cookie domain/path strategy to support Cloudflare Pages + API domain split. :contentReference[oaicite:40]{index=40}

## Machine Summary (for Cursor)
```json
{
  "featureSlug": "auth-onboarding",
  "routes": ["/login","/invite/accept","/first-run"],
  "coreGuards": ["TenantLayout","ActionGate","ExchangeGate"],
  "operationIds": ["auth.exchange","auth.refresh","auth.logout","auth.switch","me.context"],
  "fetchTiming": {
    "onLoginSuccess": ["auth.exchange","me.context"],
    "onMountFocus": ["me.context"],
    "on401": ["auth.refresh"]
  },
  "cacheInvalidation": {
    "onExchange": ["me.context"],
    "onRefresh": ["me.context"],
    "onTenantSwitch": ["me.context"]
  },
  "telemetryEvents": [
    "ui.auth.exchange.submit","ui.auth.exchange.complete","ui.auth.exchange.error",
    "ui.auth.refresh.complete","ui.auth.refresh.error",
    "ui.auth.context.view",
    "ui.auth.tenantSwitch.submit","ui.auth.tenantSwitch.complete","ui.auth.tenantSwitch.error",
    "ui.auth.guard.retry"
  ],
  "a11y": {"focusVisible": true, "ariaLivePolite": true},
  "i18n": {"namespace":"authOnboarding"},
  "perfBudgets": {"ttiMs":2000,"inpMs":200,"bundleKb":200},
  "security": {"noTokensInJs": true, "csrfOnUnsafe": true, "sameSiteCookies": true},
  "references": {
    "prd":"prd.md",
    "authPart1":"Authentication Design Document - Part 1.docx",
    "authPart2":"Authentication Desing Document - Part 2.docx",
    "frontendContext":"frontend_context.md"
  }
}
````
