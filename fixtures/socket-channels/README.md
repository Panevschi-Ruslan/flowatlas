# socket-channels fixture

A NestJS gateway and a browser in another repository, joined on nothing but the
event names they both write. Two repositories and one configuration, so
`flowatlas build` joins them.

The point of it is the counterpart to R08. `sse-stream` holds the case where a
browser is **not** a consumer: it opens an address and holds it, never names a
channel, and the channel lives inside the service. A socket is the other case.
The browser writes `order:cancel` in its own source and a gateway in another
repository writes the same string; neither is addressing the other, both are
addressing the name. So the browser really is a producer and really is a
consumer here, and reading it as a request to an address would throw away the
only thing either end stated. The two fixtures sit beside each other so the
difference is visible rather than asserted.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/socket-channels/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/socket-channels/web/tsconfig.json --noEmit
```

`api/node_modules` holds hand-written stubs for `@nestjs/websockets` and
`socket.io`; `web/node_modules` holds them for `@angular/core` and
`socket.io-client`. `api` reaches the real `@nestjs/common` types through the
shared fixture manifest.

## One channel, two repositories

```
click Cancel                              web/src/app/orders.component.ts:10
  OrdersSocketService.cancel                   web/src/app/orders-socket.service.ts:25
    producer  event orders/order:cancel   emits, static
      channel:orders/order:cancel
        consumer  OrdersGateway.cancel         api/src/orders/orders.gateway.ts:28
          OrdersService.cancel                 api/src/orders/orders.service.ts:7
          producer  event orders/order:updated
            channel:orders/order:updated
              consumer  OrdersSocketService.apply   web/src/app/orders-socket.service.ts:31
```

That whole chain is one `flowatlas channel orders/order:cancel`. It crosses the
repository boundary twice and there is no HTTP anywhere in it.

## The namespace is part of the channel

`@WebSocketGateway({ namespace: 'orders' })` declares an endpoint, and a socket
namespace is a separate connection: nothing crosses between two of them. So the
channel is `orders/order:updated` and not `order:updated`, and the browser lands
on the same node because it opened `` io(`${environment.apiUrl}/orders`) `` and
the path of that address is the namespace.

`AuditGateway` is the control. It carries `@WebSocketGateway()` with no
namespace and handles `order:updated`, and that is a **different** channel —
`channel:order:updated`, with one consumer and no publisher. Collapsing the two
would say the audit trail hears what the browser and the orders gateway say to
each other, which it does not, and it is exactly the kind of join this tool
exists to avoid making up.

## The service — `api/src/orders/`

| Site | Line | Channel | `unresolved.reason` |
|---|---|---|---|
| `@SubscribeMessage('order:cancel')` | `orders.gateway.ts:28` | `orders/order:cancel` | — |
| `this.server.emit('order:updated', …)` | `orders.gateway.ts:31` | `orders/order:updated` | — |
| `@SubscribeMessage('order:summary')` | `orders.gateway.ts:40` | `orders/order:summary` | — |
| ``this.server.emit(`order:${verb}`, …)`` | `orders.gateway.ts:54` | `orders/order:opened`, `orders/order:closed` | — |
| `this.server.to(region).emit('order:updated', …)` | `orders.gateway.ts:66` | `orders/order:updated` | — |
| `@SubscribeMessage('order:updated')` | `audit.gateway.ts:16` | `order:updated` | — |
| `@SubscribeMessage(AUDIT_EVENT)` | `audit.gateway.ts:29` | none | `channel-const-unresolved` |
| `@SubscribeMessage('report:requested')` | `reports.gateway.ts:16` | none | `channel-dynamic` |

Line 54 is the fold. `verb` comes from `OrderState`, which is a closed union of
two, and every step from it is plain string work over literals, so the template
is folded once per member and the publish reaches two named channels rather than
one `orders/order:*`. `worker`-style guessing is not involved: the browser has
never seen `OrderState` and names `order:opened` and `order:closed` outright, and
they join because the fold worked out what the template reaches. The cap on how
many names one address may reach is `MOST_CHOICES`, shared with the rest of the
reader rather than declared again here.

Line 66 is the room. `to(region)` names an audience inside the namespace; the
event is still `orders/order:updated`, and the region is addressing. One node
per region would invent channels nobody publishes to and join the browser to
none of them, so the room is read and discarded.

`reports.gateway.ts` is the precision case for the endpoint. Its event name is a
plain literal and would resolve on its own — it is the namespace above it that
cannot be read, and falling back to the root namespace there would put the
handler on `AuditGateway`'s node. So the whole class loses its channels and
every call site in it is reported.

## The browser — `web/src/app/`

| Site | Line | Channel | `kind` | `unresolved.reason` |
|---|---|---|---|---|
| `socket.emit('order:cancel', …)` | `orders-socket.service.ts:26` | `orders/order:cancel` | `event` | — |
| `socket.on('order:updated', …)` | `orders-socket.service.ts:31` | `orders/order:updated` | `event` | — |
| `socket.on('order:opened' \| 'order:closed', …)` | `:32`, `:33` | the two folded names | `event` | — |
| `socket.on('connect', …)` | `orders-socket.service.ts:35` | none | — | nothing at all |
| `socket.emit('order:summary', id, cb)` | `orders-socket.service.ts:46` | `orders/order:summary` | `rpc` | — |
| `socket.emit(event, …)` | `orders-socket.service.ts:51` | none | `event` | `channel-const-unresolved` |
| `socket.on('order:updated', …)` | `live-feed.service.ts:22` | none | — | `channel-dynamic` |

Line 35 is the second precision case. `connect` is the library signalling to
itself on the same mechanism it carries application events on; it is not a
channel, so there is no consumer, no node and no row. A graph with one
`channel:connect` per repository, publishers nowhere, would be the library drawn
as architecture.

Line 46 is the acknowledgement. The third argument is where the answer arrives,
so this end is `rpc` rather than `event` — a request and a reply, not a publish.
The reply needs no edge of its own, because the callback's body belongs to the
method that wrote it and the chain already runs through it:

```
-> OrdersComponent.summarise               web/src/app/orders.component.ts:24
  -> OrdersSocketService.requestSummary    web/src/app/orders-socket.service.ts:45
    ~  rpc orders/order:summary            web/src/app/orders-socket.service.ts:46
      ~  orders/order:summary
        => api ~  OrdersGateway.summarise  api/src/orders/orders.gateway.ts:40
          -> OrdersGateway.summarise
            -> OrdersService.summarise     api/src/orders/orders.service.ts:11
    -> OrdersSocketService.show            web/src/app/orders-socket.service.ts:58
```

The gateway's end of that same channel is `event` and not `rpc`, on purpose.
`@SubscribeMessage` is the same decorator whether or not anybody is waiting for
what the method returns, so nothing on that side states which it is, and the
tool does not say what the source does not.

`live-feed.service.ts` is the browser's half of the endpoint problem, written to
match `reports.gateway.ts`: the event name is a literal and the namespace is the
hole, so the listener is recorded and the channel is not.

## Names neither end can read

`AUDIT_EVENT` on the service and the `event` parameter in the browser are the
same problem seen from both sides, and both are reported with the symbol to
annotate:

```
api  channel-const-unresolved  src/orders/audit.gateway.ts:29        AuditGateway.audit -> AUDIT_EVENT
web  channel-const-unresolved  src/app/orders-socket.service.ts:51   OrdersSocketService.audit -> event
```

Neither produces a channel node. A guessed name would join two services that
never speak, and here there is nothing to guess from.

## Configuration

`flowatlas.config.json` describes nothing but the two services. The transport is
a library at both ends, so a description already exists in the tool and neither
repository needs a word of configuration — which is the difference between this
fixture and `sse-stream`, where the bus is the project's own.
