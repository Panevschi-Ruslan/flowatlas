# multi-repo-rules

The bookshop of `fixtures/multi-repo` (a browser, its gateway, `orders` and
`billing`) with tags on its services and six architecture rules (P114, P203), for
`flowatlas rules`, the `rules` section of `doctor` and the MCP server's
`check_rules`.

A copy, not a link: `multi-repo`'s lines are pinned by ground-truth tests, and
this one changes three things in its code and one in its configuration.

## Tags

| Service | Tags |
|---|---|
| `web` | `frontend` |
| `gateway` | `edge` |
| `orders` | `domain` |
| `billing` | `domain` |

## What changed from `multi-repo`

| Where | What | Which rule it breaks |
|---|---|---|
| `flowatlas.config.json` | `web.apiTarget` names `ordersUrl` → `orders`, so the browser's request rooted at it joins `orders` straight | `frontends-reach-only-edge` |
| `billing/src/invoices/invoices.service.ts`, `order-row.entity.ts` | `markInvoiced` writes the `orders` table, which `orders` owns | `only-orders-writes-orders` |
| `gateway/src/audit/order-audit.consumer.ts` | a second `@EventPattern('order.created')` handler, in the gateway | `only-billing-consumes-order-events` |

## The rules

| Rule | Shape | Expected |
|---|---|---|
| `frontends-reach-only-edge` | `tags`: `frontend` may reach only `edge` | one violation, at `web/src/app/orders-api.service.ts:34` (`hits`) |
| `only-orders-writes-orders` | `only`: `orders` writes table `orders` | one violation, at `billing/src/invoices/invoices.service.ts:33` (`queries`); orders' own writes pass |
| `only-billing-consumes-order-events` | `only`: `billing` consumes `order.*` | one violation, at `gateway/src/audit/order-audit.consumer.ts:14` (`consumes`); billing's handler passes |
| `only-gateway-reaches-billing` | `only`, `reach: transitive` (P203): nothing but `gateway` reaches `billing`, by any path that does not go through `gateway` | one violation, at `orders/src/orders/orders.service.ts:49` (`emits`): `orders` publishes `order.created`, which billing's handler consumes, and nothing of the gateway's starts that publish; the gateway's own call to `POST /invoices`, and the browser's requests through the gateway, pass. Direct, the rule would hold: a consume is billing's own hop onto the channel |
| `order-created-keeps-a-consumer` | `reachable`, `must: true`: `order.created` reaches `billing` | holds |
| `typo-rule` | `forbid` naming service `biling` | unchecked, `rule-matches-nothing`, never a pass |

## The variant

`packages/cli/src/commands/rules.test.ts` builds a second copy whose billing
has no handler of `order.created`: it breaks `order-created-keeps-a-consumer`
as well - the fourth violation, with no place in a file, since a path that is
missing has no hop to point at. It is made by the test rather than kept here,
so every file in this fixture is one the configuration reads.

`expected.cli/` holds what `flowatlas rules` prints in each format, `--list`,
and `doctor` (`scripts/cli-snapshots.mjs`); `expected.mcp/` what the MCP
server answers (`scripts/mcp-snapshots.mjs`).
