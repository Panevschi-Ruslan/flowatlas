## flowatlas spec diff

`HEAD~1` → `working tree`

### Changes

3 errors, 3 warnings, 3 infos · 9 breaking by kind, 1 of them with no caller in this project

Judged by use: 6 consumers in 3 repositories; consumers outside them unknown.

| level | change | operation | field | what | what its consumers do | deploy |
| --- | --- | --- | --- | --- | --- | --- |
| error | `method-removed` | `catalog` `DELETE /items/{id}` | — | the path no longer answers this verb | 1 of 1 caller: requests it (breaking: the path no longer answers this verb) | callers first: move them off it, then catalog |
| error | `request-property-added-required` | `catalog` `POST /items` | `body.currency` | head has `body.currency` as `string` and requires it; base did not | 1 of 1 caller: sends name, price; no `currency` (breaking: narrows the request: a caller must now send it) | callers first: send `currency`, then catalog |
| error | `message-property-removed` | `catalog` `send item.changed` | `payload.label` | base had `payload.label` as `string`; head has no such field | 1 of 1 consumer: reads `label`, line 16 (breaking: the message no longer carries it) | consumers first: stop reading `label` (or cope without it), then catalog |
| warning | `response-property-removed` | `catalog` `GET /items/{id}` | `response.price` | base had `response.price` as `number`; head has no such field | 1 of 1 caller: which fields of the answer it reads is not read yet, so whether it reads `price` is not known (breaking: the answer no longer holds it) | callers first: stop relying on `price`, then catalog |
| warning | `response-property-removed` | `catalog` `POST /items` | `response.price` | base had `response.price` as `number`; head has no such field | 1 of 1 caller: which fields of the answer it reads is not read yet, so whether it reads `price` is not known (breaking: the answer no longer holds it) | callers first: stop relying on `price`, then catalog |
| warning | `message-property-removed` | `catalog` `send stock.changed` | `payload.warehouse` | base had `payload.warehouse` as `string`; head has no such field | 1 of 1 consumer: takes the message whole (spread into another value, line 17), so whether it reads `warehouse` is not known (breaking: the message no longer carries it) | consumers first: stop reading `warehouse` (or cope without it), then catalog |
| info | `response-property-removed` | `catalog` `GET /items/{id}/archive` | `response.reason` | base had `response.reason` as `string`; head has no such field (no caller in this project) | nothing in the 3 repositories read calls it (breaking: the answer no longer holds it) | — |
| info | `request-property-became-required` | `catalog` `POST /drafts` | `body.title` | `body.title` could be left out in base and is required in head | every caller sends `title`, among 1 (breaking: narrows the request: a caller must now send it) | — |
| info | `message-property-removed` | `catalog` `send item.changed` | `payload.legacyCode` | base had `payload.legacyCode` as `string`; head has no such field | no consumer reads `legacyCode`, among 1 (breaking: the message no longer carries it) | — |

- `method-removed`: The path still answers other verbs, not this one. Keep the verb, or move its callers first.
- `request-property-added-required`: Callers written for the base side do not send it. Make it optional, or have every caller send it first.
- `message-property-removed`: Consumers that read it get nothing. Keep sending it, or change the consumers first.

The complete report is `<scratch>/project/.flowatlas/spec-diff.json`.

