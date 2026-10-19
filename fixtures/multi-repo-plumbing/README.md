# multi-repo-plumbing

Three services whose every method logs, counts and reads through a shared helper, so a walk that expands each helper once per caller spends its whole budget on plumbing before a request reaches the service it ends in (P92).

Type-checked, never executed.

| Service | What it is | The plumbing |
|---|---|---|
| `gateway` | NestJS, `POST /orders/:param/invoice` and two more routes | `AppLogger.log` (format, stamp, redact, mask, write, serialize) and `Metrics.count` (record, keyOf, and the logger again), called from every controller and client method |
| `orders` | NestJS, `POST /orders` and three more routes | the same logger and counter, `OrderRepository.findOne` and `save` (each counts, logs and queries `orders`), `OrderMapper.toDto`, and `OrderEvents.created`, which publishes `order.created` three calls below the route |
| `billing` | NestJS, `POST /invoices`, `GET /invoices/:param` and the `order.created` consumer | the same logger and counter, and `InvoiceStore.findOne` read by every service method |

The two flows P92 names, asked of `get_flow` with no options:

- `POST /orders` reaches `InvoicesConsumer.onOrderCreated` and `InvoicesService.create` in `billing`, through `OrderEvents.created`, the producer and `channel:order.created`.
- `POST /orders/:param/invoice` reaches `entry:billing:http:POST:/invoices` and the controller and service behind it.

Before P92 the walk was breadth first and skipped only a node already on its own path, so `AppLogger.log` and its six-row body were written under each of its callers. With `maxNodes: 60`, `POST /orders` stopped inside `orders` and never reached `billing`; with the old default of 150 it did, at about 22,000 characters. Now each node is written once - every other caller gets `{ id, ref: true, seenAt }` - the budget goes to crossings first and to plumbing (a method more than five methods call) last, and both flows fit the defaults (60 rows, about 12,000 characters) with room to spare.

`depth` stops both at the default eight hops, a little short of the bottom of `billing`'s own plumbing, and the answer says so: `stoppedBy: ["depth"]` and `≥n more nodes past depth 8; raise depth`.

The snapshots are `expected.mcp/`, from `scripts/mcp-snapshots.mjs`; the tests are `packages/mcp/src/tools/flow-plumbing.test.ts`.
