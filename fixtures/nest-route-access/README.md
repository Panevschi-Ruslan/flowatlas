# nest-route-access

Three services, each guarding its routes a different way, so that one run
exercises everything the route audit reads about what stands in front of a
route and where it was put (P76).

| Service | How its routes are guarded | Expected |
|---|---|---|
| `catalog` | `{ provide: APP_GUARD, useClass: JwtAuthGuard }`, spread from an array in `auth/guards.ts` into what `AuthModule.forRoot()` returns | every route behind `JwtAuthGuard`, `meta.access.guards[].where: global`, `via: APP_GUARD in AuthModule.forRoot` |
| `catalog` | `@Public()` = `SetMetadata(IS_PUBLIC_KEY, true)`, read by `JwtAuthGuard` through the reflector | `GET /products/featured`: the guard `skippedBy: Public`, an opt-out with `public: true`; no row |
| `catalog` | `@OpenRoute()` = `applyDecorators(Public(), Header(...))` | `GET /products/:param/related`: as `@Public()`; no row |
| `catalog` | `@Public()` on the class | `GET /status/size`: `where: controller` opt-out; no row |
| `catalog` | `@Strict()`, a flag the guard reads that holds a request to more | `POST /products/import`: not an opt-out, the guard stays on; no row |
| `ledger` | `app.useGlobalGuards(new ApiKeyGuard(...))` in `main.ts` | `where: global`, `via: useGlobalGuards in src/main.ts` |
| `ledger` | `@SkipApiKey()`, a flag `ApiKeyGuard` reads that does not say "public" | `POST /entries/webhook`: `route-guard-skipped`, at `info` |
| `ledger` | `providers: [...LEDGER_PROVIDERS, ...extraProviders()]` | the array is followed; the call is a `module-providers-unread` row |
| `inventory` | `@UseGuards(SessionGuard)` on the controller | `where: controller`, `via: @UseGuards on StockController`; no row |
| `inventory` | a handler that throws `UnauthorizedException` itself | `POST /receipts`: `route-checked-in-body`, at `info`, naming the throw |
| `inventory` | nothing at all | `GET /levels/summary` and `GET /levels/low`: `route-unguarded` |

The two `route-unguarded` rows are what `flowatlas accept route-unguarded
--service inventory --path 'GET /levels/*' --note '...'` takes together, as one
rule; the CLI test runs exactly that against a copy of the built fixture.
