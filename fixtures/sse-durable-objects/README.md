# sse-durable-objects fixture

Streams of server-sent events answered by per-scope objects (Cloudflare's
Durable Objects) a worker hands its request to, and the screens holding them
open. Four repositories and one configuration, so `flowatlas build` joins them
(P361).

The point of it is that a route whose handler only forwards the request -
`env.ROOMS.get(id).fetch(req)` - is still one walk from the channel to the
screen: the stub is followed to the class its namespace is made of, into the
branch of the class's `fetch` the request's path takes, and the stream and the
subscriptions are read there as in a route's own code. An object that holds the
streams open and is written to through its stub is the hub of a channel of its
own.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/sse-durable-objects/planner/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/sse-durable-objects/gateway/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/sse-durable-objects/digest-worker/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/sse-durable-objects/board-web/tsconfig.json --noEmit
```

`gateway/node_modules` and `digest-worker/node_modules` hold hand-written stubs
for `@cloudflare/workers-types` (the namespace, the stub, `cloudflare:workers`'s
base class) and, in `gateway`, `hono`; `board-web/node_modules` one for
`react`. `planner` reaches the Nest types, and every service `redis`, through
the shared fixture manifest.

## The chains, end to end

```
POST /boards/:param/cards                         planner
  BoardsService.addCard
    producer  message board:*:activity            emits, static
      channel:board:*:activity
        consumer  GET /boards/:boardId/activity   relay of GET /boards/:param/activity (gateway),
                                                  served by BoardFeed.fetch
        consumer  handleActivity                  board-web, via that route

POST /boards/:param/presence                      gateway
  producer  event durable-object:PresenceHub      PresenceHub.announce through the stub
    channel:durable-object:PresenceHub
      consumer  GET /boards/:boardId/presence     relay of GET /boards/:param/presence
      consumer  handlePresence                    board-web, via that route
```

## The objects — `gateway/wrangler.jsonc`, `gateway/src/objects/`

| Binding | Class | How the class is found | What the route reads there |
|---|---|---|---|
| `BOARD_FEEDS` | `BoardFeed`, no base class | the configuration; the entry exports it | the `endsWith('/activity')` branch of `fetch`: `listen(\`board:${…}:activity\`)`, a helper of the worker's own |
| `PRESENCE` | `PresenceHub extends DurableObject` | the namespace's type, `DurableObjectNamespace<PresenceHub>` | the branch past `=== '/leave'`: a stream held in `this.writers` |
| `ALERTS` | `AlertsRelay extends DurableObject` | the configuration | `fetch` adds to `this.streams`; the subscription to `alerts:global` is opened in the constructor and fans out to `this.streams` through `fanOut` |
| `ARCHIVE` | `ArchiveFeed` | declared nowhere here | — : `stream-relay-unread` from the linker, naming the class |
| `LEDGER` | `LedgerFeed` of `ledger-worker` | `script_name`: another worker's | — : `stream-relay-unread` from the linker, naming the worker |

Each route the stream is answered behind carries `meta.servedBy` (class,
binding, method, and whether the type or the configuration said which class);
a route handed to a class not read carries `meta.handedTo` with why.

## The hub — `PresenceHub`

No broker behind it: `GET /boards/:param/presence` holds a stream open in
`this.writers`, and two calls on its stub write to every one of them:

| Site | Call | Why it is a write |
|---|---|---|
| `POST /boards/:param/presence` | `presenceFor(…).announce(member)` | `announce` calls `send`, which writes a frame to each of `this.writers` |
| `POST /boards/:param/presence/leave` | `stub.fetch(new Request('https://presence/leave', …))` | the `/leave` branch of `fetch` calls `send`, and holds no stream |

Each is a `producer` (`meta.adapter: "durable-object"`, `meta.method`,
`meta.objectClass`) that `emits` to `channel:durable-object:PresenceHub`
(`meta.heldBy`, `meta.binding`); neither route is a stream. `AlertsRelay` holds
streams too, but nothing writes to it through its stub and a subscription feeds
it, so it is no hub.

## The plain worker — `digest-worker/src/worker.ts`

No router: the default export's own `fetch` tells the paths apart. A branch
that hands the request to an object whose `fetch` streams is a `GET` route of
the path its test names (`meta.adapter: "worker-fetch"`), answered by the
worker's `fetch` read for that branch alone:

| Test | Route | Object | Relays |
|---|---|---|---|
| `url.pathname === '/digest/stream'` | `GET /digest/stream` | `DigestFeed` | `channel:digest:daily` |
| `url.pathname.match(/^\/teams\/([^/]+)\/feed$/)`, held in `team` | `GET /teams/:param/feed` | `TeamFeed` | `channel:team:*:feed` |
| `url.pathname.endsWith('/watch')` | none | `DigestFeed` | — : `route-path-dynamic` at `worker.ts:24` |

Each route has a consumer of its own (`consumer:…:default.fetch@GET …`), since
one function answers both.

## The screens — `board-web/src/`

| Site | Request | Handler (the consumer) |
|---|---|---|
| `BoardScreen`, `activity.onmessage` | `GET /boards/:param/activity` | `handleActivity` |
| `BoardScreen`, `presence.addEventListener('message', …)` | `GET /boards/:param/presence` | `handlePresence` |
| `watchAlerts` | `GET /alerts/stream` | `onAlert` |
| `watchArchive` | `GET /boards/:param/archive` | `onArchived`, joined to the route and to no channel |
| `watchLedger` | `GET /ledger/stream` | `onLedger`, joined to the route and to no channel |
| `watchDigest`, `watchTeam` | `GET /digest/stream`, `GET /teams/:param/feed` on `digest-worker` | `onDigest`, `onTeamCard` |
