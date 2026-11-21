# helpdesk-screen-reach fixture

Answers that finish in one call (P364): every row naming code says whether it
runs (`reach`, the verdict `dead` gives) and where it is reached from (`from`,
the nearest way in), every list says whether it is `complete`, and `next`
names only calls that add something. Two repositories and one configuration,
so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/helpdesk-screen-reach/desk-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/helpdesk-screen-reach/console/tsconfig.json --noEmit
```

## The publisher - `desk-api` (Nest)

- `TicketsService` publishes three types on `desk:${deskId}:events`:
  `TICKET_ASSIGNED` (from `POST .../assign`), `TICKET_CLOSED` (from
  `POST .../close`) and `TICKET_REOPENED`, from `reopen`, which nothing calls.
- `LiveController.events` (`@Sse`) subscribes to the channel and relays it.

## The screens - `console` (React)

- The router shows `QueueScreen` at `/queue` and `TicketScreen` at
  `/tickets/:ticketId`; both open the stream through `useDeskEvents` and choose
  by `event.type`.
- `ArchivePanel` selects `TICKET_REOPENED` too, but no route shows it and
  nothing renders it.

## What the answers say

- `who_consumes` on `TICKET_ASSIGNED`: both screens' handlers, each `reach:
  alive` and `from: "screen /queue"` or `"screen /tickets/:param"`, and
  `complete: true`; `next` names no `dead`, `who_calls` or `search` on them.
- `who_consumes` on `TICKET_REOPENED`: the panel's handler, `reach: maybe`,
  `from: "behind"`, `behind` naming the panel: nothing read renders it, but a
  render the reading does not draw could (P367).
- `who_emits` on `TICKET_ASSIGNED`: the publish, reached from its route.
- `dead` with `ids`, `find_symbol` and `search` with `queries`: several asked
  in one call, one answer each under `answers`.
- `who_calls` cut by `depth`: `complete: false`, `left` naming the cut.
