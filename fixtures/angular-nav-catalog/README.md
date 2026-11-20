# angular-nav-catalog

An Angular application whose pages are reached through a sidebar rendered from a
constant catalog, and one page reached through nothing but its address (P363).

| Shape | Where | Expected |
|---|---|---|
| a lazily loaded standalone page under the shell's `children` | `src/app/app.routes.ts` (`star-map`) | an entry `entry:<service>:screen:/star-map`, `StarMapComponent` behind it |
| a named page behind a functional guard | `src/app/app.routes.ts` (`telescopes`) | the screen's entry lists `canActivate observerGuard` |
| a routed page no template links to | `src/app/app.routes.ts` (`archive`) | the screen `/archive`: `dead` says it is alive, routed, and that no link to it was read |
| a file of routes mounted by `loadChildren` | `src/app/settings/settings.routes.ts` | the screen `/settings/profile` |
| `@for (item of items(); track …) { <a [routerLink]="item.route"> }` over `computed(() => NAV_CATALOG.filter(…))` | `src/app/layout/sidebar.component.html` | one `triggers` edge per catalog entry, to `StarMapComponent` and `TelescopesComponent` |
| `*ngFor="let link of section.links"` inside `*ngFor="let section of sections()"`, `routerLink="{{ link.route }}"` | same | the nested loop read through the section's `links`, the same two screens |
| `(click)="router.navigate([entry.route])"` over a getter mapping `PINNED` | same | lands on `ProfileComponent` |
| the catalog's `/calibration`, which no route answers | `src/app/layout/nav-catalog.ts` | `route-target-unresolved` for each link rendered over it, naming the address |
| `@for (item of remote$ \| async; …)` | same | `route-link-dynamic`, saying the list is not read |

The shell is a screen too, at `/`. The `**` route only redirects, so it shows no
component and is no screen.
