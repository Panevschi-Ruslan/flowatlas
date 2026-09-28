# medusa-fs-router fixture

A repository whose routes are declared by where its files are, read by the
reading every file-system router in this tool shares — Medusa v2 in miniature.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/medusa-fs-router/tsconfig.json --noEmit
```

`node_modules` holds a hand-written `@medusajs/framework` stub, so the types
resolve and the reader is turned on in earnest.

## The shape

```
src/api/admin/orders/route.ts        GET, POST (POST built by a local wrapper)
src/api/admin/orders/[id]/route.ts   GET, HEAD (HEAD is an alias of GET)
src/api/admin/dead/route.ts          no verb this can read
src/api/store/products/route.ts      GET, POST
src/api/store/_helpers/route.ts      served by nothing
src/api/store/(group)/route.ts       GET, at /store/(group)
src/api/hooks/[provider]/route.ts    POST, built by a call of a package
src/api/middlewares.ts               the declarative list
```

## What it holds the tool to (R91)

**One reading, two routers.** `express-fs-router`, next door, is the repository
this convention used to look like from in here: a dependency the tool recognises,
no route registered by any call, and a row saying so. That row is still the right
answer for a convention nobody has described. This fixture is the other half —
the convention described, so the routes are read.

What makes the two file-system routers one thing is that they disagree about four
values and nothing else: the root directory, which file names declare a route,
what prefix stands in front, and which segment spellings the router honours. So
this framework's router is a row of data in `medusa-routes.ts` beside the other's
in `nextjs-paths.ts`, and the walk, the verb reading and the rows for a verb with
nothing behind it are in `fs-routes.ts` and shared.

Four of the files above exist to keep that honest:

- `store/(group)/route.ts` answers at **`/store/(group)`**. The other router reads
  a bracketed directory as a group that drops out of the address and would serve
  it at `/store`. This one has no such rule. A single reading with a per-router
  list of spellings is the only way both can be true; two implementations would
  agree here today and disagree the first time either was touched (R115).
- `store/_helpers/route.ts` is served at **no address at all**. This is the one
  spelling the two routers agree on, and they arrived at it independently.
- `admin/dead/route.ts` produces `route-verb-unread`, and
  `hooks/[provider]/route.ts` produces `route-handler-unread`: a way in whose
  body is in a package is a hole in the coverage of that one route, and the row
  is what makes the summary readable (R94). Both rows come from the shared
  reading, so the two frameworks cannot drift on what counts as read.

## What stands in front of a route

`middlewareRead` is `false` on every entry, deliberately. Three things guard a
route here: the entries of the declarative list, the framework's own
authentication of its `/admin` and `/store` namespaces, and an `AUTHENTICATE`
export in a route file that switches the second off. This reader reads the first,
so it says it did not read them all, and the audit lists such a route as
something to check by hand rather than as a route with a hole in front of it.

The list itself asserts four things: a spread of a list declared in another file
(which is how the real application writes all eighty-four of its slices), both
spellings of the verbs an entry covers (`method` and `methods`), an entry that
installs nothing — left out, because a route whose only entry names no function
must read the same as a route with no entry — and a matcher written as a regular
expression, which cannot be turned into a test on an address and so gets a row
rather than a claim.
