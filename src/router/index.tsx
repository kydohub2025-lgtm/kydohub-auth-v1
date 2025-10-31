import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { TenantLayout } from '@/components/layouts/TenantLayout';
import { featureRoutes as authRoutes } from '@/features/auth/routes';
import { featureRoutes as dashboardRoutes } from '@/features/dashboard/routes';
import { featureRoutes as studentRoutes } from '@/features/students/routes';
import { featureRoutes as staffRoutes } from '@/features/staff/routes';
import { parentRoutes } from '@/features/parents/routes';
import { settingsRoutes } from '@/features/settings/routes';
import NotFound from '@/pages/NotFound';

export const router = createBrowserRouter([
  {
    element: (
      <AppLayout>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
          <Outlet />
        </Suspense>
      </AppLayout>
    ),
    children: [
      // Public routes (auth)
      ...authRoutes,
      
      // Protected routes
      {
        element: (
          <TenantLayout>
            <Suspense fallback={<div>Loading...</div>}>
              <Outlet />
            </Suspense>
          </TenantLayout>
        ),
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          ...dashboardRoutes,
          ...studentRoutes,
          ...staffRoutes,
          ...parentRoutes,
          ...settingsRoutes,
        ],
      },
      
      // 404
      { path: '*', element: <NotFound /> },
    ],
  },
]);
