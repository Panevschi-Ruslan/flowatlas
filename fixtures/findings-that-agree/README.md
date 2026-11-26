# findings-that-agree fixture

Findings and verdicts that agree with each other and with the code (P400): an
answer compared against what goes out on the wire, one whose interceptor is
not read held back, the handler of a relay's last `else` taking the remaining
types, and a webhook that hands its request to a bot's code. Three
repositories and one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/findings-that-agree/catalog-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/findings-that-agree/back-office/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/findings-that-agree/ops-web/tsconfig.json --noEmit
```

`catalog-api/node_modules` holds hand-written stubs for `class-transformer`
and `telegraf`.

## The catalog - `catalog-api` (Nest, `CATALOG_API_URL`)

- `main.ts` installs `EnvelopeInterceptor` for every route: `map((data) =>
  ({ success: true, data }))`, so every answer goes out as `{ success, data }`
  (`meta.answerWraps` on each route).
- `GET /products/:id` answers the class `ProductCard` (`id`, `name`, `price`,
  `costPrice` marked `@Exclude()`) behind `ClassSerializerInterceptor`: on
  the wire, `{ success, data: { id, name, price } }`.
- `GET /reports/daily` answers `DailyReport` (`date`, `orders`) behind
  `TotalsInterceptor`, whose `map` hands the report to a helper: what goes
  out is worked out when the code runs (`unread`).
- `CatalogService` publishes `PRICE_CHANGED` (`sku`, `price`), `STOCK_LOW`
  (`sku`, `left`) and `PRODUCT_RETIRED` (`sku`, `reason`) on `catalog_events`
  through the project's own `CatalogBus.publish` (`adapters.broker.custom`).
- `ChatBot` registers the command `stock` on the bot; `POST /tg/:secret`
  (`ChatHookController.receive`) hands the bot platform's updates to
  `ChatBot.handleUpdate`. Nothing in the project calls it, and neither its
  address nor its names say it receives a provider's posts.

## The back office - `back-office` (Nest)

`CatalogHandlers` marks two handlers `@Consumes('catalog_events')`; neither
reads the type. `CatalogRelayController.relay` (`POST /events/catalog`)
dispatches the channel's messages: `if (event.type === 'PRICE_CHANGED')` to
`onPriceChanged`, `else` to `onCatalogEvent`, whose parameter
(`CatalogMessage`, `type: string`) says no type. `onCatalogEvent` reads `sku`
and `reason`.

## The ops screens - `ops-web` (React)

- `productLine` fetches `GET /products/:id` and reads `success` (behind a
  check), `data.name`, `data.costPrice` and `price`.
- `reportLine` fetches `GET /reports/daily` and reads `data.date` and
  `data.revenue`.

## What it proves

| Question | Before P400 | After |
|---|---|---|
| `field-never-sent` | `reason` read by `onCatalogEvent` under `PRICE_CHANGED`: the else's handler chose no type, so it was compared under every type | `reason` under `STOCK_LOW`, the one remaining type that does not send it (`onCatalogEvent` takes `STOCK_LOW` and `PRODUCT_RETIRED`, `via: else`) |
| `message-type-unselected` | `STOCK_LOW` and `PRODUCT_RETIRED`, "nothing selects" | none: the else's handler selects both |
| `answer-field-never-returned` | `revenue` of `GET /reports/daily` listed; `success` held back as guarded; `data.costPrice` and `price` read as fields of the declared answer, not said | `data.costPrice` (left out by the serializer) and `price` (read at the top of the envelope; fix: read `data.price`) listed; `data.revenue` held back, the report's interceptor reshaping it in a way not read |
| `check_contract` on `GET /products/:id` | `missing`: `success` | `wire`: `{ data: ProductCard, success } (EnvelopeInterceptor); costPrice left out by ClassSerializerInterceptor (@Exclude)`; `missing`: `price` (`wrapped`), `data.costPrice` (`excluded`) |
| `dead` on `POST /tg/:secret` | `dead` | `unknown`, class `infrastructure`, role `bot`: it hands its request to `ChatBot.handleUpdate` |
