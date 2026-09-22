# multi-repo-doctor

Three services that are wrong in every way `flowatlas doctor` can name, so that
one run over this fixture exercises all five of its sections at once.

```
gateway ──http──▶ orders ──event──▶ billing
```

Nothing here is meant to be good code. Every file is a case, and the comment
above each one says which.

## What each section is supposed to find

**`markers` — five errors and four warnings.** An annotation asserts something
no compiler checks, which makes it the one claim in the graph nothing else can
catch when it goes stale.

| Where | Annotation | Expected |
|---|---|---|
| `orders` `OrdersService.create` | `@Emits('order.created')` beside a real `emit` of the same channel | `marker-emits-shadowed`, warning |
| `orders` `OrdersService.audit` | `@Emits('order.audited')` on a method that publishes nothing | `marker-emits-without-emit`, **error** |
| `orders` `OrdersService.archive` | `@Emits(channelFor('archived'))` | `marker-unknown-arg`, **error** |
| `orders` `OrdersService.refund` | `@Emits('order.refunded')` where the channel is read from settings | nothing: the annotation is the only thing that can name it (I10) |
| `orders` `OrdersService.settle` | `@FlowEntry('checkout')` on a plain provider method | `marker-flowentry-not-handler`, warning |
| `orders` `OrdersService.reconcile` | `@ContractIgnore()` on a method on no boundary | `marker-contractignore-unused`, warning |
| `billing` `InvoicesConsumer.onOrderCreated` | `@Consumes('order.created')` beside `@EventPattern('order.created')` | `marker-consumes-shadowed`, warning |
| `billing` `InvoicesService.onOrderRefunded` | `@Consumes('order.refunded')` on a method nothing subscribes and nothing calls | `marker-consumes-without-consumer`, **error** |
| `gateway` `OrdersClient.create` | `@CallsService('orders', 'POST /orders')` on an address built at run time | nothing: the annotation is doing its job |
| `gateway` `OrdersClient.cancel` | `@CallsService('orders', 'DELETE /orders/:id/void')` | `marker-callsservice-route-missing`, **error** |
| `gateway` `OrdersClient.restock` | `@CallsService('warehouse', …)` | `marker-callsservice-unknown-service`, **error** |

**`desync` — two rows.** `OrdersClient.void` writes its address out through
`ORDERS_URL`, so it is placed without help, at a path `orders` does not serve:
`target-route-not-found`. `OrdersClient.history` is rooted at `LEGACY_URL`,
which no service in `flowatlas.config.json` claims: `unknown-base-url-env`.

**`contracts` — one error and one excused.** `orders` requires `channel` on the
way in and the gateway's copy of `CreateOrderDto` does not declare it. The same
drift reaches `POST /orders/legacy` through a method carrying `@ContractIgnore`,
so those findings are counted under `ignored` and fail nothing.

**`unresolved` — 21 places over ten reasons,** enough for the grouping to be
worth looking at: a data layer with no descriptor (`fake-orm`), three addresses
built at run time, a channel read from settings, a token no module provides,
and the three `orders` routes that reach stored data with no guard in front of
them (`route-unguarded`).

**`baseline` — three files, three answers.** See `make-baselines.mjs`:

| File | Against this graph |
|---|---|
| `baseline.accepted.json` | what `--accept` writes here; `--strict` exits 0 |
| `baseline.smaller.json` | one place fewer was accepted, so the project grew; `--strict` exits 1 |
| `baseline.moved.json` | the same number of places, one in a file since renamed; `--strict` exits 0 and the report names what moved |

The three fields that legitimately differ between two runs — `acceptedAt`,
`acceptedBy`, `flowatlasVersion` — and the graph's `builtAt` are pinned in all
three, which is what makes them committable. Regenerate with:

```sh
pnpm flowatlas doctor --config fixtures/multi-repo-doctor/flowatlas.config.json \
  --accept --baseline fixtures/multi-repo-doctor/baseline.accepted.json
node fixtures/multi-repo-doctor/make-baselines.mjs
```

## What is deliberately not here

No bot and no browser. `dynamic-bot-trigger` and the Angular reasons are
recorded and grouped exactly like the nine reasons this fixture does hold, and
`fixtures/nest-telegraf` and `fixtures/angular-basic` already read them; a
fourth and fifth repository here would add a minute to every `pnpm check` to
exercise the same grouping code with different strings in it.

## Two tokens in one group (R35)

`OrdersService`'s constructor asks for two tokens nothing provides,
`EVENTS_CLIENT` and `AUDIT_CLIENT`. That makes one `di-token-unknown` group
whose two rows say different things, which is the shape a heading can be wrong
about: the heading has to say what the *kind* means and name neither token,
and each row's own sentence has to read as belonging to the site it sits under.
A group whose rows all say one thing cannot catch that, which is why there are
two.
