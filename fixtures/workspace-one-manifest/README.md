# workspace-one-manifest

A workspace that keeps one manifest for everything, as a Nest CLI monorepo does
(R180): `package.json` and `tsconfig.json` at the root, two applications under
`apps/` and a library under `libs/`, none of them with a manifest of its own.
`nest-cli.json` lists the three projects; each project's tsconfig extends the
root's, which aliases the library as `@shop/order-events`.

`flowatlas.config.json` is what `flowatlas link apps/shop apps/orders` writes,
trimmed to its services. Before R180 `link` refused both directories ("has no
package.json"), and a service configured by hand was read with no manifest, so
no NestJS adapter was switched on and the library was never read.

| Expected | Why |
|---|---|
| `shop` and `orders`, each `nestjs` | each is an application of the workspace: a tsconfig of its own that extends the root's; named as `nest-cli.json` names it, typed by the root's manifest |
| `POST /checkout` in `shop` reaches `OrderEvents.placed` in `../../libs/order-events/src` | `shop` imports `@shop/order-events`, so the library is part of the service and its code is walked |
| `channel:order.placed` joined: published from `shop` (through the library), consumed in `orders` | the join across the two applications |
| no node of the library in `orders` | `orders` imports the library's types only (`import type`), which the compiler erases, so the library is not part of it and its publisher is not attributed to `orders` |
| the type `OrderPlaced`, and the payload contract `unchecked` | the type is registered under the workspace's package, the nearest manifest, as a workspace member's type is; a type of a package is compared only when `sharedPackages` names it, so the payload of `order.placed` is said as unchecked rather than compared |

The `@nestjs/*` stubs come from `fixtures/node_modules`, as for every NestJS
fixture.
