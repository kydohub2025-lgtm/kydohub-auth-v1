# Kydohub Monorepo Usage Guide (v1.4)

**Purpose:** Give AI assistants (Cursor/ChatGPT) a shared, enforceable playbook so that generated code and file suggestions always match Kydohub's folder structure, multi‑tenant constraints, security practices, and style.

**Scope:** Frontend (React + Vite + TS), Backend (FastAPI + Pydantic + Celery), Shared packages, Infra, Docs, and contributor workflow.

## Golden Rules (TL;DR)

1. **Feature‑first everywhere.** No top‑level pages/. Each feature owns its routes, pages, hooks, components, services, tests, and storybook.

2. **Frontend routing:** Each feature exports its own routes.tsx; a tiny central router stitches them under common layouts/guards.

3. **Backend routing:** One router.py per feature. api/v1/routes.py only includes feature routers.

4. **Tenant isolation is absolute:** Every request, cache key, and query is scoped by tenant context. Guard at layout level (frontend) and dependency level (backend).

5. **Security by default:** Validate input (zod/Pydantic), sanitize outputs, apply RBAC checks in services/routers, and never trust client input.

6. **Keep things co‑located:** Each feature folder should feel self‑contained. Adding/removing a feature is add/remove one folder + one import.

7. **Consistent naming:** kebab-case for folders, PascalCase for React components, snake_case.py for Python modules.

## Monorepo Overview

```
kydohub/
├─ apps/
│  ├─ web/                        # React + Vite + TS (tenant-aware)
│  │  └─ src/
│  │     ├─ features/
│  │     │  └─ students/
│  │     │     ├─ components/
│  │     │     ├─ pages/
│  │     │     ├─ hooks/
│  │     │     ├─ services/
│  │     │     └─ routes.tsx
│  │     ├─ layouts/              # AppLayout, TenantLayout (auth/tenant guards)
│  │     ├─ router/               # central router that stitches feature routes
│  │     ├─ context/              # AuthContext, TenantContext, Theme
│  │     ├─ store/
│  │     ├─ i18n/
│  │     ├─ styles/
│  │     └─ utils/
│  └─ backend/
│     └─ app/
│        ├─ api/
│        │  └─ v1/
│        │     ├─ routes.py       # includes feature routers only
│        │     └─ students/
│        │        ├─ router.py
│        │        ├─ schemas.py
│        │        ├─ service.py
│        │        └─ repo.py      # optional data access layer
│        ├─ core/                 # config, security, db, logging
│        ├─ middleware/           # tenant_context, error handlers
│        └─ utils/
├─ packages/                      # ui, api-client, utils, config
├─ infra/                         # docker, k8s, terraform, monitoring
└─ docs/                          # context, specs, standards, diagrams
```

## Frontend Rules (apps/web)

### Directory Contracts per Feature

Every feature folder must follow this contract:

```
src/features/<feature-name>/
  components/           # Reusable within the feature (dumb components ok)
  pages/                # Full-screen views composed from feature components
  hooks/                # useXyz hooks for this feature only
  services/             # API calls & query fns (axios/react-query)
  routes.tsx            # RouteObject[] for this feature (lazy-loaded)
```

### Central Router

Single source of truth at `src/router/index.tsx`.

Imports `...Routes` arrays from features and nests under AppLayout → TenantLayout.

TenantLayout enforces auth + tenant context; redirects to login on failure.

**Example: src/features/students/routes.tsx**

```typescript
import { lazy } from "react";
import { RouteObject } from "react-router-dom";

const StudentsListPage = lazy(() => import("./pages/StudentsListPage"));
const StudentProfilePage = lazy(() => import("./pages/StudentProfilePage"));

export const studentRoutes: RouteObject[] = [
  { path: "/students", element: <StudentsListPage /> },
  { path: "/students/:id", element: <StudentProfilePage /> },
];
```

**Example: src/router/index.tsx**

```typescript
import { createBrowserRouter } from "react-router-dom";
import { studentRoutes } from "@/features/students/routes";
import AppLayout from "@/layouts/AppLayout";
import TenantLayout from "@/layouts/TenantLayout";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        element: <TenantLayout />, // guards auth + tenant
        children: [
          ...studentRoutes,
          { path: "/", element: <div>Dashboard</div> },
        ],
      },
    ],
  },
]);
```

### Services & Data Layer

Use axios + @tanstack/react-query.

Each feature exposes typed query fns in services/.

All requests include tenant headers or are made to tenant‑scoped endpoints.

```typescript
// src/features/students/services/students.api.ts
import axios from "axios";

export async function getStudents(tenantId: string) {
  const { data } = await axios.get(`/api/v1/students`, {
    headers: { "x-tenant-id": tenantId },
  });
  return data;
}
```

### Hooks

Encapsulate react-query usage and state shaping in hooks/.

```typescript
// src/features/students/hooks/useStudents.ts
import { useQuery } from "@tanstack/react-query";
import { getStudents } from "../services/students.api";

export function useStudents(tenantId: string) {
  return useQuery({
    queryKey: ["students", tenantId],
    queryFn: () => getStudents(tenantId),
  });
}
```

### Components vs Pages

- **components/** are reusable (no routing knowledge, minimal state).
- **pages/** are feature entry screens that compose components and call hooks.

### State Management & Context

- Global auth + tenant context lives in `src/context/`.
- Per‑feature state uses hooks or local store (Zustand) inside feature folder.

### Styling

Tailwind for layout and utilities; shared design tokens in packages/ui as needed.

### Testing

Unit tests colocated with files (`*.test.ts(x)`), or `__tests__/` per feature.

Keep tests feature‑local. Avoid cross‑feature imports in tests.

## Backend Rules (apps/backend)

### Router Per Feature

```
app/api/v1/
  routes.py             # includes routers only
  <feature>/
    router.py
    schemas.py
    service.py
    repo.py             # optional DAO; use if logic grows
```

**Example: app/api/v1/students/router.py**

```python
from fastapi import APIRouter, Depends
from .schemas import StudentCreate, StudentOut
from ...core.security import require_tenant
from .service import list_students, get_student, create_student

router = APIRouter(prefix="/students", tags=["students"])

@router.get("/", response_model=list[StudentOut])
async def _list(tenant=Depends(require_tenant)):
    return await list_students(tenant)

@router.get("/{student_id}", response_model=StudentOut)
async def _get(student_id: str, tenant=Depends(require_tenant)):
    return await get_student(tenant, student_id)

@router.post("/", response_model=StudentOut, status_code=201)
async def _create(payload: StudentCreate, tenant=Depends(require_tenant)):
    return await create_student(tenant, payload)
```

**Example: app/api/v1/routes.py**

```python
from fastapi import APIRouter
from .students.router import router as students_router
from .staff.router import router as staff_router
from .rooms.router import router as rooms_router

api_v1 = APIRouter()
api_v1.include_router(students_router)
api_v1.include_router(staff_router)
api_v1.include_router(rooms_router)
```

### Core & Middleware

- **core/config.py** for env loading.
- **core/security.py** for JWT, RBAC, rate limiting, and require_tenant dependency.
- **middleware/tenant_context.py** to resolve tenant from header/JWT and inject into request state.

### Services & Repos

- Business rules in **service.py**.
- DB access isolated in **repo.py** (optional until needed).

### Schemas

Pydantic request/response models live in **schemas.py**.

Validate everything and keep boundary contracts explicit.

### Observability

- **core/logging.py** sets structured logs and OTEL init.
- Return traceparent where applicable.

## Shared Packages (packages/*)

- **ui/**: cross‑app React components; publish as internal workspace package.
- **api-client/**: typed client for backend; used by apps/web.
- **utils/**: shared helpers (dates, currency, validation).
- **config/**: enums, constants, and cross‑app types.

**Rule:** Feature code in apps/* should not import other features directly—use shared packages if cross‑cutting.

## Naming & Conventions

- **Folders:** kebab-case (attendance-tracker).
- **Files:** React components PascalCase.tsx; hooks useXyz.ts.
- **Python modules:** snake_case.py.
- **Tests:** mirror file names, e.g., StudentList.test.tsx, test_router.py.
- **Commits:** Conventional Commits (feat:, fix:, chore:, docs:, refactor:).

## Security & Multi‑Tenant Defaults

- **Frontend:** All protected routes are children of TenantLayout, which fetches/validates tenant context and injects tenantId via context/provider.
- **Backend:** All feature routers use Depends(require_tenant). Repositories must filter by tenant_id.
- Never accept tenantId from the client body as trust; prefer server‑derived tenant from JWT/session and cross‑check.

## Assistant Playbook (What to Generate by Default)

When I ask for a new feature (e.g., "Attendance Tracker"), generate:

### Frontend

- `src/features/attendance/` with components/, pages/, hooks/, services/, routes.tsx.
- One list page + one detail page in pages/.
- `services/*.api.ts` with axios calls that set x-tenant-id header.
- `hooks/useAttendance.ts` wrapping react-query.
- Expose attendanceRoutes with lazy imports.

### Backend

- `app/api/v1/attendance/router.py`, schemas.py, service.py, repo.py.
- Endpoints: list, get, create (and others if specified), all guarded by require_tenant.

### Tests

- **Frontend:** component test for list page; hook test if applicable.
- **Backend:** router tests with tenant guard and repo mocks.

### Docs

Brief addition to `docs/features/attendance_tracker/` with prd.md + backend_spec.md + frontend_spec.md (if I ask for docs).

Paths and filenames must follow this guide exactly.

## Minimal Stubs (Copy‑Ready)

### Frontend page stub

```typescript
// src/features/<feature>/pages/<Feature>ListPage.tsx
import { Suspense } from "react";
import { use<FeaturePlural> } from "../hooks/use<FeaturePlural>";

export default function <Feature>ListPage() {
  const { data, isLoading } = use<FeaturePlural>("TENANT_ID_FROM_CONTEXT");
  if (isLoading) return <div>Loading…</div>;
  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold mb-4"><Feature> List</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

### Backend router stub

```python
# app/api/v1/<feature>/router.py
from fastapi import APIRouter, Depends
from .schemas import <Feature>Create, <Feature>Out
from ...core.security import require_tenant
from .service import list_<feature_plural>, get_<feature>, create_<feature>

router = APIRouter(prefix="/<feature_plural>", tags=["<feature>"])

@router.get("/", response_model=list[<Feature>Out])
async def _list(tenant=Depends(require_tenant)):
    return await list_<feature_plural>(tenant)

@router.get("/{item_id}", response_model=<Feature>Out)
async def _get(item_id: str, tenant=Depends(require_tenant)):
    return await get_<feature>(tenant, item_id)

@router.post("/", response_model=<Feature>Out, status_code=201)
async def _create(payload: <Feature>Create, tenant=Depends(require_tenant)):
    return await create_<feature>(tenant, payload)
```

## Workflow Tips

- New feature = one folder frontend + one folder backend + route inclusion.
- If a feature grows cross‑cutting concerns, extract to packages/*.
- Keep PRs focused per feature; CI runs lint/test/build on changed workspaces.

## What Not To Do

- ❌ Don't add a top‑level pages/ in frontend.
- ❌ Don't put endpoints directly in api/v1/routes.py.
- ❌ Don't bypass TenantLayout or require_tenant guards.
- ❌ Don't share state between features outside of packages/*.

---

**End of guide.**

This document serves as the single source of truth for project structure and should be referenced for all feature development.
