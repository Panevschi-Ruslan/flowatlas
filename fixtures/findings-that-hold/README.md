# findings-that-hold fixture

What `findings()` lists only where it holds (P395): a screen fed through a
stream that relays two channels, a screen fed through a stream one of whose
channels is looked up when it opens, an answer's fields read behind a presence
check beside one read plainly, contract breaks at warning beside one error,
and a route answering a type made of itself. Three repositories and one
configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/findings-that-hold/stores-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/findings-that-hold/back-office/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/findings-that-hold/shop-web/tsconfig.json --noEmit
```

`back-office/node_modules` holds hand-written stubs for `@nestjs/axios`,
`@nestjs/config` and `axios`; `shop-web/node_modules` one for `react`.

## The stores service - `stores-api` (Nest, `STORES_API_URL`)

- `OrdersService` publishes `ORDER_PLACED` and `ORDER_SHIPPED` on
  `shop:${shopId}:orders`; `AuditService` publishes `AUDIT_ENTRY_CREATED` and
  `ALERT_RAISED` on `shop:${shopId}:events`, both with redis.
- `LiveController`: `@Sse('stream')` subscribes to both channels in its body
  (`meta.relays` both); `@Sse('feed')` subscribes to the orders channel and to
  one whose name it fetches from the shop's settings when the stream opens,
  which is not read (`meta.relaysUnread: "1 subscription(s) behind GET
  /shops/:param/feed name a channel not read"`).
- `GET /stores/:id` answers `StoreCard` (`id`, `name`, `address`); `POST
  /stores` takes `CreateStoreBody`, every field required, `priceTier` a
  number; `GET /categories/tree` answers `type CategoryTree = string |
  CategoryTree[]`, a type made of itself.

- `BuildsService` publishes on `build_updates` through the project's own
  `BuildBus.publish` (`adapters.broker.custom`): `JOB_QUEUED` (`jobId`),
  `BUILD_DONE` (`artifactName`), `BUILD_STATUS` (`status`) and `BUILD_FAILED`
  (`reason`).

## The back office - `back-office` (Nest)

`StoresClient.create` posts a `StoreDraft`: seven fields the stores service
requires are optional in it (seven contract warnings) and `priceTier` is a
string (one contract error).

`BuildBot`'s handlers are each marked `@Consumes('build_updates')` and read no
type; `BuildRelayController.relay` (`POST /events/builds`) dispatches the
channel's messages with an `if`, two `else if`s (one handing the message on
through `as unknown as`) and an `else` (P397):

| Handler | Its parameter | The relay calls it under | Reads | Drawn |
|---|---|---|---|---|
| `handleJobQueued` | `JobQueuedEvent` (`JOB_QUEUED`) | `type === 'JOB_QUEUED'` | `jobId`, `priority` | `JOB_QUEUED`, via `if` |
| `handleBuildDone` | `BuildDoneEvent` (`BUILD_DONE`) | `type === 'BUILD_DONE'` | `artifactName` | `BUILD_DONE`, via `if` |
| `handleBuildRetry` | `BuildRetriedEvent` (`BUILD_RETRIED`) | `type === 'BUILD_FAILED'` | `attempt` | `BUILD_FAILED`, `meta.selectionDiffers` |
| `handleBuildStatus` | `BuildStatusEvent` (`BUILD_STATUS`) | the `else` | `status`, in the private `applyStatus` | `BUILD_STATUS`, via `parameter` |

## The shop's screens - `shop-web` (React)

| Screen | Through | Chooses |
|---|---|---|
| `handleLive` (`AuditLog`) | `GET /shops/:param/stream`: orders and events | `AUDIT_ENTRY_CREATED` (events), `ORDER_PLACED` (orders), `ORDER_REFUNDED` (published on neither) |
| `handleFeed` (`FeedPanel`) | `GET /shops/:param/feed`: orders and a channel not read | `ALERT_RAISED` |

`StorePage` fetches `GET /stores/:id` and reads `name`, `rating` (plainly),
`distance` through a local checked with `== null`, `address` behind `??`, and
`changesFromPrevious` through a local checked with `if (d)`. `CategoryMenu`
fetches `GET /categories/tree` and reads `label` and `children`.

## What it proves

`findings()`:

| Kind | Listed | Held back or counted |
|---|---|---|
| `type-never-published` | `ORDER_REFUNDED`, "which nothing publishes on the 2 channels it receives (shop:*:events, shop:*:orders)" | `ALERT_RAISED` on the feed: a channel it relays is not read |
| `answer-field-never-returned` | `rating` of `GET /stores/:param` | `distance` and `changesFromPrevious`, read behind a check that they are there (`guarded` in `check_contract`); the tree's reads, since `CategoryTree` is no shape read |
| `contract-break` | `priceTier` sent as `string`, declared `number` | 7 warnings under `warnings`, listed by `findings({kind: "contract-break", severity: "warning"})` |
| `field-never-sent` | `priority`, read by `handleJobQueued` under `JOB_QUEUED` | `attempt`: `handleBuildRetry`'s parameter says `BUILD_RETRIED`, the relay calls it for `BUILD_FAILED` |

Before P395, `AUDIT_ENTRY_CREATED` (checked against the orders channel alone)
and `ORDER_PLACED` (against the events channel alone) were both listed at
`high`, as was `ALERT_RAISED`; `distance` and `changesFromPrevious` were
listed; and the seven warnings were rows of `contract-break`. Before P397,
every handler of `build_updates` was compared under every type:
`artifactName` under `BUILD_FAILED`, `status` and `attempt` and `priority`
under `BUILD_DONE`, four rows at `high`, three about the wrong type.
