# express-wrapped-handler fixture

A named handler handed to a wrapper the repository declares itself, which is
how a video platform writes nearly every route it has.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/express-wrapped-handler/tsconfig.json --noEmit
```

`node_modules` holds the suite's usual hand-written `express` stub.

## The shapes

`src/middlewares/async.ts` is a video platform's `asyncMiddleware` and
`asyncRetryTransactionMiddleware`, nearly word for word: each takes a handler
and returns one that catches its rejection. `src/controllers/videos.ts`
registers one route in each shape a video platform wraps a handler in, and the plain
form beside them, with the count of its 346
registrations in that shape:

| Registration | a video platform | Entry | `handlerVia` | `handles` |
|---|---|---|---|---|
| `get('/:id', authenticate, asyncMiddleware(videosGetValidator), asyncMiddleware(getVideo))` | 224 | `GET /api/v1/videos/:param` | `function` | `getVideo` |
| `post('/', asyncRetryTransactionMiddleware(addVideo))` | 67 | `POST /api/v1/videos` | `function` | `addVideo` |
| `get('/:id/likes', asyncMiddleware(getRateFactory('like')))` | 6 | `GET /api/v1/videos/:param/likes` | `call` | `getRateFactory` |
| `get('/:id/lists', asyncMiddleware(listFactory((req) => …)))` | 8 | `GET /api/v1/videos/:param/lists` | `inline` | none |
| `get('/:id/plain', getVideo)` | 36 | `GET /api/v1/videos/:param/plain` | `function` | `getVideo` |
| `post('/batch', asyncMiddleware([checkBatch, runBatch]))` | 0 | `POST /api/v1/videos/batch` | `inline` | none |

The wrapped validator in front of the first route stays what it was, a
`guarded_by` edge: only the last argument is the handler.

## What was wrong (R137)

A call with one argument stood for that argument only when the argument was a
function written in place — `asyncHandler(async (req, res) => …)`. A function
named by reference was not looked at, so the first three routes above had no
`handles` edge and were folded into one `route-handler-anonymous` row saying
they answer with a function written in the declaration, which none of them
does. On a video platform with its dependencies installed that was 305 of 346
registrations, and 42 of its 343 declarations had a body.

Now the wrapper stands for what it was handed when that is a function this
repository declares, by name or written in place, and a call it was handed is
passed on unopened. A call to one of the repository's functions with nothing but
values — `getRateFactory('like')` — is read as that function having built the
handler, and the route points at it with `handlerVia: call`: the factory's body
holds the function it returns, so the walk reaches `countRates` either way.

## What it still does not read

Two routes keep no handler, and stay in the folded row, on purpose.

`asyncMiddleware(listFactory((req) => …))` hands the factory a function, and
from the call alone a factory handed a function cannot be told from a second
wrapper handed the handler. Looking one level further would take the function
written in place for the handler, and on a video platform that function picks an
account and answers nothing — which a first draft of this change did, eight
times. Pointing at `listFactory` instead would be right here and wrong for a
wrapper, where it would name one shared function as the body of every route.

`asyncMiddleware([checkBatch, runBatch])` runs a list in turn and no one of them
is the answer. Pointing at either would claim the route is that function and
not the other.
