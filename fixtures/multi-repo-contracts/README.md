# multi-repo-contracts

Four repositories that disagree with each other on purpose, so that
`flowatlas contracts` has something true to say and something false it must not
say.

Everything here is written down twice: once in the source, and once as an
assertion in `packages/contracts/src/fixture.test.ts`. A recording of what the
tool said last time cannot tell you the tool is right; only a claim about the
repositories can, and that is what those tests are.

## The four

| service | what it is | its part |
|---|---|---|
| `gateway` | nestjs | the caller. Its `OrdersClient` and `WireClient` make every request measured here |
| `orders` | nestjs | the API. It answers the routes, publishes `order.created`, and handles `orders.get` |
| `billing` | nestjs | the other end of both channels: it handles `order.created` and asks `orders.get` |
| `web` | angular | the browser, which fails exactly the way a service does |

`@fx/wire` is the one package they share. It declares `MoneyDto` and nothing
else, so that at least one boundary in the fixture cannot drift.

## What each pair is for

| pair | expected |
|---|---|
| `MoneyDto` on `POST /orders/prices` | `shared` — one declaration, imported by both, no field walked |
| `AddressDto` on `POST /orders/addresses` | `identical` — two declarations, one shape, no field walked |
| `CreateOrderDto` on `POST /orders` | `missing_required channel`, `optionality_mismatch note`, `extra_field debugId` |
| `OrderDto` on `GET /orders/:id` | `type_mismatch total`: a number over there and text here |
| `CreateOrderDto` on `POST /orders/legacy` | the same drift, `@ContractIgnore`d: listed under `ignored`, never counted |
| `OrderCreatedEvent` on `channel:order.created` | `missing_required customerId`: a channel has no compiler between its ends |
| `GetOrderQuery` on `channel:orders.get` | `missing_required includeItems`, `extra_field includeRefunds` |
| `CreateOrderDto` / `OrderDto` from `web` | the same two halves, from a browser |
| `WireDto` on `POST /wire` | **no error at all** — one field per rule about what JSON does to a shape |
| `WireBrokenDto` on `POST /wire/broken` | three errors the rules must not hide, one of them a value the receiver has never heard of |
| `DeepDto` on `POST /deep` | a difference above the cut by name, one below it by depth |
| `CategoryDto` on `POST /deep/categories` | a shape that contains itself: the walk stops, the report does not |

## The wire pair, field by field

`gateway/src/clients/wire.dto.ts` declares each field as TypeScript sees it
before serialisation and `orders/src/wire/wire.dto.ts` declares the same field
as JSON delivers it. Neither is wrong. If a rule stops firing, a new error
appears here, which is the only way anybody would notice.

| field | caller | receiver | rule |
|---|---|---|---|
| `placedAt` | `Date` | `string` | `date-string` |
| `reference` | `bigint` | `string` | `bigint-string` |
| `signature` | `Buffer` | `string` | `buffer-string` |
| `note` | `string \| undefined` | `string?` | `undefined-vanishes` |
| `secret` | `@Exclude()` | optional | `class-transformer` |
| `customerId` | `@Expose({ name: 'customer_id' })` | `customer_id` | `class-transformer` |
| `coupon` | `@Transform(…)` | `number` | `class-transformer` |
| `extras` | `any` | `unknown` | `any-unknown-skip` |
| `channel` | `enum Channel` | `'web' \| 'phone'` | none: the same set of values |
| `tags` | `Set<string>` | `string[]` | `set-map-json`, one warning |
| `counts` | `Map<string, number>` | `Record<string, number>` | `set-map-json`, one warning |
| `shipping_city` | plain | `@Expose({ name: 'shipping_city' })` | `class-transformer`, on the receiving side |
| `internalNote` | plain | `@Exclude()` | one `extra_field`: what is sent lands nowhere |
| `score` | `string` | `@Transform(…)` `number` | `class-transformer`, on the receiving side |

`gateway`'s `tsconfig.json` is the only one here that asks for `strict` and for
the Node types. Without the first, `string | undefined` collapses to `string`
before the extractor sees it and the rule about a field that admits nothing has
nothing to fire on; without the second there is no `Buffer`.

## The stubs

Each repository carries its own copy of `node_modules/@fx/wire`, byte for byte
identical, so the fixture resolves with no install and `MoneyDto` merges into
one registry entry. The workspace copy in `shared/wire/src` is the same text
again. Change one and change all three.
