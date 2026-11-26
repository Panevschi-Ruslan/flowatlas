# sse-hub-subject-screens fixture

A type of message published through a project's own bus, relayed by a
per-board hub onto stream routes, and chosen by screens that subscribe through
an rxjs wrapper (P362). Three repositories and one configuration, so
`flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/sse-hub-subject-screens/boards-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/sse-hub-subject-screens/admin/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/sse-hub-subject-screens/web/tsconfig.json --noEmit
```

## The publisher - `boards-api` (Nest and Hono in one worker)

- `BoardsService` publishes five types on `board:${id}:events`, one on
  `crew:${id}:shifts` and one on `board:${id}:audit`, all through
  `BoardEventBus.publish`, which `adapters.broker.custom` describes as the
  producer and which hands each message to the project's own
  `BusService.publish`. Nothing subscribes on a broker.
- `OrdersService` publishes on `board:${id}:orders` three ways: through
  `BoardEventBus` (`ORDER_PLACED`), through it with the channel held in a local
  `const` first (`ORDER_SHIPPED`), and by calling `BusService.publish`
  directly (`SCHEDULED_ALERT`, sent nowhere else). The routing table sends the
  orders family to the worker alone: `fanoutToWorker`, marked
  `@CallsService('orders-worker', 'POST /events/orders')`, whose route in
  `orders-worker` is marked `@Consumes('board:*:orders')` and dispatches by
  `switch (event.type)`.
- `BusService.publish` asks `resolveTransports(channel)` (`bus/routes.ts`: a
  constant `Map` of channel family to a set of transports, a default for a
  family not listed) and calls `this.transportHandlers[t](channel, message)`
  for each; the record's `hub` member calls `fanoutToHub`, which reaches the
  hub's namespace through `getWorkerEnv().BOARD_HUB` and posts `{ channel,
  message }` to the stub at `https://hub.local/publish`.
- `BoardHub` (bound by `wrangler.jsonc`) writes what `/publish` is handed to
  every stream `/subscribe` holds open.
- The stream routes' handlers are members of the object `createStreamHandlers`
  returns - `sse.boardEvents` (a shorthand), `sse.stream` (`stream:
  boardEvents`) and `sse.crewStream` - and forward to the hub's stub at
  `https://hub.local/subscribe?scope=…`.

- `CardEventsService` (which calls `BusService` directly) is the trap for the walk out from the hub: its helper
  takes the type first and works the channel out inside (`publishCardEvent(type,
  boardId, extra)`), and another hands on a whole message object; the hub's
  channel is read only from the value it is sent as `channel`.

Expected: the two board routes are answered by `boardEvents`, one relay
consumer per route, and the crew route by `crewStream`; `board:*:events` and
`crew:*:shifts` are consumed by each through `BusService.publish`,
`BusService.transportHandlers.hub` and `BusService.fanoutToHub`, `heuristic`
with `filteredBy: inScope` - the hub writes a message only to the streams whose
scope it is in, and which scope each route opens is not read; `board:*:audit`
is not relayed (the table routes it to the worker alone); no channel is drawn
for a type of message (`CARD_PINNED`) or an object handed to the helpers;
`BusService.fanoutToHub` is a producer of `durable-object:BoardHub`, which
carries no type nodes of its own. Each direct call of `BusService.publish`
that names a channel the walk reads - from the hub write, or from
`fanoutToWorker` - is a producer of that channel named for the helper
(`adapter: BusService.publish`, `channelVia: helper`), its payload's type read:
`SCHEDULED_ALERT` on `board:*:orders`, selected by
`OrderEventsController.handleScheduledAlert`. A type a screen selects is drawn only on the
channels whose publishes carry it: `CREW_ASSIGNED` on `crew:*:shifts`, not on
`board:*:events`, though the crew screen is joined to both.

## The screens

| Repository | Wrapper | Subscriber | How it chooses | Types |
|---|---|---|---|---|
| `admin` | `BoardStreamService`, `_event$` exposed as `event$` | `BoardPageComponent.ngOnInit` (constructor injection) | `pipe(filter(… === … \|\| … === …))`, then `() => this.load()` | `CARD_MOVED`, `CARD_ADDED`, handled by `load` |
| `admin` | same | `ArchivePanelComponent.ngOnInit` (`inject()`) | a constant list's `includes` in the callback | `CARD_ARCHIVED`, handled by `refreshArchive` |
| `web` | `BoardFeed`, `subject` exposed by the getter `events$`, one instance made by the module | `BoardScreen` | a constant `Set`'s `has` in the callback | `CARD_MOVED`, `CARD_ARCHIVED` |
| `admin` | `LegacyBoardFeed`, its subject public; nothing injects or makes it | `RenameWatcher.watch` | `===` in the callback | `BOARD_RENAMED`, never run |
| `admin` | `BoardStreamService.event$`, re-exposed by `LiveUpdatesService.getCardUpdates()` with a cast | `CardTimelineComponent.ngOnInit` | `event['type'] === …`, an early return | `CARD_ADDED` (`append`), `CARD_MOVED` (`reorder`) |
| `admin` | `LiveStream<T>` (generic), one instance held and re-exposed by `CrewBoardStreamService` on the crew route | `CrewPanelComponent.ngOnInit` | a constant `Set`'s `has` | `CREW_ASSIGNED` |
| `admin` | another `LiveStream<T>` instance, held by `AlertsStreamService` on the plain stream route | `AlertsBadgeComponent.ngOnInit` | `===` | `CARD_ARCHIVED` |

Each subscriber is a consumer of the stream its wrapper opens, so the linker
joins it to every channel the route relays; the wrapper's own handler, which
only pushes the frames on, says whom it hands them to. A subscriber reached
through one instance of `LiveStream` is fed by that instance's request alone:
`CrewPanelComponent` by the crew route, `AlertsBadgeComponent` by the plain
stream route.

## What an agent asks

```
who_consumes({channel: "board:<boardId>:events", type: "CARD_MOVED"})  BoardPageComponent.load (filter), BoardScreen (if)
who_consumes({channel: "board:*:events", type: "CARD_COMMENTED"})      unselected, sure: every screen chooses other types
who_consumes({channel: "board:*:events", type: "BOARD_RENAMED"})       unselected: only RenameWatcher, which never runs
who_consumes({channel: "board:*:events"})                              the routes and every screen
who_consumes({channel: "board:*:events", type: "CARD_ADDED"})          BoardPageComponent.load (filter), CardTimelineComponent.append (if)
who_consumes({channel: "crew:<crewId>:shifts", type: "CREW_ASSIGNED"}) CrewPanelComponent.scheduleRefresh (if)
```
