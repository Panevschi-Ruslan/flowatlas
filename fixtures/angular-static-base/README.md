# angular-static-base fixture

One Angular repository and one Nest repository, for the single question of what a
service's base address is allowed to look like.

The shape under test is a base URL kept in a **`static`** field and put together
with `+`:

```ts
private static readonly BASE = environment.apiUrl + '/items';
```

Nothing about it is exotic, and until the two fixes below neither half of it
could be read.

- A `static` field is a property access on the identifier naming the class
  rather than on `this`, and `this` was the only receiver anything looked for.
  The field was never opened, so the base was a hole (R103).
- `+` was not folded, so even opened the field held nothing. Two string literals
  added together were unreadable, which is what made this a bug rather than a
  limit: the checker gives no value for a `+`, whose type is the widened `string`
  however literal its operands (R102).

The two are one fixture because they are one line of ordinary code, and because
each hid the other: fixing only the receiver reads a field holding nothing, and
fixing only the fold reads a field nobody reaches.

Measured against PeerTube, which declares 63 such fields, these two readings
were the sole reason **none** of its 252 browser requests joined a route.

Extracted, from the repository root:

```
pnpm flowatlas build --config fixtures/angular-static-base/flowatlas.config.json
```

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/angular-static-base/web/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/angular-static-base/api/tsconfig.json --noEmit
```

## Routes — `api/src/items/items.controller.ts`

Three, and deliberately dull. They exist so that an address which was read has
something real to be joined to, and so that one which was not can be seen to
join nothing.

| Written | Entry |
|---|---|
| `@Get()` | `entry:api:http:GET:/items` |
| `@Get(':id')` | `entry:api:http:GET:/items/:param` |
| `@Post('pay')` | `entry:api:http:POST:/items/pay` |

## Requests — one row per `ui_api_call`

All four are in `web/src/app/items.service.ts`, and `ItemsService` holds three
`static` fields between them.

| Call site | Behind the field | Address | Joins | `unresolved.reason` |
|---|---|---|---|---|
| `findOne`, `get(\`${ItemsService.BASE}/${id}\`)` | `environment.apiUrl + '/items'` | `GET /items/:param` | `entry:api:http:GET:/items/:param` | — |
| `pay`, `post(\`${environment.apiUrl}${ItemsService.PAY}\`, {})` | `'/items' + '/pay'` | `POST /items/pay` | `entry:api:http:POST:/items/pay` | — |
| `list`, `get(\`${ItemsService.OPAQUE}/items\`)` | `environment.apiUrl + String(Date.now())` | `GET /${…}/items` | nothing | `api-path-partly-read` |
| `search`, `get(term + String(Date.now()))` | — | none | nothing | `api-path-dynamic` |

`findOne` is R103's shape whole: the field is reached through the class that
names it, and it holds the settings key together with the path it already wrote,
so the answer is both halves. `pay` is the half that needs the fold on its own —
the settings key is written at the call site and what is behind the field is two
literals, which nothing but folding them reads.

The last two are the discipline the template-literal path has always had, and
the reason this fixture is worth more than its two happy rows. A part that
cannot be read makes the whole thing unread, never half-read:

- `list` keeps the half that was settled first — the settings key — and holds
  everything after it as a hole nothing matches. Dropping the hole instead would
  report the request against `/items`, a route it may never reach, and the edge
  would claim to be `static` about it.
- `search` reads no address at all and says so with a row. Half an address is
  not an improvement on none; an invented one is worse than an unread one.

## Expected

```
ui calls: 4 total, 2 joined to a route, 2 not
          (api-path-dynamic 1, api-path-partly-read 1)
routes:   3 total, 2 reached, 1 never called
```

`GET /items` is the route nothing calls, which is what makes `routes.uncalled`
non-empty and therefore checked.

## `node_modules` in this fixture

Nothing is installed. `@angular/core`, `@angular/common/http` and `rxjs` under
`web/node_modules` are the same hand-written stubs the other Angular fixtures
use, holding only the declarations the extractor reads; `@nestjs/*` comes from
the stubs shared by every fixture at `fixtures/node_modules`.
