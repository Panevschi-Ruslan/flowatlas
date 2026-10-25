## flowatlas spec diff

`HEAD~1` → `working tree`

### Changes

2 errors, 0 warnings, 3 infos · 2 breaking by kind, 0 of them with no caller in this project

| level | change | operation | field | what | callers on the base side |
| --- | --- | --- | --- | --- | --- |
| error | `endpoint-removed` | `orders` `GET /shipments/{id}` | — | the route is gone | `gateway src/clients/orders.client.ts:26` |
| error | `request-property-added-required` | `orders` `POST /orders` | `body.channel` | head has `body.channel` as `string` and requires it; base did not | `gateway src/clients/orders.client.ts:21` |
| info | `endpoint-added` | `billing` `receive order.gift-wrapped` | — | added on the head side | — |
| info | `endpoint-added` | `orders` `GET /shipments/{id}/status` | — | added on the head side | — |
| info | `endpoint-added` | `orders` `send order.gift-wrapped` | — | added on the head side | — |

- `endpoint-removed`: Every request to it now fails. Keep the route, or move its callers first.
- `request-property-added-required`: Callers written for the base side do not send it. Make it optional, or have every caller send it first.

The complete report is `<scratch>/project/.flowatlas/spec-diff.json`.

