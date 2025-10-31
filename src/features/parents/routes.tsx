import { lazy } from 'react';
import { RouteObject } from 'react-router-dom';

const ParentsPage = lazy(() => import('./pages/ParentsPage'));

export const parentRoutes: RouteObject[] = [
  { path: '/parents', element: <ParentsPage /> },
];
