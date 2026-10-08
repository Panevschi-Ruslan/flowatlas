import { index, layout, prefix, route, type RouteConfig } from '@react-router/dev/routes';

/** The whole address space, declared rather than spelled by file names. */
export default [
  index('routes/home.tsx'),
  route('projects/:projectId', 'routes/project.tsx', [route('settings', 'routes/project-settings.tsx')]),
  layout('routes/auth-layout.tsx', [route('login', 'routes/login.tsx')]),
  ...prefix('api', [
    route('projects', 'routes/api/projects.ts'),
    route('projects/:projectId/tasks/:taskId?', 'routes/api/task.ts'),
  ]),
] satisfies RouteConfig;
