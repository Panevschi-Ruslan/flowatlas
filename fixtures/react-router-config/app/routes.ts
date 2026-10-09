import { index, layout, prefix, route, type RouteConfig } from '@react-router/dev/routes';
import { flatRoutes } from '@react-router/fs-routes';

/** The whole address space, declared rather than spelled by file names. */
export default [
  index('routes/home.tsx'),
  route('projects/:projectId', 'routes/project.tsx', [route('settings', 'routes/project-settings.tsx')]),
  layout('routes/auth-layout.tsx', [route('login', 'routes/login.tsx')]),
  ...prefix('api', [
    route('projects', 'routes/api/projects.ts'),
    route('projects/:projectId/tasks/:taskId?', 'routes/api/task.ts'),
  ]),
  // The admin pages are spelled by file names under app/admin.
  ...prefix('admin', await flatRoutes({ rootDirectory: 'admin' })),
  // Named here and never written: an address with nothing behind it.
  route('reports', 'routes/reports.tsx'),
] satisfies RouteConfig;
