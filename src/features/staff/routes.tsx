import { lazy } from 'react';
import { RouteObject } from 'react-router-dom';

const StaffPage = lazy(() => import('./pages/StaffPage'));

export const staffRoutes: RouteObject[] = [
  { path: '/staff', element: <StaffPage /> },
];
