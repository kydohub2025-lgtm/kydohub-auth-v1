# Project Structure Overview

This project follows the **Kydohub feature-first architecture** guidelines. All code is organized by feature, not by technical layer.

## Key Principles

✅ **Feature-first everywhere** - Each feature owns its routes, pages, hooks, components, and services  
✅ **No top-level pages/** - Pages belong inside feature folders  
✅ **Central router** - Single router at `src/router/index.tsx` stitches feature routes  
✅ **Tenant isolation** - All protected routes wrapped in `TenantLayout`  
✅ **Lazy loading** - Features use React lazy imports for code splitting

## Directory Structure

```
src/
├── features/               # Feature-first organization
│   ├── auth/              # Authentication feature
│   │   ├── pages/         # LoginPage, SignupPage
│   │   └── routes.tsx     # Auth routes export
│   ├── dashboard/         # Dashboard feature
│   │   ├── pages/         # DashboardPage
│   │   └── routes.tsx
│   ├── students/          # Students management
│   │   ├── pages/         # StudentsPage
│   │   ├── components/    # (future) Student-specific components
│   │   ├── hooks/         # (future) useStudents, etc.
│   │   ├── services/      # (future) API calls
│   │   └── routes.tsx
│   ├── staff/             # Staff management
│   ├── parents/           # Parent management
│   └── settings/          # Settings feature
│
├── components/            # Shared/global components only
│   ├── ui/               # shadcn components
│   ├── layouts/          # AppLayout, TenantLayout
│   ├── Sidebar.tsx
│   └── Navbar.tsx
│
├── context/              # Global contexts (singular!)
│   ├── AuthContext.tsx
│   └── TenantContext.tsx
│
├── router/               # Central routing
│   └── index.tsx         # Main router configuration
│
├── hooks/                # Global hooks only
├── lib/                  # Utilities
├── styles/               # Global styles
└── pages/                # ONLY for non-feature pages (e.g., NotFound)
    └── NotFound.tsx
```

## How Routing Works

1. **Feature routes** are defined in each feature's `routes.tsx` file:
   ```typescript
   // src/features/students/routes.tsx
   export const studentRoutes: RouteObject[] = [
     { path: '/students', element: <StudentsPage /> },
   ];
   ```

2. **Central router** (`src/router/index.tsx`) imports and combines all feature routes:
   ```typescript
   import { studentRoutes } from '@/features/students/routes';
   
   export const router = createBrowserRouter([
     {
       element: <AppLayout />,
       children: [
         ...authRoutes,  // Public routes
         {
           element: <TenantLayout />,  // Protected routes wrapper
           children: [
             ...studentRoutes,
             ...staffRoutes,
             // etc.
           ]
         }
       ]
     }
   ]);
   ```

3. **App.tsx** simply uses the router:
   ```typescript
   <RouterProvider router={router} />
   ```

## Adding a New Feature

When adding a new feature (e.g., "Attendance"):

1. **Create the feature folder:**
   ```
   src/features/attendance/
   ├── pages/
   │   └── AttendancePage.tsx
   ├── components/       # (optional)
   ├── hooks/           # (optional)
   ├── services/        # (optional)
   └── routes.tsx
   ```

2. **Create the routes file:**
   ```typescript
   // src/features/attendance/routes.tsx
   import { lazy } from 'react';
   import { RouteObject } from 'react-router-dom';
   
   const AttendancePage = lazy(() => import('./pages/AttendancePage'));
   
   export const attendanceRoutes: RouteObject[] = [
     { path: '/attendance', element: <AttendancePage /> },
   ];
   ```

3. **Register in central router:**
   ```typescript
   // src/router/index.tsx
   import { attendanceRoutes } from '@/features/attendance/routes';
   
   // Add to children array:
   ...attendanceRoutes,
   ```

4. **Update sidebar** (if needed):
   ```typescript
   // src/components/Sidebar.tsx
   { title: 'Attendance', path: '/attendance', icon: CheckSquare }
   ```

## Important Notes

- **Context folder is singular** (`context/` not `contexts/`)
- **Feature isolation**: Features should not import from other features
- **Shared code**: Put truly shared code in `/components`, `/hooks`, or `/lib`
- **Pages folder**: Only for non-feature pages like NotFound
- **Lazy loading**: All feature pages use React.lazy() for better performance
- **Layout guards**: 
  - `AppLayout` - minimal wrapper for public pages
  - `TenantLayout` - auth + tenant guard for protected routes

## Migration Notes

This structure was refactored from the original pages-based structure to follow Kydohub guidelines. Old pages have been moved to appropriate feature folders.

---

**For full guidelines, see:** [kydohub-structure-guide.md](./kydohub-structure-guide.md)
