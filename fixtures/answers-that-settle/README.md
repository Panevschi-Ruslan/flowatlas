# answers-that-settle fixture

Answers that settle themselves (P404). Three repositories and one
configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/answers-that-settle/rooms-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/answers-that-settle/notify-worker/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/answers-that-settle/chat-bot/tsconfig.json --noEmit
```

## The rooms API - `rooms-api/`

`RoomsController` serves `GET /api/admin/:venueId/rooms/free-times` and
three `POST`s; `OrdersController` three more. Each `POST` publishes on
`venue_events` through the project's own bus (`VenueBus`, described in
`adapters.broker.custom`), the type an enum member (`VenueEvent`):
`ROW_CLAIMED`, `CALL_STAFF`, `ROOM_READY`, `ORDER_READY`, `ORDER_PAID`,
`TABLE_FREED`. `ROOM_READY` is published on `staff_feed` too. Every name is
written only in the enum, which only the sends use.

## The notify worker - `notify-worker/`

Four consumers of `venue_events`:

- `PushService` subscribes with a callback that returns unless the type is
  one of `RELEVANT` (a set written out), then hands the message to
  `dispatch(venueId, evt)`. `dispatch` switches on the type: the
  `CALL_STAFF` case looks the room up (`findRoom`), returns where there is
  none, and formats a line (`formatCall`), so the case is handled by
  `dispatch` itself, not by the lookup; `ORDER_READY` is one call,
  `sendReady`.
- `FeedRelay` takes every type and hands each to `FeedGateway.push`, which
  hands it to `fanOut`, which hands it to `RoomBoard.apply`: there, three
  calls past the relay, `evt.type === 'TABLE_FREED'` is a choice the graph
  does not read.
- `AuditTrail` takes every type and records the venue.
- `OrderWatch` takes every type and counts those whose type starts with
  `ORDER_`: a prefix test no name rules out.

## The chat bot - `chat-bot/`

`RoomService.getFreeTimes` asks `fetchSlots`, whose request lands on
`GET /api/admin/:param/rooms/free-times` in the rooms API, publishes
`SLOTS_SHOWN` on `staff_feed` (a type its one consumer does not choose: a
step the flow cannot follow, off the request's way), and renders the slots.
`StaffBot` consumes `staff_feed`, chooses `ROOM_READY` and reads its
`roomName`. `node_modules/` holds the shapes of `@nestjs/axios`,
`@nestjs/config` and `axios` the reader needs.

## What the snapshots hold

Verbose under `expected.mcp/`, compact under `expected.mcp.compact/`:

- `who_consumes.name-sent-only`: `ROW_CLAIMED` is settled, "no code compares
  ROW_CLAIMED: its name is written only where it is sent", the consumers
  that take every type counted in one clause.
- `who_consumes.prefix-test`: `ORDER_PAID` stays unsure, one place named,
  `OrderWatch`'s prefix test.
- `who_consumes.past-a-hand-off`: `TABLE_FREED` stays unsure at
  `RoomBoard.apply`, which `FeedRelay` hands every type to; the verbose
  answer lists it in `selectionUnread`, the compact one counts it in `left`.
- `who_consumes.case-handled-in-place`: `CALL_STAFF`'s handler is
  `PushService.dispatch`, not `findRoom`.
- `who_consumes.field-on-another-channel`: no handler of `ROOM_READY` reads
  `roomName` on `venue_events`; `alsoOn` names `StaffBot.handleRoomReady` on
  `staff_feed`.
- `check_contract.choosers-only`: `CALL_STAFF`'s contract lists the one
  consumer choosing it and counts the three that take every type.
- `get_flow.request-first`: `requests` first, `settled` saying where the
  request lands, and the unread step said off the request's way.
