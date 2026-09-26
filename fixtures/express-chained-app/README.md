# express-chained-app fixture

An application declared by a chain, which is how PeerTube declares its one
application and what cost PeerTube every route it has.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/express-chained-app/tsconfig.json --noEmit
```

`node_modules` holds a hand-written `express` stub. It is the suite's usual one
with `disable(name: string): this` added, because that method returning the
application is the whole of what makes the line below legal.

## The shape

```ts
const app = express().disable('x-powered-by');

app.use('/api/v1', itemsRouter);
app.get('/health', handler);
```

## What was wrong (R101)

The reader walks a declaration's initialiser to find where an application's base
comes from, and a call written on an application was followed only when the row
named the method: a mount, an install, a verb, a prefix. `disable` is none of
those, so the initialiser read as an application from nowhere, `app` had no base
that could be told, and every route in the repository was reported as *mounted
somewhere this cannot read* — with a hint asking whoever read the report to mount
the application at a literal path, which the next line already did.

On PeerTube that was 344 routes, from one line written once.

## What is read now

| Site | Read as |
|---|---|
| `app.get('/health', …)` | `GET /health` |
| `itemsRouter.get('/items', …)` under `app.use('/api/v1', …)` | `GET /api/v1/items` |

Read off the type and not off a list of method names: a call written on an
application that answers with an application of the same kind is that
application, as far as an address is concerned. The alternative is a list of
every setter four frameworks have, which would be wrong again the first time a
framework added one. A prefix method is the one exception, and it is excluded by
the row that names it — Hono's `basePath` answers with the same type and a
different base.
