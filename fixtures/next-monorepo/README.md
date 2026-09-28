# next-monorepo

One service whose code is in two directories, which is what R96 turned out to be
about.

`apps/web` is a Next.js application and a member of the workspace this fixture's
root declares. It answers `GET /api/orders` and `POST /api/orders`, and neither
handler does any work of its own: both call `@next-monorepo/orders-lib`, a
sibling member under `packages/`. That is the ordinary shape of a monorepo — the
addresses in the application, the bodies in the packages — and until R96 it was
the shape the tool could only ever read half of. Pointed at `apps/web` it found
the routes and nothing behind them, because the package's files were opened only
so that types would resolve and then excluded from every walk for being outside
the directory the manifest was in. Pointed at the root it found the packages and
no way in, because the root has no `app/` directory.

So what to watch here is not the two routes. It is that
`../../packages/orders-lib/src/index.ts:listOrders` is in the graph with an edge
into it from the route and an edge out of it into `store.ts:readOrders`. All
three of those facts used to be missing at once, and the middle one was the
misleading part: before the fix the function did appear, because a call target
gets a node whether or not anybody read it, and it appeared under the absolute
path of whichever machine ran the tool.

The path is relative to the service and climbs out of it, because the service is
`apps/web` and that is where every other path in its graph is measured from. A
file one package over is named as being one package over.

`store.ts` reads a setting and makes a request out of the process, and those two
are the part that proves the body was *read*. A call target gets a node whether
anybody opened its body or not — that is why the function appeared before the fix
— but a setting and an outbound call are only found by walking a body. The two
rows the request produces, one saying no configured service serves `GET /orders`
and one saying nothing declares `ORDERS_UPSTREAM_URL`, are both true of this
fixture and are the shape a real repository's outbound call has when the far side
is not in the configuration.

There is no `node_modules` here. `apps/web`'s tsconfig maps the package name to
the file, which is how a monorepo that builds with a bundler usually spells it,
and it also makes the point that the extent is read from the workspace rather
than from what happens to be installed.
