# angular-basic fixture

One Angular repository, holding each construct the extractor has a rule for
exactly once: a standalone component and two a module declares, three more a
route loads rather than names, every kind of trigger a template can carry,
injection through a constructor and through a field, five requests covering
every way an address can be read, and the two annotations.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/angular-basic/tsconfig.json --noEmit
```

Extracted, from the repository root:

```
pnpm flowatlas extract fixtures/angular-basic
```

The repository carries its own `flowatlas.config.json`, which is where
`apiBaseEnv: ["apiUrl"]` comes from. Without it every address rooted at
`environment.apiUrl` would still be read, and would also be reported as a
settings key nobody configured.

## Components

| Class | File | Template | Node |
|---|---|---|---|
| `CheckoutComponent` | `src/app/checkout.component.ts` | inline | `ui_component` `kind: standalone`, `meta.standalone: true` |
| `OrdersListComponent` | `src/app/orders-list.component.ts` | `./orders-list.component.html` | `ui_component` `kind: declared`, `meta.module: "OrdersModule"` |
| `LegacyPanelComponent` | `src/app/legacy-panel.component.ts` | missing on purpose | `ui_component`, one `template-not-found` |
| `SettingsComponent` | `src/app/settings.component.ts` | inline | loaded, not named — see Routes |
| `ReportsComponent` | `src/app/reports.component.ts` | inline | the same, exported as the module's default |
| `ProfileComponent` | `src/app/profile.component.ts` | inline | the same, reached through `await` |

Whether a component is standalone is read from the module that declares it, not
from its own `standalone` flag: the framework refuses to declare a standalone
component, and the flag's default has changed between versions.

`OrdersModule` declares two components, imports `SharedModule` and lists
`AuthService` in `providers`, which becomes `meta.providers` on the module node
rather than an edge. Provider scoping does not change which code reaches which.

## Triggers — one row per `ui_action`

Positions of a trigger written inline are offset into the component file, so an
id points at the line a reader will find it on.

| Written | Kind | `handles` | Note |
|---|---|---|---|
| `(ngSubmit)="save(form)"` | `submit` | `CheckoutComponent.save` | `ngSubmit` and `submit` are the same kind |
| `(change)="onChange($event)"` | `change` | `CheckoutComponent.onChange` | `meta.args: ["$event"]` |
| `(input)="onInput($event)"` | `input` | `CheckoutComponent.onInput` | |
| `(keyup.enter)="submit()"` | `keyup` | `CheckoutComponent.submit` | one event name, not two |
| `(click)="submit()"` | `click` | `CheckoutComponent.submit` | |
| `(click)="orders.refresh()"` | `click` | `OrdersApiService.refresh` | the handler is on an injected service |
| `(click)="sumbit()"` | `click` | — | `handler-not-found`, the hint names the class |
| `(click)="open = !open"` | `click` | — | `handler-not-a-method`, an assignment names none |
| `routerLink="/orders/:id"` | `route` | — | `triggers` → `OrdersListComponent`, from `app.routes.ts` |
| `routerLink="/settings"` | `route` | — | `triggers` → `SettingsComponent` |
| `routerLink="/reports"` | `route` | — | `triggers` → `ReportsComponent` |
| `routerLink="/profile"` | `route` | — | `triggers` → `ProfileComponent` |
| `routerLink="/archive"` | `route` | — | none, and one `route-screen-unread` |
| `ngOnInit` | `lifecycle` | `CheckoutComponent.ngOnInit` | the framework is the caller |
| `(click)="reload()"` in the `@if` block of `orders-list.component.html` | `click` | `OrdersListComponent.reload` | a block is walked like anything else |

## Routes — how a link finds its screen

`app.routes.ts` writes the same fact six ways, and four of them are readable.

| Written | Screen | Why |
|---|---|---|
| `component: CheckoutComponent` | `CheckoutComponent` | named outright |
| `component: OrdersListComponent` | `OrdersListComponent` | the same, with a parameter in the path |
| `loadComponent: () => import('./settings.component').then((m) => m.SettingsComponent)` | `SettingsComponent` | the module is a literal and the export is a property read, so the checker settles both |
| `loadComponent: () => import('./reports.component')` | `ReportsComponent` | no export named, so the module's default is the screen |
| `loadComponent: async () => (await import('./profile.component')).ProfileComponent` | `ProfileComponent` | the same property read, awaited instead of chained |
| `loadComponent: () => import(page('archive')).then((m) => m.ArchiveComponent)` | — | the specifier is a value, so no module was named |

Loading a screen is not less static than naming one: `/settings` produces the
same `triggers` edge at the same `static` confidence as `/orders/:id`. The last
route is the case that must not be guessed — it leaves one
`route-loader-unread` where it is configured, and the link to it leaves one
`route-screen-unread` rather than claiming no route answers `/archive`.

## Requests — one row per `ui_api_call`

Every one of them is in `src/app/orders-api.service.ts`.

| Written | `meta.method` / `path` | `baseUrlEnv` | `via` | Types |
|---|---|---|---|---|
| `post<OrderDto>(\`${environment.apiUrl}/orders\`, body)` | `POST /orders` | `apiUrl` | `template-env` | `responseType` `OrderDto`, `bodyType` `CreateOrderDto` |
| `get<OrderDto[]>(API_ROUTES.orders)` | `GET /orders` | — | `const` | `responseType` `OrderDto[]` |
| `delete<void>(\`${environment.apiUrl}/orders/${id}\`)` | `DELETE /orders/:param` | `apiUrl` | `template-env` | — |
| `get<unknown>(this.base + path)` | `GET`, `path: null` | — | — | one `api-path-dynamic` |
| `/** @flowatlas-calls PATCH /orders/:id/status */` | `PATCH /orders/:param/status` | `apiUrl` | `marker` | — |

The address of the fourth is put together at run time, which is exactly the case
the annotation on `updateStatus` exists for (I10). The annotation is only used
where reading the source cannot answer: an annotation naming a request already
read from the source is dropped rather than duplicated.

`@flowatlas-consumes order.updated` on `onOrderUpdated` produces
`channel:order.updated -consumes-> consumer -handles-> method`, all three at
`marker` confidence. It stands in for the SSE stream the real project subscribes
to, which no static reading can name.

## Injection

| Written | Edge |
|---|---|
| `constructor(private readonly http: HttpClient)` | `injects` → `node_modules/@angular/common:HttpClient` |
| `constructor(readonly orders: OrdersApiService)` | `injects` → `OrdersApiService` |
| `private readonly auth = inject(AuthService)` | `injects` → `AuthService`, `meta.via: "field-inject"` |
| `@Inject(API_KEY) private readonly apiKey: string` | none, and one `inject-token-unresolved` |

An `InjectionToken` is not a class, so there is nothing to point at. The row is
informational and expected; it is recorded rather than dropped so that a reader
looking for the edge finds out why there is none.

## Expected `unresolved`

Exactly seven rows, and nothing else:

```
api-path-dynamic          1   the address built at run time
handler-not-a-method      1   the assignment, which names no method
handler-not-found         1   the typo
inject-token-unresolved   1   the InjectionToken
route-loader-unread       1   the loader whose specifier is a value
route-screen-unread       1   the link to the route that loader configures
template-not-found        1   the missing templateUrl
```

## `node_modules` in this fixture

Nothing is installed. `@angular/core`, `@angular/common/http`, `@angular/router`
and `rxjs` are hand-written stubs holding only the declarations the extractor
reads. `@angular/common/http` is a subpath of `@angular/common`, so a receiver
declared there belongs to the package `@angular/common`, which is why the
extractor recognises the client by its type name as well as its package.
