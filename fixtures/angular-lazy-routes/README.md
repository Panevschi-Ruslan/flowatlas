# angular-lazy-routes

The shapes a real Angular route configuration is written in, none of which is a
`const routes: Routes` passed straight to the router.

| Shape | Where | Expected |
|---|---|---|
| `export default [ … ] satisfies Routes` | `src/app/app.routes.ts` | read as a configuration, with no annotation on the array |
| `provideRouter(routes)` on a default import | `src/main.ts` | the root of the tree |
| `loadChildren: () => import('./admin/routes')` | `src/app/app.routes.ts` | followed to the module's default export, mounted under `/admin` |
| `{ ...common, path: 'settings' }` | `src/app/admin/routes.ts` | `path` read through the spread, and the property written after it wins |
| `children: [...settingsRoutes]` | `src/app/admin/routes.ts` | the spread array spliced in under `/admin/settings` |
| `loadChildren: () => import('./reports.module').then((m) => m.ReportsModule)` | `src/app/admin/routes.ts` | followed to `RouterModule.forChild` in that module, mounted under `/admin/reports` |

So the links in `shell.component.ts` reach their screens:
`/admin/settings` → `AdminShellComponent`, `/admin/settings/plugins` →
`PluginsComponent`, `/admin/reports/weekly` → `ReportsComponent`. `/nowhere`
still reports `route-target-unresolved`, which is the finding this reader exists
to make.

The two bindings on `hide` and `dialog` are names the template itself bound — a
`let-` context field and a `#ref` — so neither is reported as a method
`ShellComponent` is missing. `rename()` is, because it is one.
