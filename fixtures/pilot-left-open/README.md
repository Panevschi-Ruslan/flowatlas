# pilot-left-open fixture

What a pilot left open after P404 (P405). Three repositories and one
configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/pilot-left-open/desk-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/pilot-left-open/push-worker/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/pilot-left-open/staff-web/tsconfig.json --noEmit
```

## The desk API - `desk-api/`

`StepsController` (`/api/:tenantId`) publishes through the project's own bus
(`TenantBus`, described in `adapters.broker.custom`): `CALL_STAFF` on
`tenant:<id>:events` with `{type, roomNumber, orderId, scopeId, ts}` - no
`roomId`; `STEP_READY` on `tenant:<id>:events` and on four more channels,
`session:<id>:closed`, `session:<id>:paid`, `session:<id>:split` and
`status_feed`; `ORDER_MOVED`, `TABLE_MOVED`, `TABLE_MERGED` and `RESYNC` on
the tenant channel. `GET /api/:tenantId/stream` relays the tenant channel to
the screens; `GET /api/:tenantId/orders/:orderId` is what they refetch.
`KitsController` serves `GET /api/admin/:tenantId/kits/auto-stopped` and a
`POST`: a list of its routes should say `:tenantId`, not only `:param`.

## The push worker - `push-worker/`

- `PushService.onEvent` parses the frame (`JSON.parse(raw) as {…}`), returns
  unless the type is one of `RELEVANT`, and hands the message to
  `dispatch(scopeId, raw)`, which holds it in a local made by a cast, reads
  `orderId` through `resolveAssigned` before its `switch`, and in `case
  'CALL_STAFF'` returns early unless `evt.roomId` is there, then hands
  `roomId` to `formatCall` in an object. The publisher sends `roomNumber`:
  `check_contract` says `missing: roomId`, guarded, the handler returning
  early.
- `LiveFeed` filters by `LIVE`, a set built by spreading `OTHER_EVENTS` (a set
  in `live/event-sets.ts`), `SEAT_EVENTS` (an `as const` list of an enum
  member) and adding `RESYNC_EVENT`, a constant `sync/resync.service.ts`
  exports.
- `ChatBot.handleStepReady` reads `stepName` of `STEP_READY` on
  `status_feed`, the last of the four other channels by name.
- `SessionAudit` records every message on the three session channels.

## The staff screens - `staff-web/`

`DeskStreamService` pushes each frame of the stream into a subject.
`StaffStepsComponent` chooses `STEP_READY` in a `filter` and
`CallBoardComponent` `CALL_STAFF` and `STEP_READY` in its callback; each then
calls `private load(): void`, which refetches the order over HTTP and is
handed nothing of the message.

## What the answers say

- `who_consumes({channel: "tenant:*:events", type: "STEP_READY", field:
  "stepName"})`: no handler on the tenant channel reads it; `alsoOn` names
  `status_feed` with `ChatBot.handleStepReady` and its line, the three session
  channels counted in `alsoOnRest`; the two screens in `readsNothing`;
  settled.
- `check_contract({channel: "tenant:*:events", type: "CALL_STAFF"})`:
  `missing: roomId`, read by `PushService.dispatch` behind a check that
  returns early; `roomNumber` unused; the call board reads nothing.
- `who_consumes({channel: "tenant:*:events", type: "RESYNC"})`: `LiveFeed`,
  settled.
- `list_entries({in: "KitsController"})`: each row's `rawPath`; compact, the
  label with `:tenantId` and `:kitId`.
