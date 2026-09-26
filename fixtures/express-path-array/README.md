# express-path-array fixture

One registration, several addresses, which is legal Express and appears eight
times in the repositories the coverage harness measures.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/express-path-array/tsconfig.json --noEmit
```

`node_modules` holds a hand-written `express` stub. It is the suite's usual one
with the path parameter widened to `string | string[]`, which is what Express
itself declares.

## The shape

```ts
itemsRouter.get(['/items/:id', '/i/:id'], showItem);

const LEGACY_PATHS = ['/legacy/items', '/old/items'];
itemsRouter.get(LEGACY_PATHS, listItems);
```

## What was wrong (R101)

A call that takes the verb as an argument has had a list of verbs folded since
the day it was read: `app.on(['GET', 'POST'], …)` is two ways in and is recorded
as two. The path was read by a function that answered with one string or with
nothing, so a list of paths was nothing — the call was reported as a route whose
path could not be told, and both of its addresses were missing from the graph
while the row said only that something was dynamic.

A missing line rather than a missing idea, which is why the fix is the verbs'
own reading applied to the paths: one folded value, a list or a single item, and
one entry per item.

## What is read now

| Site | Read as |
|---|---|
| `get(['/items/:id', '/i/:id'], …)` | `GET /api/items/:param` and `GET /api/i/:param` |
| `get(LEGACY_PATHS, …)` | `GET /api/legacy/items` and `GET /api/old/items` |
| `get('/items', …)` | `GET /api/items`, exactly as before |

Both spellings fold, because the folding is the one the constant reader already
does: an array literal and a name given to one are the same value, and a path
assembled at run time is still a path nobody can match against a caller.

One handler answers every address of its registration, so the function node
written for a handler declared in place carries all of them in its name.
