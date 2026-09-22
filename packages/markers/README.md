# @flowatlas/markers

Annotations for the few places static analysis cannot reach, for use with
[`@flowatlas/cli`](https://www.npmjs.com/package/@flowatlas/cli).

Every marker is a no-op at run time. It exists so the extractor can read it out
of the source, and it must never change how the annotated code behaves. The
package has no dependencies and does not use metadata reflection.

```sh
npm install -D @flowatlas/markers
```

---

## When to reach for one

Only where reading is genuinely blind: a channel name that arrives from
configuration, an address assembled at run time from a registry, a handler
registered through a table the analyser cannot follow. Annotating what can be
derived produces documentation that rots.

An edge declared by a marker is recorded with `confidence: "marker"` rather than
`"static"`, so it is always clear which edges were told rather than found.

---

## The five

```ts
import { CallsService, Emits, Consumes, FlowEntry, ContractIgnore } from '@flowatlas/markers';

class Orders {
  // The address is built at run time, so say where it goes.
  @CallsService('billing', 'POST /invoices')
  async requestInvoice(order: Order) {
    return this.http.post(this.registry.invoicesUrl(), order);
  }

  // The channel name comes from configuration.
  @Emits('order.created')
  async publish(order: Order) {
    return this.bus.emit(this.config.get('ORDER_TOPIC'), order);
  }
}
```

| Marker | Says |
|---|---|
| `CallsService(service, ...routes)` | this method calls those routes in that service |
| `Emits(...channels)` | this method publishes on those channels |
| `Consumes(...channels)` | this method handles messages from them |
| `FlowEntry(name)` | names the flow this entry point starts, for reporting |
| `ContractIgnore()` | drift across this boundary is intentional; report it, do not fail on it |

Each name may be given as one argument, as several, or as a list, and all three
mean what a stack of single annotations means — so a catalogue can be handed
over whole:

```ts
@Emits('cart:joined', 'cart:left')
@Emits(['cart:joined', 'cart:left'])
@Emits(CART_CHANNELS)
@CallsService('orders', 'POST /orders', 'GET /orders/:id')
```

`FlowEntry` takes exactly one name, deliberately: an entry point is where one
flow begins. Reading the list forms needs `@flowatlas/cli` 0.4.0 or newer.

`flowatlas doctor --section markers` reports any that point at something that is
no longer there, which is the failure mode annotations have.

There is also a comment form for functions that take no decorators:

```ts
/** @flowatlas-calls POST /invoices */
```

---

MIT. [Source, docs and issues](https://github.com/Panevschi-Ruslan/flowatlas).
