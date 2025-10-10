---

# Frontend Fetch Rules (Web – Cookies + CSRF)

> Goal: one reliable HTTP layer for the web app that works with **HttpOnly cookies**, **CSRF**, and our **error contracts**. These rules assume you use the provided wrapper `apps/web/src/lib/http/fetchJson.ts`.

## 1) Always use the wrapper

* Import from `@/lib/http` and call `fetchJson` / `postJson`.
* Do **not** call `window.fetch` directly in feature code (exceptions below).

```ts
import { fetchJson, postJson } from "@/lib/http";
```

**Why**: the wrapper already sets `credentials:'include'`, injects `X-CSRF-Token`, adds `X-Client:web` and `X-Request-ID`, and performs a single silent refresh on `401`.

---

## 2) Request rules (the wrapper enforces most of these)

* **Cookies:** `credentials: 'include'` on every request.
* **Headers (auto):**

  * `X-CSRF-Token` = value of `kydo_csrf` cookie (for non-GET).
  * `X-Client: web`
  * `X-Request-ID: <uuid-v4>`
  * `Content-Type: application/json` (unless body is a string or `FormData`).
* **Body serialization:** pass a plain object; wrapper `JSON.stringify`s it.
* **Do NOT set `Authorization` header** in the browser. Web uses cookies.

**Exceptions:**

* **File uploads / multipart**

  * Create a `FormData`, pass it as `body`.
  * The wrapper will not override `Content-Type`. CSRF still applies.

---

## 3) Automatic retry policy (precise)

* On **`401`** from any request:

  1. Wrapper calls `POST /auth/refresh` once (with cookies + CSRF).
  2. Retries the **original** request once.
* If the retry also fails (`401` again), surface error to UI: “Session expired. Please sign in.”

> The wrapper treats `EV_OUTDATED` and generic `EXPIRED` the same for retry purposes—**one** refresh, then fail.

---

## 4) Handling non-2xx responses (map `error.code`)

Use the `error.code` provided by the wrapper to branch UI behavior:

| code                    | UX rule (web)                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `EV_OUTDATED`/`EXPIRED` | The wrapper already attempted one refresh. If still failing → route to Sign-In.                |
| `TENANT_REQUIRED`       | You’ll get `{ tenantChoice }` instead of `data`. Show tenant picker, then call `/auth/switch`. |
| `CSRF_FAILED`           | Prompt: “Please reload and try again.” Consider reloading `/me/context`.                       |
| `PERMISSION_DENIED`     | Show “You don’t have access.” Hide gated actions from `/me/context`.                           |
| `VALIDATION_FAILED`     | Use `details.fieldErrors` to annotate form fields.                                             |
| `RATE_LIMITED`          | Backoff (e.g., 1s, 2s, 4s) with gentle message.                                                |
| `INVALID_TOKEN`         | Neutral error; send user back to login.                                                        |

**Example**

```ts
const res = await postJson("/attendance/mark", { studentId, at: iso });
if (res.error) {
  switch (res.error.code) {
    case "CSRF_FAILED": toast.error("Please reload and try again."); break;
    case "PERMISSION_DENIED": toast.error("You don’t have access."); break;
    default: toast.error("Something went wrong.");
  }
}
```

---

## 5) `/me/context` usage rules

* Load once after successful exchange/refresh and after **tenant switch**.
* Cache it in app state (e.g., React context/store).
* Build the left nav from `ui_resources.pages`.
* Gate buttons with an `<Acl requires={["perm"]}>` component that checks `permissions`.
* Use `abac` hints only for **client-side pre-filtering** (server still enforces ABAC).

---

## 6) Tenancy & navigation

* On `209 Tenant Choice` from `/auth/exchange`, render a tenant picker using `tenantChoice.tenants[]`.
* After user picks a tenant, call `POST /auth/switch`, then reload `/me/context`, rebuild nav, route to the new home.

---

## 7) When NOT to use the wrapper

* **Anonymous fetches** (e.g., public assets, health checks) that don’t touch the API.
* **File downloads** where you want the raw `Response` stream (use `opts.raw=true` in the wrapper instead if you still hit the API).
* **Multipart uploads** are fine with the wrapper—just pass `FormData`.

---

## 8) Security rules (client)

* Never read or write the session token; it lives in **HttpOnly** cookies by design.
* Do not store auth state in `localStorage` or `sessionStorage`. Use `/me/context` + React state.
* Never log cookies or error payloads that could contain sensitive info.
* Only call the API over **HTTPS**.

---

## 9) Telemetry

* The wrapper sets `X-Request-ID` per request.
* Optionally add `X-Client-Version: <semver>` at app bootstrap (extend the wrapper headers) so BE logs correlate to deployments.

---

## 10) Testing checklist (web)

* Missing `X-CSRF-Token` on POST → expect **403 CSRF_FAILED** (wrapper includes it by default; simulate by deleting cookie).
* EV bump server-side → next call gets **401**, wrapper refreshes, retry succeeds.
* Multi-tenant exchange without hint → **209**; picker + `/auth/switch` path completes.
* Wrapper doesn’t set `Authorization` for web; cookies ride automatically.

---

## 11) Definition of Done (frontend HTTP)

* All feature code uses `fetchJson`/`postJson`.
* One automatic refresh on `401`; no infinite loops.
* CSRF passed for all non-GET requests.
* Tenant picker flow handled on `209`.
* Menus/actions driven by `/me/context`; no hardcoded permission checks in components.

---

**End of file.**
