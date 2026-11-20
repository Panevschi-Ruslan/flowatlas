# sse-relay-channels fixture

A channel published by one service, relayed onto streams of server-sent events by
the routes that subscribe to it, and the screens whose handlers the frames arrive
at. Three repositories and one configuration, so `flowatlas build` joins them
(P359).

The point of it is that channel, route and screen are one walk: `who_consumes`
on the channel names the route and every screen fed through it, and a walk from
the publisher ends in the screen's handler. The route is a consumer of the
channel; the screen's handler is a consumer reached from the stream's request.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/sse-relay-channels/shipping/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/sse-relay-channels/edge/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/sse-relay-channels/portal/tsconfig.json --noEmit
```

`edge/node_modules` holds hand-written stubs for `hono` and `hono/streaming`;
`portal/node_modules` one for `react`. `shipping` and `edge` reach `redis`, and
`shipping` the Nest types, through the shared fixture manifest.

## The chain, end to end

```
POST /workspaces/:param/parcels/:param/packed      shipping
  ParcelsService.markPacked
    producer  message workspace:*:events           emits, static
      channel:workspace:*:events
        consumer  LiveController.events            relay of GET /workspaces/:param/events
        consumer  GET /live/:workspaceId@15        relay of GET /live/:param (edge)
        consumer  handleParcelEvent                portal, via GET /workspaces/:param/events
        consumer  CourierPanel                     portal, via GET /workspaces/:param/events
        consumer  onTick                           portal, via GET /live/:param
```

Each edge from the channel to a screen carries `meta.via: "sse"`, the route
(`meta.route`) and the stream's request (`meta.call`), at the weakest of the
three links it stands for; the screen's consumer lists the routes in
`meta.routes`.

## The routes — `shipping/src/live/`, `edge/src/worker.ts`

| Route | How it streams (`meta.streamFrom`) | What feeds it | `meta.relays` |
|---|---|---|---|
| `GET /workspaces/:param/events` | `@Sse('events')`, the decorator alone (`decorator`) | `listener.subscribe(\`workspace:${…}:events\`, …)` in its own body | `channel:workspace:*:events` |
| `GET /workspaces/:param/warehouses/:param/packing` | `@Sse(…)` (`decorator`) | `RelayService.frames(channel)`, handed `warehouse:${…}:parcels` by the route | `channel:warehouse:*:parcels` |
| `GET /workspaces/:param/audit` | `@Sse('audit')` (`decorator`) | nothing a subscription says | — : `stream-relay-unread` at `live.controller.ts:34` |
| `GET /live/:param` (edge) | `streamSSE(c, …)` and `writeSSE` (`helper`) | `listen(channel, …)`, a function of the worker's own, handed `workspace:${…}:events` | `channel:workspace:*:events` |
| `GET /rooms/:param/stream` (edge) | not seen: the request is handed to a per-scope object, `ROOMS`, that no worker configuration binds and whose type names no class (`meta.handedTo`, P361) | code this route does not hold | — : `stream-relay-unread` from the linker, because a browser holds it open, saying why the object was not followed |

`@Sse(path)` with no other route decorator is a `GET` route of its own; beside
`@Get` it marks the route as a stream and declares nothing more (the shape
`sse-stream` holds). Each relaying route has a `consumer` node for its handler
with `meta.relay` naming the route; where a listener written in the handler was
already drawn as that node (`LiveController.events`), it keeps what it was and
gains `meta.relay`.

The subscription through `RelayService.frames` is also read where it is
written, where its channel is a parameter: that site keeps its
`channel-dynamic` row, since another caller could hand it anything.

## The screens — `portal/src/`

| Site | Request | Handler (the consumer) |
|---|---|---|
| `useWorkspaceEvents`, `source.onmessage = (frame) => onEvent(…)` | `GET /workspaces/:param/events` | each caller's: `handleParcelEvent` (named), `CourierPanel` (written in place) |
| `PackingScreen`, `addEventListener('message', () => …)` | `GET …/warehouses/:param/packing` | `PackingScreen`, the function the listener is written in |
| `startTicker`, `addEventListener('message', onTick)` (a plain module) | `GET /live/:param` on `edge` | `onTick` |
| `joinRoom`, `source.onmessage = onRoomMessage` | `GET /rooms/:param/stream` on `edge` | `onRoomMessage`, joined to the route and to no channel |
| `watchNotices` | `GET /notices/stream` | `onTick`; the request hits no route: `target-route-not-found` |

Every request is a `ui_api_call` with `kind: "sse"`, `meta.method: "GET"` and
`meta.client: "EventSource"`; every handler a `consumer` with `kind: "sse"`
that `handles` the function and that the request `triggers`. What the handler
does with a frame is not read here: it is read off the function the consumer
`handles`, as for any consumer.
