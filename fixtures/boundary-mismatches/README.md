# boundary-mismatches fixture

Protocol, validation, settings, status and CORS mismatches across the boundary,
listed by `findings` (P388): each where flowatlas reads both sides, gated on the
fact that makes it a defect, beside a decoy where that fact does not hold or the
two sides agree. Four repositories and one configuration, so `flowatlas build`
joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/boundary-mismatches/orders-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/boundary-mismatches/accounts-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/boundary-mismatches/web/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/boundary-mismatches/shop-bot/tsconfig.json --noEmit
```

## The orders service - `orders-api` (Nest)

- `main.ts` enables CORS for any origin by `*`, allowing `Authorization` and
  `Content-Type` and the verbs `GET`, `POST`, `PATCH`; the global
  `ValidationPipe` has `whitelist: true` and `forbidNonWhitelisted: true`.
- `OrdersController` (`orders`): `GET`, `POST` (body `CreateOrderDto`: `item`,
  `quantity`), `POST :id/cancel` (throws `NotFoundException` and
  `ConflictException`: 404 and 409), `POST :id/refund` (an `HttpException`
  whose status is computed), `PATCH :id`, `DELETE :id`.
- `StreamsController`: `@Sse('events')` maps each value to `{ data, type:
  'order-ready' }`, `@Sse('feed')` to `{ data }`, `@Sse('notices')` to `{ data,
  type: 'notice' }`.
- `OrdersService` reads `LOG_LEVEL` with a default, `PAYMENT_API_KEY`,
  `REDIS_URL` with none, `SMTP_HOST`, and `ORDER_MODE` with `??`.
- `.env.example` sets `PORT`, `LOG_LEVEL`, `PAYMENTS_API_KEY` and
  `LEGACY_EXPORT_DIR`; `docker-compose.yml` sets `SMTP_HOST` and `LOG_LEVEL`.

## The accounts service - `accounts-api` (Nest)

- `NestFactory.create(AppModule, { cors: { origin: ['https://shop.example.test'], credentials: true } })`.
- `ConfigModule.forRoot({ validationSchema })`; `GET /accounts/me` reads
  `SESSION_SECRET` with no default, set in no file.

## The shop - `web` (Angular)

- `OrdersApiService`: `list` gets `/orders` `withCredentials`; `create` posts
  `{ item, quantity, giftNote }`; `cancel` posts with `Authorization` and
  `X-Request-Id`; `refund` branches on 422 in its `catchError`; `rename`
  patches; `remove` deletes.
- `AccountsApiService.me` gets `/accounts/me` `withCredentials`.
- `LiveService` opens the three streams: `events` and `feed` with `onmessage`,
  `notices` with `addEventListener('notice', …)`.
- `OrderPanelComponent.cancel` subscribes to `cancel` and branches on 409 and
  410.

## The bot - `shop-bot` (Nest, Telegraf)

- `ShopBot.showOrder` builds four buttons: `order:confirm`,
  `` `order:cancel:${orderId}` ``, `order:track`, and one whose data is 66
  bytes.
- Handlers: `order:confirm`, `/^order:cancel:(\w+)$/`, `order:tracking`,
  `/^order:details:/`.

## What it proves

`findings()` lists, beside P384's kinds:

| Kind | Row | Decoy |
|---|---|---|
| `contract-break` (high) | `giftNote`, refused with 400 under `forbidNonWhitelisted` (`whitelist-reject`) | |
| `sse-event-unhandled` (high) | `GET /orders/events` sends `order-ready`; `LiveService.onReady` listens with `onmessage` only | `feed` (unnamed, `onmessage`), `notices` (`notice`, `addEventListener('notice')`) |
| `bot-button-unhandled` (high) | `order:track`, no handler | `order:confirm`, `order:cancel:${…}` against the pattern |
| `bot-button-data-too-long` (high) | the 66-byte button | the others |
| `config-name-mismatch` (high) | `PAYMENT_API_KEY` read, `PAYMENTS_API_KEY` set | |
| `status-never-answered` (high) | `OrderPanelComponent.cancel` branches on 410; the route answers 404, 409 | 409; 422 on `refund` held back (its status is computed) |
| `cors-credentials` (high) | `OrdersApiService.list` sends credentials to `*` | `AccountsApiService.me` to the named origin with `credentials: true` |
| `cors-header-not-allowed` (high) | `X-Request-Id` | `Authorization`, the JSON `Content-Type` |
| `cors-method-not-allowed` (high) | `DELETE` | `PATCH` |
| `config-not-set` (medium) | `REDIS_URL` | `LOG_LEVEL` (default), `ORDER_MODE` (`??`), `SMTP_HOST` (compose); `SESSION_SECRET` held back (a schema may give it a default) |
| `bot-handler-untriggered` (medium) | `order:tracking` | the other three |
| `config-never-read` (low) | `LEGACY_EXPORT_DIR` | `PORT` (the platform's) |
