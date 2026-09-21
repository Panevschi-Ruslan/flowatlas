# nest-guards fixture

Exercises the full wrapping layer: middleware, guards, interceptors and pipes
applied globally, at class level and at method level, plus a custom
`@Roles('admin')` metadata decorator.

## Expected wrapping order

`GET /orders` (`OrdersController.findAll`) is the entry that collects every
layer. Per P01 §D7 the ordinal in `guarded_by.meta.order` is a single 0-based
sequence across the Nest request lifecycle
(middleware -> guards -> interceptors -> pipes), and within one layer
global -> class -> method, in declaration order.

Expected `guarded_by` edges from `entry:nest-guards:http:GET:/orders`:

1. `order: 0` — `LoggerMiddleware` — layer `middleware`, scope `route`
   (`consumer.apply(LoggerMiddleware).forRoutes('orders')`)
2. `order: 1` — `ApiKeyGuard` — layer `guard`, scope `global`
   (`app.useGlobalGuards(new ApiKeyGuard())` in `src/main.ts`)
3. `order: 2` — `AuthGuard('jwt')` — layer `guard`, scope `class`
   (first argument of the class-level `@UseGuards`, `meta.factoryArgs: ['jwt']`)
4. `order: 3` — `RolesGuard` — layer `guard`, scope `class`
   (second argument of the same class-level `@UseGuards`)
5. `order: 4` — `ThrottleGuard` — layer `guard`, scope `method`
   (`@UseGuards(ThrottleGuard)` on `findAll`)
6. `order: 5` — `MetricsInterceptor` — layer `interceptor`, scope `global`
   (`{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }` in `AppModule`)
7. `order: 6` — `LoggingInterceptor` — layer `interceptor`, scope `class`
   (`@UseInterceptors(LoggingInterceptor)` on the controller)
8. `order: 7` — `ValidationPipe` — layer `pipe`, scope `global`
   (`app.useGlobalPipes(new ValidationPipe())` in `src/main.ts`)
9. `order: 8` — `ValidationPipe` — layer `pipe`, scope `method`
   (`@UsePipes(ValidationPipe)` on `findAll`)

`ValidationPipe` is an external class (`@nestjs/common`), so both edges point at
the same node id `nest-guards#node_modules/@nestjs/common:ValidationPipe`; the
two edges differ only in `meta.scope` / `meta.order`. `AuthGuard('jwt')` is a
factory guard (§D9) and gets its own node keyed by `(class, args)`.

## Expected order on the other entries

- `GET /orders/health` — same chain minus `ThrottleGuard` and the method-level
  `ValidationPipe`; `LoggerMiddleware` still applies (`forRoutes('orders')`
  matches `/orders` and `/orders/*`), `requestIdMiddleware` does not
  (`.exclude('orders/health')`).
- `POST /orders` — same as `/orders/health`, plus a method-level pipe built in
  place, `@UsePipes(new ValidationPipe({ whitelist: true }))`: its own node
  `…ValidationPipe({"whitelist":true})` with `meta.factoryArgs`, the same way
  `new` is read in `main.ts`.
- `GET /admin/stats` — `requestIdMiddleware` (layer `middleware`, scope `route`,
  `order: 0`, from `{ path: 'admin/*', method: RequestMethod.ALL }`), then
  `ApiKeyGuard`, `MetricsInterceptor`, `ValidationPipe` (global). No
  `LoggerMiddleware`: `forRoutes('orders')` does not match `/admin/*`.
- `GET /admin/audit` — as `/admin/stats`, plus `RolesGuard` (layer `guard`, scope
  `method`, `meta.source: 'StaffOnly:UseGuards'`). `@StaffOnly('manager')` is a
  decorator of the project's own returning
  `applyDecorators(SetMetadata(...), UseGuards(RolesGuard))`, followed one level.

## Notes

- There is no `APP_GUARD` and no `useGlobalInterceptors` here, so the fixture
  does not depend on the unconfirmed relative order of `useGlobal*()` versus
  `APP_*` providers inside a single layer (P01 §D7 / §15 open question).
- `@Roles('admin')` carries no wrapping of its own; it is expected in the
  entry's `meta.decorators[]`, not as a `guarded_by` edge.

## `@flowatlas-auth`

`GET /admin/handover` carries `/** @flowatlas-auth … */` and nothing else: no
guard, no public decorator, no configured pattern. Expected: `authNote` on the
entry's `meta`, holding the words after the annotation, and no row from the
route audit for it. A handler that refuses a request in its own body has no
other way to say so, and it is a `marker` claim — unverifiable, worth what
whoever wrote it is worth (R33).
