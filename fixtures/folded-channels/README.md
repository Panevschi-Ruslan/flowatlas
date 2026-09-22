# folded-channels fixture

One service publishes to a channel whose name it builds; another subscribes to
the three names that publish can actually reach. Two repositories and one
configuration, so `flowatlas build` joins them.

The point of it is R42 at the level of a project rather than a unit test. The
publish is written once:

```ts
publishLifecycle(orderId: string, state: OrderState, event: LifecycleEvent): void {
  const verb = state.slice('ORDER_'.length).toLowerCase().replace(/_/g, '-');
  this.bus.publish(`order:${orderId}:${verb}`, event);
}
```

`OrderState` is `'ORDER_OPENED' | 'ORDER_ON_HOLD' | 'ORDER_CLOSED'`, and every
step from it is a pure string operation over literals. So `verb` is a closed set
of three, the template is folded once per member, and the graph holds

```
channel:order:*:opened        api  →  worker.onOpened
channel:order:*:on-hold       api  →  worker.onHeld
channel:order:*:closed        api  →  worker.onClosed
channel:order:*:*:archived    api  →  nothing
```

The fourth is the control. `archiveInRegion` takes `region: string`, the set is
not closed, and the hole stays a hole — the reader expands what the code pins
down and guesses nothing else.

`worker` has never seen `OrderState`. It names its three channels outright, and
they join because the fold worked out what the template reaches; without it all
three would hang off `order:*:*` and the worker would look like it listens to
something nobody sends.

## What `doctor` says

`OrdersService.publishLifecycle` carries three `@Emits` that name the three
channels the fold already finds, so all three are reported:

```
marker-emits-shadowed  api src/orders/orders.service.ts:21
  @Emits("order:*:opened") on OrdersService.publishLifecycle says what the code already says
```

All three, and not one of them — a producer reaching several channels is what
R42 made possible, and reading only its first `emits` edge answered for one
channel and left the other two unreported (R44).

Delete the three annotations and rebuild: the four channels and the four `emits`
edges are unchanged. That is the whole claim, and it is checked here rather than
asserted.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/folded-channels/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/folded-channels/worker/tsconfig.json --noEmit
```

Both repositories reach `@nestjs/common` and `@flowatlas/markers` through the
shared fixture manifest above them.

## The bus

There is no broker library here. `EventBus.publish` and `EventBus.pSubscribe`
are ordinary methods, and `adapters.broker.custom` in `flowatlas.config.json` is
what makes them a producer and a subscriber (I2: ordinary configuration, not a
privileged code path). Each repository carries its own copy of the client, which
is how a project that has not yet extracted a shared package actually looks.
