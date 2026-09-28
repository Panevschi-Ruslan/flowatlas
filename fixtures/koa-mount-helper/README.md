# koa-mount-helper fixture

Koa applications mounted inside another by a helper, which is how a wiki app mounts
five of them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/koa-mount-helper/tsconfig.json --noEmit
```

`node_modules` holds hand-written stubs for `koa`, `@koa/router` and `koa-mount`.

## The shape

```ts
export default function init(app: Koa = new Koa()) {
  app.use(mount('/api', api));    // a described helper, given a prefix
  app.use(underFlag(admin));      // a helper nobody described, and nobody can
  app.use(mount(pages));          // the described helper, handed the application alone
  app.use(healthRouter.routes()); // an install this has always read
}
```

`koa-mount` hands back middleware. The argument `use` receives is therefore not
an application, and the one thing that separates a mount from a middleware
install on this framework's row is whether what is handed over is an application.
So the line read as an install, the prefix was dropped, and every route on `api`
kept the address it is written at: `POST /documents.info` for what the service
serves at `POST /api/documents.info`. On a wiki app that was 253 of its 257 routes,
with no row anywhere to say so (R84).

The first fix was to stop publishing the address: such a mount became a mount
with no readable path, which put the routes under it through the sentence the
reader already had — *mounted somewhere this cannot read*. That is a missing
address instead of a wrong one, and it cost a wiki app 224 addresses.

## How it is described (R110)

The prefix is in the call. What is not in the call is which argument it is, and
that is a fact about one published package rather than about Koa or about
anything a reader could work out — so it is one record in `MOUNT_HELPERS`, beside
the four framework descriptions and keyed by the package the helper is imported
from:

```ts
['koa-mount', { appAt: -1, pathAt: 0 }]
```

Two positions and no condition. `mount(prefix, app)` and `mount(app)` are both
covered by them, because the application is the last argument either way and the
prefix's position holding the application *is* the answer for the second form:
the helper mounts it at its parent's base. Both forms are written here, because
A wiki app writes both.

Keyed by the package and not by the name, because the name belongs to the
importer: a wiki app writes `import mount from 'koa-mount'`, and the next repository
may write anything.

## What is read

| Site | Read as |
|---|---|
| `healthRouter`, installed on the application directly | `GET /health` |
| `documentsRouter.post('/documents.info', …)` under `mount('/api', api)` | `POST /api/documents.info` |
| `documentsRouter.post('/documents.list', …)` | `POST /api/documents.list` |
| `pagesRouter.get('/pages.list', …)` under `mount(pages)` | `GET /pages.list` |
| `adminRouter.get('/users.list', …)` under `underFlag(admin)` | a row: mounted somewhere this cannot read |

## The application is a parameter, as a wiki app's is

The prefix on its own places nothing. `init(app: Koa = new Koa())` is how a wiki app's
web service declares the application all five mounts hang from, and the reader
walked a `const`'s value and a property's and not a parameter's — so the mount was
followed to an application whose own base was unknowable, and every route under it
stayed unplaceable with the prefix in hand.

A wiki app starts its services through a map of dynamic imports, so no call to that
function can be followed from anywhere in the repository: the default is the only
statement there is about what `app` is, and it is the same kind of statement a
`const` makes. It is also strictly better evidence than what the reader did
before, which was to assume the root of the service wherever the repository moved
no application at all.

A caller handing in a sub-application instead would make the default the wrong
answer. A caller who writes `= new Koa()` has said this function may own the
application, and where it is served is then read from the mounts as usual.

## A helper nobody described

`underFlag` is three lines of this repository, and no record of it could exist:
`MOUNT_HELPERS` holds published packages, and the next repository's helper will
be three different lines. So it stands here for every helper the tool has no row
for, and it keeps the reading it had before any row existed — the application is
found among the arguments, the mount has no path, and the route under it is
reported rather than recorded at an address nothing serves.

What changed for it is the row's hint. It used to ask the reader to mount the
application at a literal path, which is what a wiki app had done all along; it now
names the call the path is inside, because that is the one fact that makes the
row something to act on.

## And one row for the reading as a whole

Four of the five routes here are placed and one is not, so the reader also writes
a row saying exactly that: `entry-http-routes-unplaced`, four of five. Until R121
it wrote nothing — the row it had asked whether the count was zero, so a reading
that placed some of the routes and none of the rest looked like a reading of a
repository that had only the ones it placed (R91). One unplaceable route out of
five is a fixture; three hundred and thirty-seven out of three hundred and forty
is a real repository, and the sentence has to be the same one.
