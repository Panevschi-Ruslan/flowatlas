# lambda-wrapped-handlers fixture

Lambda handlers each wrapped by a helper that takes the function as a later
argument, which is how a project that instruments every handler writes them (R167).

Type-checked except for `@lending/telemetry`, which the manifest declares and
`node_modules` deliberately does not hold, so that a wrapper from a package that
is not installed is one of the shapes. `node_modules` holds hand-written stubs of
`@middy/core`, its JSON body parser, `@types/aws-lambda` and `@lending/tracing`,
an installed tracing package whose declaration says it hands back a function of
the same shape it is given.

## The shapes

`infra/functions.tf` declares seven functions, all packaged from `src/handlers`.
`src/lib/wrappers.ts` holds the repository's own wrappers.

| Function | Handler | What it exercises | `handles` | Confidence |
|---|---|---|---|---|
| `library-desk-create-loan` | `create-loan.handler` | `middy(createLoanLogic).use(jsonBodyParser())`, `createLoanLogic = traced('createLoan', async (event) => …)`: a name, then the function, through a const | the function written in place | `static` |
| `library-desk-renew-loan` | `renew-loan.handler` | `middy(traced('renewLoan', renewLoan)).use(jsonBodyParser())`: a name, then the function, inline in the chain | `renewLoan` | `static` |
| `library-desk-record-return` | `record-return.handler` | `withRetry({ attempts: 3 }, recordReturn)`: options, then the function | `recordReturn` | `static` |
| `library-desk-place-hold` | `place-hold.handler` | `middy(placeHoldMeasured)`, `placeHoldMeasured = instrument(placeHold, { segment: 'holds' })`: the function, then options, from a package that is not installed | `placeHold` | `heuristic` |
| `library-desk-cancel-hold` | `cancel-hold.handler` | `withSpan('cancelHold', cancelHold)` from the installed `@lending/tracing` | `cancelHold` | `static` |
| `library-desk-send-reminders` | `send-reminder.handler` | `measured('sendReminders', sendReminders)`, a wrapper of this repository that hands the function to `instrument` | `sendReminders` | `heuristic` |
| `library-desk-list-overdue` | `list-overdue.handler` | `firstOf(fromCache, fromTable)`: two functions handed over | none | a row |

The wrappers stand in front of the function as middleware, in the order they
run: the middleware a chain installs, and then each wrapper inside the chain,
so `create-loan` is `jsonBodyParser()` then `traced`.

## How sure each landing is

A wrapper of this repository is read, and is a wrapper when its body visibly hands
the function on: `traced` returns what `fn(event, context)` returns, and
`withRetry` returns the result of `fn(event, context)` through a `const`. A
package that is installed is read as far as its declarations go, and
`@lending/tracing` says `withSpan` hands back a function. Those edges are
`static`.

`instrument` comes from `@lending/telemetry`, which is not installed, so nothing
says what it does with the function it is handed. The edge onto `placeHold` is
`heuristic`, and the entry's `wrapperUnread` says which wrapper and why. `measured`
is read and hands the function to `instrument`, so it is no surer than
`instrument` is, and its entry says both.

## What it does not read

`firstOf(fromCache, fromTable)` is handed two functions and runs whichever has an
answer, which is not in the call. It is a wrapper of neither, and the function is
one `function-handler-unread` row naming the call.
