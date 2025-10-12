import { lazy } from 'react';
import { RouteObject } from 'react-router-dom';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));

export const dashboardRoutes: RouteObject[] = [
  { path: '/dashboard', element: <DashboardPage /> },
];
