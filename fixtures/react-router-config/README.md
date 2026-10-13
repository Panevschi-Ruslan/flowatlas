# react-router-config fixture

A React Router v7 repository whose routes are declared in `app/routes.ts`
rather than spelled by file names (P43). Each module the config names is read
the way a Remix route module is: a `loader` answers GET, an `action` POST, or the
verbs it compares `request.method` to.

Type-checked, never executed. `node_modules` holds hand-written
`@react-router/dev`, `@react-router/fs-routes` and `react-router` stubs.

```
index('routes/home.tsx')                          a page, no way in
route('projects/:projectId', 'routes/project.tsx')
                                                  loader -> GET /projects/:projectId
  route('settings', 'routes/project-settings.tsx')
                                                  action -> POST /projects/:projectId/settings
layout('routes/auth-layout.tsx', [...])           adds no segment
  route('login', 'routes/login.tsx')              action -> POST /login
...prefix('api', [...])
  route('projects', 'routes/api/projects.ts')     loader, action -> GET, POST /api/projects
  route('projects/:projectId/tasks/:taskId?', 'routes/api/task.ts')
                                                  loader -> GET, action -> DELETE
...prefix('admin', await flatRoutes({ rootDirectory: 'admin' }))
  app/admin/_index.tsx                            a page, no way in
  app/admin/projects.$projectId.ts                loader -> GET /admin/projects/:projectId
route('reports', 'routes/reports.tsx')            no such file: a route-module-not-found row
```

`flatRoutes()` (P48) reads the directory it names - `routes` by default -
by Remix's flat convention, under the address it sits at.

Each entry keeps the configured path as `rawPath`, so a handler's params are
named by the config.
