# fn-broker fixture

One service publishes the same kind of event from four different kinds of body;
another subscribes to what it sends. Two repositories and one configuration, so
`flowatlas build` joins them.

The point of it is R54: a publish is read wherever it is written. The broker
reader used to walk `ctx.classes.all()` and their methods, so only the first of
these four produced anything at all.

| written in | file | channel |
| --- | --- | --- |
| a method of a class | `api/src/orders/orders.service.ts` | `orders:created` |
| a module-level function | `api/src/orders/notify.ts` | `orders:created` |
| a member of an object of functions | `api/src/orders/notify.ts` | `orders:invoiced` |
| a handler written in the registration | `api/src/orders/orders.routes.ts` | `orders:cancelled` |

`orders:created` is the control. `OrdersService.publishCreated` and
`notifyCreated` publish the same name with the same payload, and the graph holds
one channel with two producers hanging off it — one from a method, one from a
function — that differ in nothing but the body they belong to. Before R54 the
second of them did not exist.

The fourth row is why the ticket was raised now. A Next.js route handler is an
exported function and never a method, and so is an Express handler written in
the registration: `ordersRouter.post('/:orderId/cancel', (req, res) => …)`
publishes `orders:cancelled` from a body no class walk can reach.

`worker` has never seen any of those files. It names its three channels outright
and they join, which is the whole claim:

```
channel:orders:created     api  →  worker.onCreated
channel:orders:invoiced    api  →  worker.onInvoiced
channel:orders:cancelled   api  →  worker.onCancelled
```

With the class walk alone, `orders:created` had one producer instead of two and
the other two channels had none — three handlers listening to something nobody
sends, in a graph that said so with a straight face.

## The bus

There is no broker library here. `EventBus.publish` and `EventBus.subscribe` are
ordinary methods, and `adapters.broker.custom` in `flowatlas.config.json` is what
makes them a producer and a subscriber (I2: ordinary configuration, not a
privileged code path). `api` reaches it through a module-level constant and
`worker` through injection, because both are how a bus is actually held, and
neither should decide whether a publish is seen.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/fn-broker/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/fn-broker/worker/tsconfig.json --noEmit
```

`api` reaches a hand-written `express` stub in its own `node_modules`, the same
one `express-service` uses; `worker` reaches `@nestjs/common` through the shared
fixture manifest above it.
