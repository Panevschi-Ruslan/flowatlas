## Architecture rules

rules: 5 checked · 3 broken · 1 unchecked · errors=3 warnings=0 infos=0 · excused=0

| Rule | Shape | Severity | Status | Why |
|---|---|---|---|---|
| `frontends-reach-only-edge` | tags | error | broken (1) | the browser talks to the gateway, never to a domain service |
| `only-orders-writes-orders` | only | error | broken (1) | orders owns its table; everyone else asks orders |
| `only-billing-consumes-order-events` | only | error | broken (1) | order events are billing's to act on |
| `order-created-keeps-a-consumer` | reachable | error | held | an order nobody invoices is lost money |
| `typo-rule` | forbid | error | unchecked | names a service that does not exist, so it is never a pass |

### Violations

| Rule | What crossed | Where | Via | Confidence |
|---|---|---|---|---|
| `frontends-reach-only-edge` | web (frontend) requests orders GET /orders/:param, and orders carries none of edge | `web/src/app/orders-api.service.ts:34` | hits | static |
| `only-billing-consumes-order-events` | gateway OrderAuditConsumer.onOrderCreated consumes channel order.created, which only service billing may | `gateway/src/audit/order-audit.consumer.ts:14` | consumes | static |
| `only-orders-writes-orders` | billing writes table orders (billing), which only service orders may | `billing/src/invoices/invoices.service.ts:33` | queries | static |

### Not checked

- `typo-rule`: not checked (to): service "biling" names nothing in this graph; did you mean billing? (`rule-matches-nothing`)
