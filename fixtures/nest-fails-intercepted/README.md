# nest-fails-intercepted fixture

What a route fails with once its interceptors have had their say (P207): a
bookshop API whose `main.ts` installs a global `ValidationPipe`, a global
`TimeoutInterceptor` (the framework's documented one: `timeout(5000)`, then a
`catchError` that turns a `TimeoutError` into a `RequestTimeoutException` and
hands every other error on) and a global `ShopErrorFilter`
(`@Catch(ShopError)`, answering `e.status`). `AppModule` registers an
`AuditInterceptor` as `APP_INTERCEPTOR`, which logs and rethrows. The shop's
own errors state their status: `BookNotFound` 404, `StockExhausted` 409,
`ReportUnavailable` 503; `PlainFailure extends Error` states none.

Interceptors run inside the filters and around the pipes and the handler: the
application's first, then the controller's, then the handler's, so an error
meets the handler's innermost one first and what the outermost gives goes to
the filters. A guard refuses before any interceptor runs.

The hand-checked list, which the snapshot must match:

| Route | Fails with |
|---|---|
| `GET /books/:id` | 403 `ForbiddenException` (`MemberGuard`, before the interceptors); 408 `RequestTimeoutException` (`TimeoutInterceptor`); 502 `BadGatewayException`: the controller's `UpstreamInterceptor` maps every error to it, so neither `BookNotFound` (404) nor `PlainFailure` (500) reaches the caller. `ClassSerializerInterceptor` hands errors on. |
| `GET /books/:id/price` | 403; 408. The handler's `FallbackPriceInterceptor` answers every error with `of({ price: 0 })`, so its `BookNotFound` never fails the request. |
| `POST /orders` | 400 `BadRequestException` (validation: a pipe runs inside the interceptors, and `StockInterceptor` hands it on); 404 `NotFoundException` (`StockInterceptor`'s `throw` for a `BookNotFound`); 408; 409 `ConflictException` (`StockInterceptor`'s `throwError` for a `StockExhausted`); 500 `PlainFailure`, `assumed` (handed on, and the filter does not catch it). |
| `GET /reports/sales` | 408; 429 `HttpException`, which the inner `QuotaInterceptor` throws itself and the outer `ReportErrorsInterceptor` keeps (`err instanceof HttpException ? throwError(() => err) : ...`); 503 `ReportUnavailable`, which `ReportErrorsInterceptor` gives in place of the service's `PlainFailure`, and the global filter answers with its own status. |
| `GET /stats/:id` | 404 `BookNotFound`, `assumed`: `TranslateInterceptor` hands every error to `this.translate(err)`, which cannot be read, and is a `fails-interceptor-unread` row; 408. |

`TimeoutInterceptor`'s 408 is on every route, raised by its own `timeout()`
and written at its `RequestTimeoutException`; a failure an interceptor gives
in place of another has `source: 'interceptor'` and is written where the
interceptor writes it.
