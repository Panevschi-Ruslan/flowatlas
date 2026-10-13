# lambda-terraform-websocket

A lending library's reading room: borrowers ask a librarian over a WebSocket
API (R174). A WebSocket API has no paths and no verbs, so each of its routes is
a way in of its own, an `event` entry keyed `websocket/<api>/<route key>`.

Type-checked, never executed or deployed.

| Route key | Entry | Runs |
|---|---|---|
| `$connect`, behind the `borrowers` authoriser | `event:websocket/library-reading-room/$connect`, `authorization: CUSTOM` | `on-connect.ts` |
| `$disconnect` | `event:websocket/library-reading-room/$disconnect` | `on-disconnect.ts` |
| `askLibrarian`, picked out of a message by `$request.body.action` | `event:websocket/library-reading-room/askLibrarian` | `ask-librarian.ts` |
| `$default` | `event:websocket/library-reading-room/$default` | `unknown-action.ts` |

The four functions and their integrations are one resource each, repeated with
`for_each` over a map of handlers the files settle, and every route names its
integration by key.

`doctor` has nothing to say: no row.
