# lambda-wrapper-alias fixture

Lambda handlers each wrapped by a helper of this repository that the handler
calls by another name (R175): taken off a namespace import into a `const`,
imported under a short name, or re-exported by a barrel under a new one. A
wrapper is the function it names, however many names stand between the call and
its declaration, so each handler lands where it would with the wrapper called by
its own name (R167).

Type-checked against `@types/aws-lambda` in `node_modules`, never executed or
deployed.

## The shapes

`infra/functions.tf` declares five functions, all packaged from `src/handlers`.
`src/lib/tracing.ts` holds the wrappers and one factory.

| Function | Handler | How the wrapper is named | `handles` | Before |
|---|---|---|---|---|
| `library-desk-create-loan` | `create-loan.handler` | `const traced = tracing.traced`, then `traced('createLoan', async (event) => …)` | the function written in place, `static` | `heuristic`: the `const` was read as a value built at run time |
| `library-desk-renew-loan` | `renew-loan.handler` | `import { traced as t }`, then `t('renewLoan', renewLoan)` | `renewLoan`, `static` | the same |
| `library-desk-record-return` | `record-return.handler` | `const retrying = tracing['withRetry']; const retried = retrying`, then `retried({ attempts: 3 }, recordReturn)` | `recordReturn`, `static` | `heuristic`, as for `create-loan` |
| `library-desk-cancel-hold` | `cancel-hold.handler` | `export { traced as span } from './tracing'` in `lib/index.ts`, then `span('cancelHold', cancelHold)` | `cancelHold`, `static` | the same |
| `library-desk-desk-name` | `desk-name.handler` | `const listOf = tracing.listing`, then `listOf(findDesk)` | none: one `function-handler-unread` row | landed on `findDesk` at `heuristic` |

## Why the last is a row

`listing` is a factory: it builds a handler of its own and uses the function it
is handed to look a name up. Read through its alias, its body shows it never
hands that function on, so it is not a wrapper of it, and a call handed work is
not read as a factory either (R137). Before, the alias was not followed, nothing
of `listing` was read, and the handler was landed on `findDesk` heuristically,
which named as the function's body a lookup the function only calls.
