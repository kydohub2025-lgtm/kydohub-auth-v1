---

# `docs/frontend_auth_module_guide.md`

> Purpose: Give AI agents (and humans) the exact context needed to **debug imports**, **avoid duplicating logic**, and **extend the auth module** safely.
> Scope: Covers RBAC/ABAC, `/me/context` consumption, file responsibilities, import rules, and common pitfalls.

---

## 1) TL;DR — How Auth Works (Frontend)

1. User signs in (Supabase or IdP) → we call **`/api/v1/auth/exchange`** to mint a **backend session cookie**.
2. Protected routes run **`/api/v1/me/context`** (via `useMe()` / `ProtectedRoute`) to fetch:

   * `user`, `tenant`, `membership.roles`, `membership.attrs`
   * `ui_resources.pages[]` & `ui_resources.actions[]` (the *server-defined* RBAC map)
   * `meta.ev` (version to detect permission changes)
3. UI renders **only** what the user can access:

   * Page/menu gating via `<Acl pageId="…">`
   * Button/action gating via `<Acl actionId="…">`
   * Data scoping (ABAC) via helpers in `lib/abac.ts`
4. All HTTP calls go through **`lib/http.ts`** (cookie transport, 401/403 handling, retries, error envelopes).

**Single Source of Truth:**

* **Permissions**: come from the backend (`ui_resources`).
* **RBAC checks**: centralized in `useMe().can()` and `<Acl>`.
* **ABAC filters**: centralized in `lib/abac.ts`.

> Do **not** re-implement checks inside feature pages — *call the centralized helpers*.

---

## 2) Folder Map & Why Each Exists

> Adapt paths if your repo root differs. Lovable constraint: `index.html` and `src/` at project root.

```
src/
  App.tsx
  main.tsx
  index.css
  pages/
    LoginPage.tsx
    SignupPage.tsx
    LogoutPage.tsx
    NotFound.tsx
  routes/
    ProtectedRoute.tsx
    routes.tsx
  layouts/
    AppLayout.tsx
    TenantLayout.tsx
  components/
    auth/
      Acl.tsx
      LogoutButton.tsx
    layout/
      Navbar.tsx
      Sidebar.tsx
  hooks/
    useMe.ts
  lib/
    http.ts
    abac.ts
    utils.ts
    use-mobile.ts
    use-toast.ts
```

---

## 3) Backend Contracts This Frontend Relies On (DO NOT BREAK)

* **`POST /api/v1/auth/exchange`** → sets **HTTP-only session cookie** (web) and returns minimal session state.
* **`GET /api/v1/me/context`** → returns:

  * `user`: `{ id, email, name, ... }`
  * `tenant`: `{ id, code, name, ... }`
  * `membership`: `{ roles: string[], attrs: object }`
  * `ui_resources`:

    * `pages: [{ id: string, requires?: string[] | null }]`
    * `actions: [{ id: string, requires?: string[] | null }]`
  * `meta`: `{ ev: number }` **version** for cache invalidation and real-time updates
* **`POST /api/v1/auth/logout`** → clears backend session (and we also clear Supabase on client).

> If the backend schema changes, **update only** `useMe.ts`, `Acl.tsx`, and `abac.ts`. Do not “quick-fix” in feature pages.

---

## 4) File-by-File Responsibilities (Path, Purpose, Import Tips, Do/Don’t)

### 4.1 Core Boot

**`src/main.tsx`**

* **Purpose:** React bootstrap. Mounts `<App />`.
* **Imports:** `import App from './App'`
* **Don’t:** Add business logic here.
* **Do:** Keep it minimal; wrap with providers only if they are global.

**`src/App.tsx`**

* **Purpose:** Router & app-wide providers (e.g., Toast provider).
* **Imports:** `import { RouterProvider } from 'react-router-dom'; import router from './routes/routes';`
* **Don’t:** Fetch `/me/context` here.
* **Do:** Keep routing/provider wiring consistent.

---

### 4.2 HTTP & Utilities

**`src/lib/http.ts`**

* **Purpose:** **Single** fetch layer. Sends cookies (`credentials: 'include'`), normalizes errors, retries 401.
* **Key Exports:** `http.get/post/put/delete`, `fetchJson`
* **Imports:** only standard APIs + `utils` + `useMe` reload hook (via callback)
* **Don’t:** Call `fetch` directly in pages; always go through this file.
* **Do:** Handle 403 → trigger `useMe().reload()` (permissions changed).

**`src/lib/utils.ts`**

* **Purpose:** Small helpers (safe JSON, merge, sleep, etc.).
* **Don’t:** Add auth/RBAC logic here. Keep generic.

**`src/lib/abac.ts`**

* **Purpose:** Build **attribute-based** filters from `membership.attrs`.
* **Key Exports:** `buildStudentListFilters(attrs)`, `buildStaffListFilters(attrs)`, `mergeFilters(...)`.
* **Don’t:** Query network or read `me` in here. **Pure** functions only.
* **Do:** Keep ABAC scoping **centralized** here so all lists/tables reuse it.

**`src/lib/use-toast.ts`**

* **Purpose:** Global toast helper for UX feedback.
* **Usage:** `toast.success('…')`, `toast.error('…')`.
* **Don’t:** Hide auth errors here; just display.

**`src/lib/use-mobile.ts`**

* **Purpose:** Responsive checks for Navbar/Sidebar layout decisions.

---

### 4.3 Auth Context & RBAC

**`src/hooks/useMe.ts`**

* **Purpose:** Fetch/caches `/me/context`; exposes `me`, `loading`, `error`, `reload`, and `can(permId)`.
* **Key:** `can(permId)` resolves against **`ui_resources.actions[].requires`** and role→permission flattening.
* **Don’t:** Put UI here. Don’t access DOM or window state.
* **Do:** Invalidate cache when `meta.ev` changes.

**`src/components/auth/Acl.tsx`**

* **Purpose:** **Render gate** for pages & actions.
* **Props:**

  * `pageId?: string` → gate page/route visibility
  * `actionId?: string` → gate button/menu item visibility
  * `requires?: string[]` → explicit permission list (rarely used if `pageId/actionId` present)
* **Don’t:** Fetch data here.
* **Do:** Keep it declarative: `<Acl pageId="students.list"> ... </Acl>`, `<Acl actionId="students.create"> ... </Acl>`.

**`src/components/auth/LogoutButton.tsx`**

* **Purpose:** Calls `/auth/logout` then clears Supabase & local state.
* **Don’t:** Add navigation side-effects outside of logout success.

---

### 4.4 Routing & Route Guard

**`src/routes/routes.tsx`**

* **Purpose:** React Router tree. Wires public (`/login`, `/signup`) and protected (`/app/*`).
* **Don’t:** Inline RBAC checks here; use `ProtectedRoute` and `<Acl>` inside pages.

**`src/routes/ProtectedRoute.tsx`**

* **Purpose:** Gate any route that needs auth.
* **Flow:** If `/me/context` is **not** set → redirect to `/login?next=…`. Else render children.
* **Don’t:** Duplicate permission logic here; this is **auth presence**, not RBAC.

---

### 4.5 Layout & Navigation (RBAC-Aware)

**`src/layouts/AppLayout.tsx`**

* **Purpose:** Shell for all authenticated screens: `<Navbar/>`, `<Sidebar/>`, and `<Outlet/>`.
* **Don’t:** Fetch data here; this is structural.

**`src/layouts/TenantLayout.tsx`**

* **Purpose:** Tenant-section wrapper for feature pages (title, toolbar, breadcrumbs).
* **Don’t:** Implement RBAC here; that’s `<Acl>`.

**`src/components/layout/Navbar.tsx`**

* **Purpose:** Top bar. Shows current tenant, user, and RBAC-gated links (e.g., to Dashboard).
* **Do:** Wrap each nav item with `<Acl pageId="…">`.

**`src/components/layout/Sidebar.tsx`**

* **Purpose:** Left navigation; generates allowed items from `me.ui_resources.pages`.
* **Do:** Use `<Acl pageId="…">` per item.
* **Don’t:** Hardcode a second source of permissions.

---

### 4.6 Pages (Public)

**`src/pages/LoginPage.tsx`**

* **Purpose:** Authenticate with Supabase (or form) → `POST /auth/exchange` → redirect to `/app`.
* **Don’t:** Talk to feature APIs directly. Only login + exchange.

**`src/pages/SignupPage.tsx`**

* **Purpose:** Registration → `POST /auth/exchange` → redirect to `/app`.
* **Note:** Might be disabled in production; keep code but gate with feature flag if needed.

**`src/pages/LogoutPage.tsx`**

* **Purpose:** Calls `/auth/logout`, clears client sessions, redirects to `/login`.

**`src/pages/NotFound.tsx`**

* **Purpose:** 404 fallback.

---

## 5) Import Rules That Prevent Headaches

> Use one of these **consistently** (both are fine). Lovable often prefers relative paths.

### Option A — Relative Imports (Default for Lovable)

```ts
// Good
import http from '../lib/http';
import { Acl } from '../components/auth/Acl';
import AppLayout from '../layouts/AppLayout';

// Avoid deep “../../../..” by keeping feature files close to where they’re used.
```

### Option B — Path Aliases (If your build supports it)

> Requires `tsconfig.json` `paths` + Vite alias sync in `vite.config.ts`. If Lovable blocks editing configs, **stick with Option A**.

```ts
// Example (only if configured)
import { Acl } from '@/components/auth/Acl';
import http from '@/lib/http';
```

**Do not mix both styles** randomly. Pick one consistently to avoid duplicate module instances and tree-shaking issues.

---

## 6) Where To Add New Authz Logic (and Where NOT To)

* **Add page/action permissions** → **backend `ui_resources`** document.
* **Gate UI** → wrap component/section with `<Acl pageId="…" | actionId="…">`.
* **Scope data** → call **`lib/abac.ts`** helpers to produce filters before calling APIs.
* **Never**: hardcode permission arrays inside random components.
* **Never**: call `/me/context` directly from pages (use `useMe()`).

---

## 7) Troubleshooting Checklist (Imports, Wiring, 401/403)

### Import/Path Errors

* “Module not found”:

  * Check relative path from current file. Use VS Code auto-import suggestions.
  * If you copied a file, confirm its **new** relative path and update imports.
* “Duplicate React” or mismatched contexts:

  * Happens if the same module is imported via **two different paths** (e.g., alias + relative). **Stick to one style**.

### Auth Wiring

* **401 on protected route**:

  * Ensure `LoginPage` called `/auth/exchange` successfully and session cookies exist.
  * Verify `http.ts` uses `credentials: 'include'`.
* **403 on action**:

  * Likely missing permission in `ui_resources.actions[].requires`.
  * Confirm `<Acl actionId="…">` matches backend `id` exactly (case-sensitive).
  * After role/permission changes, ensure `meta.ev` increments and `useMe().reload()` runs.

### UI Not Updating After Role Change

* Confirm backend increments `meta.ev`.
* In dev, force `useMe().reload()` or refresh page.
* (Phase 4+) Real-time BroadcastChannel will handle this automatically.

---

## 8) Extending the App — “How To Add a New Feature Page Safely”

1. **Backend**: add page/action entries in `ui_resources` with correct `requires`.
2. **Frontend**:

   * Add route under `routes.tsx` inside the protected tree.
   * In your page component:

     ```tsx
     <TenantLayout title="Students">
       <Acl pageId="students.list">
         <StudentsTable />
       </Acl>
       <Acl actionId="students.create">
         <Button onClick={openCreateModal}>New Student</Button>
       </Acl>
     </TenantLayout>
     ```
   * For list APIs, build filters:

     ```ts
     const filters = buildStudentListFilters(me.membership.attrs);
     const data = await http.get('/api/v1/students', { params: { filters } });
     ```
3. **Never** check permissions manually; use `<Acl>` and `useMe().can()`.

---

## 9) What An AI **Must Not** Do

* Do **NOT**:

  * Duplicate `can()` logic in other files.
  * Fetch `/me/context` anywhere except `useMe()`.
  * Hardcode permission lists in pages; rely on backend `ui_resources`.
  * Bypass `http.ts` to call `fetch` directly.
  * Rename `pageId` / `actionId` values without coordinating backend.

* Do:

  * Keep `<Acl>` wrappers when refactoring.
  * Keep `http.ts` as the only fetch layer.
  * Keep `abac.ts` as the only ABAC location.
  * Update this doc if you add new cross-cutting auth files.

---

## 10) Minimal Code Snippets (Reference)

**Page gate**

```tsx
import { Acl } from '../components/auth/Acl';
<Acl pageId="dashboard.view">
  <Dashboard />
</Acl>
```

**Action gate**

```tsx
<Acl actionId="students.create">
  <Button onClick={openCreate}>New Student</Button>
</Acl>
```

**ABAC filters**

```ts
import { buildStudentListFilters } from '../lib/abac';
const filters = buildStudentListFilters(me.membership.attrs);
const res = await http.get('/api/v1/students', { params: { filters } });
```

**HTTP usage**

```ts
import http from '../lib/http';
const { data, error } = await http.post('/api/v1/auth/logout');
```

---

## 11) Glossary

* **RBAC**: Role-based access control (who can see/do).
* **ABAC**: Attribute-based access control (which data subset).
* **`ui_resources`**: Server-side source of truth mapping page/action IDs to required permissions.
* **`meta.ev`**: Version number; increments on role/permission changes to invalidate caches.

---

## 12) Ownership & Change Control

* Any changes to **contracts** (`/me/context` shape, permission IDs, or `http.ts` behavior) require:

  1. Updating this document,
  2. Updating `useMe.ts`, `Acl.tsx`, `abac.ts`,
  3. Verifying affected layouts (Navbar/Sidebar) and feature pages.

---

**End of file.**
If you add new cross-cutting auth utilities (e.g., `PermissionDebugger`, BroadcastChannel sync), create a sibling doc: `docs/frontend_auth_operational_hardening.md` and link it here under §12.
