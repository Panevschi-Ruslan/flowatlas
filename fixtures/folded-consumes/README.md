# folded-consumes fixture

One subscription, written once, that reaches three channels — and three
`@Consumes` on the handler that restate what it already says.

This is the receiving half of `folded-channels`. There the publish is folded and
the annotations are `@Emits`; here the subscription is folded and the
annotations are `@Consumes`, which is the half that was still reading one
`consumes` edge and reporting one row (R45).

```ts
private subscribeTo(state: OrderState): void {
  const verb = state.slice('ORDER_'.length).toLowerCase().replace(/_/g, '-');
  this.bus.pSubscribe(`order:${verb}`, (event: LifecycleEvent) => this.onLifecycle(event));
}
```

`OrderState` is `'ORDER_OPENED' | 'ORDER_ON_HOLD' | 'ORDER_CLOSED'`, so `verb` is
a closed set of three, the template is folded once per member, and the graph
holds

```
channel:order:opened   →  LifecycleProjections.onLifecycle
channel:order:on-hold  →  LifecycleProjections.onLifecycle
channel:order:closed   →  LifecycleProjections.onLifecycle
```

## What `doctor` says

`onLifecycle` carries one `@Consumes` per channel the subscription reaches, and
all three are reported:

```
marker-consumes-shadowed  worker src/projections/lifecycle.service.ts:49
  @Consumes("order:opened") on LifecycleProjections.onLifecycle says what the code already says
  @Consumes("order:on-hold") …
  @Consumes("order:closed") …
```

All three, and not one of them. Before R45 the check found the consumers that
hand the method a message and then read the *first* `consumes` edge of each, so
whichever channel happened to come back first was reported and the other two
looked like claims nothing in the code supported. A reader who followed the one
row and deleted the one annotation was left with two more, and no row to say so.

Deleting all three leaves the three channels and the three `consumes` edges
exactly as they are, which is the claim that makes "remove it" safe advice. It
holds because the extractor records each folded name as already static and the
annotation pass then draws nothing for it — so no `consumes` edge here carries
`marker` confidence, and there is no second consumer node. `expected.project-graph.json`
is where that is checked rather than asserted: three `consumes` edges, all
`static`, and one consumer whose `decorator` is `pSubscribe`.

There is no publisher in this project, on purpose. Whether a channel is reached
from somewhere else is a different question from whether an annotation on this
handler restates the code, and the fixture is deliberately the smallest thing
that asks the second one.

## The bus

There is no broker library here. `EventBus.publish` and `EventBus.pSubscribe`
are ordinary methods, and `adapters.broker.custom` in `flowatlas.config.json` is
what makes them a producer and a subscriber (I2: ordinary configuration, not a
privileged code path).

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/folded-consumes/worker/tsconfig.json --noEmit
```

It reaches `@nestjs/common` and `@flowatlas/markers` through the shared fixture
manifest above it.
