# express-fs-router fixture

A repository whose routes are declared by where its files are, with Express
underneath — Medusa v2 in miniature.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/express-fs-router/tsconfig.json --noEmit
```

`node_modules` holds the hand-written `express` stub the other Express fixtures
use, so the types resolve and the reader is turned on in earnest.

## The shape

```
src/api/admin/orders/route.ts   export const GET, export const POST
src/api/store/products/route.ts export const GET
```

There is not one application value anywhere. The Express reader is active because
`express` is a dependency, it finds no receiver of a type it knows, and it comes
away with nothing.

## What was wrong (R84)

Coming away with nothing looked exactly like a repository that merely depends on
Express — a library, a worker, a service whose routes live elsewhere — and the row
that says so was written only for a framework somebody had described in
configuration. So nothing was said. On medusa that is 769 of 791 source files
producing no node, in silence.

The reader cannot tell a file-system router from a library. What it can do is say
which two things it cannot tell apart, which is what the row now does, at `info`,
because it is a limit of this reading rather than a mistake somebody made.

## What is not here

The reader for this convention, and that is now deliberate rather than pending.
This repository declares nothing that names a convention anybody has described,
so it is the case the row is for: a repository that may be a library and may be a
file-system router nobody here knows, said as those two and not as a clean bill of
health.

The other half of the pair is `medusa-fs-router`, next door. There the framework
is declared, so the convention is described and the routes are read (R91). The two
fixtures are the two sides of one sentence, and both have to keep passing: naming
a convention must not make the row for an unnamed one go away.
