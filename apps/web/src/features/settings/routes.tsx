import { lazy } from 'react';
import { RouteObject } from 'react-router-dom';

const SettingsPage = lazy(() => import('./pages/SettingsPage'));

export const settingsRoutes: RouteObject[] = [
  { path: '/settings', element: <SettingsPage /> },
];
