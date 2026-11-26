## flowatlas spec diff

`HEAD~1` → `working tree`

### Changes

2 errors, 0 warnings, 3 infos · 2 breaking by kind, 0 of them with no caller in this project

Judged by use: 2 consumers in 3 repositories; consumers outside them unknown.

| level | change | operation | field | what | what its consumers do | deploy |
| --- | --- | --- | --- | --- | --- | --- |
| error | `endpoint-removed` | `orders` `GET /shipments/{id}` | — | the route is gone | 1 of 1 caller: requests it (breaking: the route is gone: every request to it fails) | callers first: move them off it, then orders |
| error | `request-property-added-required` | `orders` `POST /orders` | `body.channel` | head has `body.channel` as `string` and requires it; base did not | 1 of 1 caller: sends customerId, note; no `channel` (breaking: narrows the request: a caller must now send it) | callers first: send `channel`, then orders |
| info | `endpoint-added` | `billing` `receive order.gift-wrapped` | — | added on the head side | no publisher on the base side (compatible: added: nothing that worked before can rely on it) | — |
| info | `endpoint-added` | `orders` `GET /shipments/{id}/status` | — | added on the head side | no caller on the base side (compatible: added: nothing that worked before can rely on it) | — |
| info | `endpoint-added` | `orders` `send order.gift-wrapped` | — | added on the head side | no consumer on the base side (compatible: added: nothing that worked before can rely on it) | — |

- `endpoint-removed`: Every request to it now fails. Keep the route, or move its callers first.
- `request-property-added-required`: Callers written for the base side do not send it. Make it optional, or have every caller send it first.

The complete report is `<scratch>/project/.flowatlas/spec-diff.json`.

