## flowatlas diff

`HEAD~1` → `working tree`

| service | base | head | read |
| --- | --- | --- | --- |
| `billing` | 392089da | working tree | base from cache |
| `gateway` | working tree | working tree | unchanged |
| `orders` | 08ad86ef | working tree | base from cache |

## Warnings

- **ref-not-found** — gateway: ref HEAD~1 not found, so it was read as it stands and assumed unchanged Pass --service, or use a ref that exists in every repository.

## Impact

| changed | service | reachable from |
| --- | --- | --- |
| `InvoicesConsumer.onOrderCreated` | billing | 2 http entries (gateway, orders), 1 consumer (billing) |
| `ShipmentsService.track` | orders | 1 http entry (orders) |
| `billing` | billing | no entry points and nothing reaches it — see `flowatlas dead` |
| `GET /shipments/:param` | orders | 1 http entry (gateway); as of base — this node is gone in head |
| `OrdersService.legacy` | orders | no entry points and nothing reaches it — see `flowatlas dead` (as of base) |

<details><summary>InvoicesConsumer.onOrderCreated — ways in</summary>

| entry | service | kind | confidence |
| --- | --- | --- | --- |
| `entry:billing:event:order.created` | billing | event | static |
| `entry:orders:http:POST:/orders` | orders | http | static |
| `entry:gateway:http:POST:/orders` | gateway | http | static |

</details>

<details><summary>ShipmentsService.track — ways in</summary>

| entry | service | kind | confidence |
| --- | --- | --- | --- |
| `entry:orders:http:GET:/shipments/:param/status` | orders | http | static |

</details>

<details><summary>GET /shipments/:param — ways in</summary>

| entry | service | kind | confidence |
| --- | --- | --- | --- |
| `entry:gateway:http:GET:/orders/:param/shipment` | gateway | http | static |

</details>

## Changed flows

<details open><summary><code>POST /orders</code> (gateway) — 2 steps added, 1 changed; crosses gateway → orders → billing</summary>

```mermaid
sequenceDiagram
  autonumber
  actor n_caller as client
  box rgba(128,128,128,0.08) gateway
    participant n_gateway as gateway
  end
  box rgba(128,128,128,0.08) orders
    participant n_orders as orders
  end
  participant n_channel_order_created as order.created (topic)
  box rgba(128,128,128,0.08) billing
    participant n_billing as billing
  end
  participant n_channel_order_gift_wrapped as order.gift-wrapped (topic)
  n_caller->>n_gateway: POST /orders
  rect rgba(210,153,34,0.18)
    n_gateway->>n_orders: ~ POST /orders
    Note over n_gateway,n_orders: body: +channel (required)
  end
  n_orders-)n_channel_order_created: order.created
  n_channel_order_created-)n_billing: order.created
  rect rgba(46,160,67,0.18)
    n_orders-)n_channel_order_gift_wrapped: + order.gift-wrapped
    n_channel_order_gift_wrapped-)n_billing: + order.gift-wrapped
  end
```

```diff
  client → gateway POST /orders  · gateway/src/orders/gateway.controller.ts:11
~ gateway → orders POST /orders (body: +channel (required))  · gateway/src/clients/orders.client.ts:21
  orders → order.created (topic) order.created  · orders/src/orders/orders.service.ts:20
  order.created (topic) → billing order.created  · billing/src/invoices/invoices.consumer.ts:17
+ orders → order.gift-wrapped (topic) order.gift-wrapped  · orders/src/orders/orders.service.ts:23
+ order.gift-wrapped (topic) → billing order.gift-wrapped  · billing/src/invoices/gift-wrap.consumer.ts:15
```

</details>

<details><summary><code>GET /orders/:param/shipment</code> (gateway) — 1 step added, 1 removed; crosses gateway → orders</summary>

```mermaid
sequenceDiagram
  autonumber
  actor n_caller as client
  box rgba(128,128,128,0.08) gateway
    participant n_gateway as gateway
  end
  box rgba(128,128,128,0.08) orders
    participant n_orders as orders
  end
  n_caller->>n_gateway: GET /orders/:param/shipment
  rect rgba(248,81,73,0.18)
    n_gateway-xn_orders: − GET /shipments/:param
  end
  rect rgba(46,160,67,0.18)
    Note over n_gateway: + stops here: target-route-not-found
  end
```

```diff
  client → gateway GET /orders/:param/shipment  · gateway/src/orders/gateway.controller.ts:17
- gateway → orders GET /shipments/:param  · gateway/src/clients/orders.client.ts:26
+ gateway stops here: target-route-not-found  · gateway/src/clients/orders.client.ts:26
```

</details>

<details><summary><code>POST /orders</code> (orders) — 2 steps added, 1 changed; crosses orders → billing</summary>

```mermaid
sequenceDiagram
  autonumber
  actor n_caller as client
  box rgba(128,128,128,0.08) orders
    participant n_orders as orders
  end
  participant n_channel_order_created as order.created (topic)
  box rgba(128,128,128,0.08) billing
    participant n_billing as billing
  end
  participant n_channel_order_gift_wrapped as order.gift-wrapped (topic)
  rect rgba(210,153,34,0.18)
    n_caller->>n_orders: ~ POST /orders
    Note over n_caller,n_orders: body: +channel (required)
  end
  n_orders-)n_channel_order_created: order.created
  n_channel_order_created-)n_billing: order.created
  rect rgba(46,160,67,0.18)
    n_orders-)n_channel_order_gift_wrapped: + order.gift-wrapped
    n_channel_order_gift_wrapped-)n_billing: + order.gift-wrapped
  end
```

```diff
~ client → orders POST /orders (body: +channel (required))  · orders/src/orders/orders.controller.ts:23
  orders → order.created (topic) order.created  · orders/src/orders/orders.service.ts:20
  order.created (topic) → billing order.created  · billing/src/invoices/invoices.consumer.ts:17
+ orders → order.gift-wrapped (topic) order.gift-wrapped  · orders/src/orders/orders.service.ts:23
+ order.gift-wrapped (topic) → billing order.gift-wrapped  · billing/src/invoices/gift-wrap.consumer.ts:15
```

</details>

<details><summary><code>event order.gift-wrapped</code> (billing) — added, a way in the base did not have: 1 step</summary>

```mermaid
sequenceDiagram
  autonumber
  actor n_caller as broker
  box rgba(128,128,128,0.08) billing
    participant n_billing as billing
  end
  rect rgba(46,160,67,0.18)
    n_caller->>n_billing: + event order.gift-wrapped
  end
```

```diff
+ broker → billing event order.gift-wrapped  · billing/src/invoices/gift-wrap.consumer.ts:15
```

</details>

<details><summary><code>GET /shipments/:param</code> (orders) — removed, as of base: 1 step gone</summary>

```mermaid
sequenceDiagram
  autonumber
  actor n_caller as client
  box rgba(128,128,128,0.08) orders
    participant n_orders as orders
  end
  rect rgba(248,81,73,0.18)
    n_caller-xn_orders: − GET /shipments/:param
  end
```

```diff
- client → orders GET /shipments/:param  · orders/src/shipments/shipments.controller.ts:16
```

</details>

… 1 more changed flow: `GET /shipments/:param/status`; every flow is in <scratch>/project/.flowatlas/diff.json

Ways in whose steps did not change: `event order.created` (billing)

## Contract changes

1 new, 0 fixed, 0 already there, 2 excused

### New

| severity | kind | between | direction | field | what |
| --- | --- | --- | --- | --- | --- |
| error | missing_required | gateway → orders | request | channel | receiver orders requires `channel: string`; sender gateway does not send it |

### Excused

`@ContractIgnore` or `contracts.ignoreEdges` says this drift is deliberate. Never counted, never hidden.

| kind | between | field | by |
| --- | --- | --- | --- |
| extra_field | orders → billing | customerId | `billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated` |
| missing_required | orders → billing | customerRef | `billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated` |

## Rules

1 new, 0 fixed, 0 already there, 0 excused

### New

| rule | severity | what crossed | where | confidence |
| --- | --- | --- | --- | --- |
| `billing-stays-out-of-gift-wrapping` | error | billing GiftWrapConsumer.onGiftWrapped consumes channel order.gift-wrapped | `billing src/invoices/gift-wrap.consumer.ts:15` | static |

- `billing-stays-out-of-gift-wrapping`: gift wrapping is fulfilment, which orders does

## Calls that stopped joining

| caller | joined | what happened |
| --- | --- | --- |
| `http_out:gateway#src/clients/orders.client.ts:26:12` | `entry:orders:http:GET:/shipments/:param` | its target is gone; now `target-route-not-found` |

## Gaps and findings

2 new, 0 gone

| kind | reason | where | in |
| --- | --- | --- | --- |
| gap | `target-route-not-found` | `gateway src/clients/orders.client.ts:26` | `http_out:gateway#src/clients/orders.client.ts:26:12` |
| gap | `call-dynamic-receiver` | `orders src/shipments/shipments.service.ts:21` | `orders#src/shipments/shipments.service.ts:ShipmentsService.track` |

## Types

| type | what changed |
| --- | --- |
| `type:orders#CreateOrderDto` | head declares `channel` as `string` and requires it; base did not send it |

Added: `type:billing#GiftWrappedEvent`, `type:orders#OrderGiftWrappedEvent`

## Graph

|  | added | removed | changed | moved |
| --- | --- | --- | --- | --- |
| nodes | 7 | 2 | 3 | 12 |
| edges | 6 | 3 | 1 | — |
| types | 2 | 0 | 1 | — |

---

unresolved: 8 rows over 8 sites in head (+2 rows, +2 sites against base)

base <ms> · head <ms> · diff <ms> · <ms> total

