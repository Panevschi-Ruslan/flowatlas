# lambda-functions-beside-src fixture

Lambda handlers kept in `functions/`, beside the code they share in `src/`, which
is how a serverless project commonly lays itself out (R170).

Type-checked, never executed or deployed. `node_modules` holds a hand-written
stub of `@types/aws-lambda`.

## The layout

| Directory | Holds | Named by |
|---|---|---|
| `src/holds`, `src/notices` | the holds table and the notices, shared by every function | the tsconfig's `include` |
| `functions/` | three handlers, and `functions/shared/` with the request helpers and the call to the catalogue | the deployment: `infra/functions.tf` packages every function from it |

The tsconfig names `src` and nothing else, because each function is bundled on
its own. So until R170 the reading opened `src/` only: a handler file was added
when the deployment named it, and its calls were followed, but nothing else in
`functions/` was ever opened. The request `functions/shared/catalogue.ts` makes to
the catalogue was missing from the graph, and so was every file of `functions/`
from the build's file listing - an edit to a handler was answered with `0 files
changed`.

The source roots now come from the tsconfig's `include` and `files`, with `src/`
as the fallback when it names nothing, and for a service whose deployment is read,
from the directories it packages functions from. Here that is `src` and
`functions`, for the reading and the listing alike.

## What it reads

| Function | Handler | Reaches |
|---|---|---|
| `library-holds-place-hold` | `place-hold.handler` | `readHoldRequest` and `json` in `functions/shared/request.ts`, `titleExists` in `functions/shared/catalogue.ts` and its `GET` to `catalogue.library.example`, `placeHold` in `src/holds` |
| `library-holds-cancel-hold` | `cancel-hold.handler` | `json`, `cancelHold` |
| `library-holds-expire-holds` | `expire-holds.handler` | `holdsReadyBefore`, `expireHold`, and `tellBorrowerHoldLapsed` in `src/notices` |

Nothing is unresolved.
