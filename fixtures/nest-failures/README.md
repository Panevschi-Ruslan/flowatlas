# nest-failures fixture

What each route can fail with (P68), written on the entry as `meta.fails`:
`[{ status, exception, at, file, line, source }]`, sorted by status.

- `POST /orders` — the class-level `AuthGuard('jwt')` (401, `guard`), and the throws of
  `OrdersService.create`: `HttpException` with `HttpStatus.CONFLICT` (409),
  `CouponRejectedError extends BadRequestException` (400), and, through the
  helper `assertInStock` the graph does not draw, `OutOfStockError`, whose
  constructor hands `HttpStatus.UNPROCESSABLE_ENTITY` to `super` (422). The
  method-level `ValidationPipe` adds no 400: the body is a type literal, so
  there is no class for it to validate (P87).
- `GET /orders/:id` — `ParseIntPipe` on `@Param` (400), `AuthGuard` (401),
  `NotFoundException` from the service (404).
- `DELETE /orders/:id` — `ParseIntPipe` (400), `AuthGuard` (401), `OwnerGuard`'s
  own `UnauthorizedException` (401) and its refusal when it returns false (403),
  and a plain `Error` (500, `assumed`: nothing on the path writes it). The `ConflictException` thrown inside a `try` the
  same method catches is not listed, and neither is the `throw error` rethrow.
