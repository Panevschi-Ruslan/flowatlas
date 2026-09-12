# sse-stream fixture

A browser that subscribes over server-sent events, a service that publishes, and
the whole round trip between them. Two repositories and one configuration, so
`flowatlas build` joins them.

The point of it is R08: a subscription in a browser is **not** a consumer of a
channel. The browser never names one — it opens an address and holds it. The
consumer is inside the service, one hop away, where a call on the bus says which
channel it is receiving from. Both halves are here so the difference is visible.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/sse-stream/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/sse-stream/web/tsconfig.json --noEmit
```

`web/node_modules` holds hand-written stubs for `@angular/core`,
`@angular/common/http` and `rxjs`; `api` reaches the real `@nestjs/common` types
through the shared fixture manifest.

## The chain, end to end

```
click Cancel            web/src/app/orders.component.ts:14
  POST /depots/:param/orders/:param/cancel      hits, static
    OrdersService.cancel                             api/src/orders/orders.service.ts:15
      producer  event depot:*:events            emits, static
        channel:depot:*:events
          consumer  EventBus.receive                 consumes, static
```

and the other direction:

```
click Watch             web/src/app/orders.component.ts:13
  GET /depots/:param/events                     hits, static
    EventsController.stream                          api/src/orders/events.controller.ts:20
```

The two never join into one edge, and that is the finding rather than a gap: what
the route forwards onto its stream is decided by an rxjs pipeline, and drawing an
edge across it would be a guess.

## The browser — `web/src/app/`

| Site | Line | `path` | Joined | `ui.byReason` |
|---|---|---|---|---|
| `new EventSource(url)`, address in one template | `live-events.service.ts:29` | `/depots/:param/events` | route on `api`, static | — |
| the same with `+ ?token=${…}` | `live-events.service.ts:48` | ends in a hole | no | `api-path-partly-read` |
| `new EventSource(url)`, `url` a parameter | `stream-wrapper.service.ts:17` | `null` | no | `api-path-dynamic` |
| `new EventSource(frames)`, class declared here | `replay.service.ts:23` | — | — | nothing at all |

Every one is `kind: "sse"` with `meta.method: "GET"` — the protocol has one verb —
`meta.client: "EventSource"` and `meta.package: null`, since the client is the
browser's own rather than a package's.

Line 48 is the shape every one of these is written in, because the client cannot
set headers and the credentials have to ride in the query string. The query is
not part of the route, but a `+` whose right-hand side cannot be read collapses
whole and takes the `?` with it, so there is nothing left to cut the path at. The
address reader owns that, not this pass; the R08 log names the line.

Line 23 is the precision case. The name alone proves nothing: `EventSource`
declared in the repository is something else, and must produce no request and no
row, because there is no stream to have missed.

## The service — `api/src/`

| Site | Line | Channel | Confidence | `unresolved.reason` |
|---|---|---|---|---|
| `events.publish(\`depot:${id}:events\`, …)` | `orders/orders.service.ts:16` | `depot:*:events` | static | — |
| `broadcaster.pSubscribe('depot:*:events', …)` | `events/event-bus.service.ts:30` | `depot:*:events` | static | — |
| `metrics.pSubscribe('depot:*:events', …)` | `events/event-bus.service.ts:34` | none | — | nothing at all |
| `broadcaster.pSubscribe(pattern, …)` | `events/event-bus.service.ts:41` | none | — | `channel-const-unresolved` |

The publisher writes a template and the subscriber writes a pattern, and they
meet on one node: the hole the template leaves is the segment the `*` stands for,
so both resolve to `depot:*:events`. `meta.channelVia` is `template` on the
producer and the name is read as a literal on the subscriber.

Line 34 is the second precision case. `Metrics` has a method of the same name and
the configuration does not name the type, so nothing is recorded — a method
called `pSubscribe` is not evidence of a subscription.

Line 41 subscribes to a pattern it was handed, so there is no channel to join on.
The consumer is still recorded — the same node as line 30's, since both listeners
delegate to `EventBus.receive` — and a row names the method to annotate.

The bus is injected by token, so every publishing call site sees `EventPublisher`
and not `Broadcaster`. The configuration names both, which is why the producer is
found at all.

## Configuration

`flowatlas.config.json` describes the house bus, since there is no library for an
adapter to detect:

- `producers[0].receiverType: ["EventPublisher", "Broadcaster"]` — the interface
  at the call site and the class behind it.
- `subscribers[0]` — `Broadcaster.pSubscribe(pattern, handler)`, the R08 key.
- `services[web].apiTarget: { "apiUrl": "api" }` — which service the browser's
  settings key names, so both `hits` edges are `static` rather than a guess.
