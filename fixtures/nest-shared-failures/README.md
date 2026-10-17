# nest-shared-failures fixture

Many ways in that fail the same ways (P84): the page ships each failure once.

A shop API with three controllers (`orders`, `billing`, `catalog`), six routes
each, all behind the same checks and all calling one service:

| Written | What the routes fail with |
|---|---|
| `{ provide: APP_GUARD, useClass: ApiKeyGuard }` | the `UnauthorizedException` the guard throws (401, `throw`) and its refusal when it returns false (403, `guard`) |
| `app.useGlobalPipes(new ValidationPipe(...))` in `main.ts` | 400, `pipe` |
| `ShopService.find` / `save` / `load`, called from every handler | `NotFoundException` (404) and `ConflictException` (409), `throw`, written once in `src/shared/shop.service.ts` |

Each handler also writes one line to its log (`this.logger.log` / `warn`), with a
template per route.

Eighteen routes repeat the same five failures, so the page's `fails` block is
one record per distinct failure (`dicts.fails`) and a list of record positions
per route, rather than one object per failure per route. The graph itself is
unchanged: `meta.fails` on every entry still lists each failure in full.
