---

# KydoHub Frontend RBAC/ABAC Usage Guide (for AI codegen)

**Purpose:** This guide tells AI agents (Lovable/ChatGPT) exactly how to apply **RBAC** (page/action gating) and **ABAC** (data scoping) when generating new feature pages for KydoHub. It is production-oriented, consistent with our backend contracts, and compatible with Lovable’s folder constraints.

## 0) What already exists (don’t re-invent)

* `src/routes/ProtectedRoute.tsx` — Guards private routes (auth/session checks).
* `src/hooks/useMe.ts` — Fetches `/api/v1/me/context`; exposes `{ me, loading, error, reload }`.
* `src/components/auth/Acl.tsx` — Declarative RBAC gate for **pages** and **actions** (renders children or null).
* `src/components/LogoutButton.tsx` — Clean session exit anywhere.
* `src/components/layout/Navbar.tsx` / `src/components/layout/Sidebar.tsx` — Shell navigation only (no auth logic inside).
* `src/layouts/AppLayout.tsx` — Top-level shell for all authenticated routes.
* `src/layouts/TenantLayout.tsx` — Consistent header/container for tenant-scoped feature screens.
* `src/lib/http.ts` — Fetch wrapper with credentials, 401→refresh, error envelope handling.
* `src/lib/abac.ts` — Helpers to build/merge **attribute-based** filters from `me.membership.attrs`.

**Backend provides** (via `/api/v1/me/context`):

* `me.ui_resources.pages[]` and `me.ui_resources.actions[]` (RBAC source of truth for UI gating),
* `me.membership.attrs` (ABAC attributes like `roomIds`, `grades`, etc.),
* `me.tenant.tenantId` (isolate by tenant),
* `me.meta.ev` (event/version; bump triggers UI to re-evaluate permissions).

---

## 1) Folder structure for new features (Lovable-compatible)

```
src/
  features/
    <feature-name>/
      pages/
        <Feature>Page.tsx
        <Feature>DetailsPage.tsx      (optional)
      components/
        <Feature>Table.tsx            (optional)
      routes.tsx
```

**Routing rule:** Feature routes mount under `AppLayout` and are wrapped by `ProtectedRoute`. Inside each page use `<TenantLayout>` for consistent header and spacing.

---

## 2) Page RBAC — gate the entire screen

At the **root** of each page component, wrap content with `<Acl>`.

```tsx
// src/features/staff/pages/StaffPage.tsx
import React from "react";
import TenantLayout from "../../../layouts/TenantLayout";
import { Acl } from "../../../components/auth/Acl";

const StaffPage: React.FC = () => {
  return (
    <Acl pageId="staff" requires={["staff.view"]}>
      <TenantLayout title="Staff" subtitle="Manage staff directory">
        {/* page content */}
      </TenantLayout>
    </Acl>
  );
};

export default StaffPage;
```

* `pageId` must match `ui_resources.pages[].id` for this screen.
* `requires` is an array of permission strings. Default `mode="all"`; set `mode="any"` if needed.

---

## 3) Action RBAC — gate buttons, menus, per-row actions

Wrap **controls** (not data) with `<Acl>` using `requires` (and optionally `actionId`).

```tsx
import { Acl } from "../../../components/auth/Acl";

<Acl actionId="staff.create" requires={["staff.create"]}>
  <button className="btn-primary">Add Staff</button>
</Acl>

<Acl actionId="staff.edit" requires={["staff.edit"]}>
  <button>Edit</button>
</Acl>

<Acl actionId="staff.delete" requires={["staff.delete"]}>
  <button>Delete</button>
</Acl>
```

If both `actionId` and `requires` are present, `requires` is authoritative.

---

## 4) ABAC — scope the data you query and mutate

Always include `tenantId`, and derive attribute filters (rooms, grades, branches, etc.) from `me.membership.attrs`. Use helpers from `src/lib/abac.ts`.

```tsx
// src/features/staff/pages/StaffPage.tsx
import React from "react";
import TenantLayout from "../../../layouts/TenantLayout";
import { Acl } from "../../../components/auth/Acl";
import { http } from "../../../lib/http";
import { useMe } from "../../../hooks/useMe";
import { mergeFilters, buildStaffListFilters } from "../../../lib/abac";

const StaffPage: React.FC = () => {
  const { me } = useMe();
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);

        // 1) base multi-tenant isolation
        const base = { tenantId: me?.tenant?.tenantId };

        // 2) ABAC from membership attrs (rooms/grades/etc.)
        const abac = buildStaffListFilters(me);

        // 3) final filter
        const filter = mergeFilters(base, abac);

        // 4) GET with filter
        const res = await http.get("/api/v1/staff", {
          params: { filter: JSON.stringify(filter), page: 1, pageSize: 20 }
        });

        if (!cancelled) setRows(res.data.items || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load staff");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [me?.meta?.ev]); // react to permission/version bumps

  return (
    <Acl pageId="staff" requires={["staff.view"]}>
      <TenantLayout title="Staff" subtitle="Manage staff directory">
        {loading && <div>Loading…</div>}
        {error && <div className="text-red-600">{error}</div>}

        <div className="mb-3">
          <Acl actionId="staff.create" requires={["staff.create"]}>
            <button className="btn-primary">Add Staff</button>
          </Acl>
        </div>

        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded border p-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-sm text-gray-500">{r.role}</div>
              </div>
              <div className="flex gap-2">
                <Acl actionId="staff.edit" requires={["staff.edit"]}>
                  <button className="btn-secondary">Edit</button>
                </Acl>
                <Acl actionId="staff.delete" requires={["staff.delete"]}>
                  <button className="btn-danger">Delete</button>
                </Acl>
              </div>
            </li>
          ))}
        </ul>
      </TenantLayout>
    </Acl>
  );
};

export default StaffPage;
```

> **Backend remains authoritative**: frontend filters are hints; server **must** re-apply RBAC/ABAC.

---

## 5) API usage contracts (consistent with `http.ts` & error envelopes)

* **List endpoints** accept: `filter`, `sort`, `page`, `pageSize` as query params.
* **Mutations** include `tenantId` in payload (server may also resolve from session).
* `http.ts` handles 401 with silent refresh; surfaces 403. On 403, consider `useMe().reload()` because `ui_resources`/roles may have changed.

```ts
// GET with ABAC filter
await http.get("/api/v1/students", {
  params: {
    filter: JSON.stringify({
      tenantId: me.tenant.tenantId,
      roomId: { $in: me.membership.attrs.roomIds || [] }
    }),
    page: 1,
    pageSize: 20,
    sort: JSON.stringify({ name: 1 })
  }
});

// POST create (server enforces RBAC/ABAC again)
await http.post("/api/v1/students", {
  tenantId: me.tenant.tenantId,
  name, dob, roomId
});
```

---

## 6) Feature route wiring template

```tsx
// src/features/staff/routes.tsx
import React from "react";
import { RouteObject } from "react-router-dom";
import AppLayout from "../../layouts/AppLayout";
import ProtectedRoute from "../../routes/ProtectedRoute";
import StaffPage from "./pages/StaffPage";

export const staffRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      {
        element: <ProtectedRoute />,
        children: [
          { path: "/staff", element: <StaffPage /> },
          // more nested routes here
        ],
      },
    ],
  },
];
```

> The app’s root router should aggregate feature route arrays, e.g., `dashboardRoutes`, `staffRoutes`, `studentsRoutes`.

---

## 7) Permission naming rules (keep consistent)

* **Page-level**: `<feature>.view` (gates the screen)
* **Action-level**: `<feature>.create`, `<feature>.edit`, `<feature>.delete`, `<feature>.export`, etc.
* **Ownership variants** (if backend supports): `<feature>.updateOwn` etc. Still apply ABAC filters.

`pageId="<feature>"` must equal the `ui_resources.pages[].id` for that screen.

---

## 8) Checklist every new page must follow

1. Create file under `src/features/<feature>/pages/<Feature>Page.tsx`.
2. Root `<Acl pageId="<feature>" requires={["<feature>.view"]} > … </Acl>`.
3. Wrap content with `<TenantLayout title="…" subtitle="…">`.
4. Gate each control with `<Acl requires={["<feature>.<action>"]}>…</Acl>`.
5. Apply ABAC from `me.membership.attrs` + always set `tenantId` in filters.
6. Call API through `http`; re-fetch on `me.meta.ev` changes.
7. Keep Navbar/Sidebar free of business logic (navigation only).
8. Use **relative imports** (Lovable constraint; no tsconfig path aliases).
9. Don’t render sensitive data in UI (no tokens, only necessary identifiers).

---

## 9) Minimal page template (copy-paste, then rename)

```tsx
// src/features/<feature>/pages/<Feature>Page.tsx
import React from "react";
import TenantLayout from "../../../layouts/TenantLayout";
import { Acl } from "../../../components/auth/Acl";
import { useMe } from "../../../hooks/useMe";
import { http } from "../../../lib/http";
import { mergeFilters, build<Feature>ListFilters } from "../../../lib/abac";

const <Feature>Page: React.FC = () => {
  const { me } = useMe();
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        const base = { tenantId: me?.tenant?.tenantId };
        const abac = build<Feature>ListFilters(me);
        const filter = mergeFilters(base, abac);
        const res = await http.get("/api/v1/<feature>", { params: { filter: JSON.stringify(filter) } });
        if (!cancelled) setRows(res.data.items || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [me?.meta?.ev]);

  return (
    <Acl pageId="<feature>" requires={["<feature>.view"]}>
      <TenantLayout title="<Feature>" subtitle="This is your <feature> workspace">
        {loading && <div>Loading…</div>}
        {error && <div className="text-red-600">{error}</div>}

        {/* Example gated action */}
        {/* <Acl requires={["<feature>.create"]}><button className="btn-primary">Create</button></Acl> */}

        <pre className="text-xs bg-gray-50 p-3 rounded border">{JSON.stringify(rows, null, 2)}</pre>
      </TenantLayout>
    </Acl>
  );
};

export default <Feature>Page;
```

---

## 10) Manual test plan (quick)

1. User **without** `<feature>.view` → `/feature` should render nothing or an access-denied UI.
2. Grant `<feature>.view` only → page shows but gated action buttons remain hidden.
3. Grant `<feature>.create` → create button appears.
4. Reduce `membership.attrs` scope → lists shrink accordingly (ABAC).
5. Update role → bump `me.meta.ev` on backend → page should react (reload, hidden/shown controls).

---

## 11) Common pitfalls we’ve handled

* Buttons visible but not usable → all action controls wrapped in `<Acl>`.
* Cross-tenant leakage → always send `tenantId` and ABAC filters; server re-enforces.
* Stale permissions → UI observes `me.meta.ev`; call `useMe().reload()` on 403 if needed.
* Over-reliance on frontend checks → server is the final authority for RBAC/ABAC.

---

## Save & Reference

* **Save path:** `docs/frontend_rbac_abac_usage.md`
* **How to use in AI context:** Paste this file’s content into the AI prompt context before asking the AI to scaffold a new feature page. Instruct the AI to:

  * create the page under `src/features/<feature>/pages`,
  * wire `src/features/<feature>/routes.tsx`,
  * wrap page with `<Acl>` and `<TenantLayout>`,
  * apply ABAC filters and call APIs via `http`,
  * gate buttons with `<Acl>`.

---
