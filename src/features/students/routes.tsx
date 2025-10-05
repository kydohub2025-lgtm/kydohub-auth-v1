import { lazy } from 'react';
import { RouteObject } from 'react-router-dom';

const StudentsPage = lazy(() => import('./pages/StudentsPage'));

export const studentRoutes: RouteObject[] = [
  { path: '/students', element: <StudentsPage /> },
];
