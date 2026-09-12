# ground-truth fixture

Two repositories holding the shapes the other fixtures never write down, and one
thing none of them has: **no recorded graph**. Everything this fixture claims is
in the table below, read off the source by hand, and asserted one property at a
time in `packages/cli/src/commands/ground-truth.test.ts`.

That is the point of it (R09). A recorded graph proves the answer has not
changed; it cannot tell a right answer from a wrong one, and if the recording was
taken while the answer was wrong it preserves the mistake. So there is no
`expected.graph.json` here and nothing to regenerate: to change what this fixture
says, change what it says.

Built, from the repository root:

```
pnpm flowatlas build --config fixtures/ground-truth/flowatlas.config.json
```

Type-checked, never executed. Both are clean:

```
./node_modules/.bin/tsc -p fixtures/ground-truth/api/tsconfig.json    --noEmit
./node_modules/.bin/tsc -p fixtures/ground-truth/client/tsconfig.json --noEmit
```

## Services

| Service | Path | Type | `baseUrlEnv` |
|---|---|---|---|
| `api` | `./api` | nestjs | `["API_URL"]` |
| `client` | `./client` | nestjs | — |

## Routes — every one, read off the decorators

| Entry | Declared at | Handled by |
|---|---|---|
| `entry:api:http:GET:/orders/:param` | `api/src/orders/orders.controller.ts:17` | `OrdersController.findOne` |
| `entry:api:http:GET:/o/:param` | same decorator, second name in the list | `OrdersController.findOne` |
| `entry:api:http:PATCH:/orders/:param` | `api/src/orders/orders.controller.ts:22` | `OrdersController.rename` |
| `entry:api:http:PATCH:/o/:param` | same decorator, second name in the list | `OrdersController.rename` |
| `entry:api:http:GET:/files/latest` | `api/src/files/files.controller.ts:13` | `FilesController.latest` |
| `entry:api:http:GET:/files/*` | `api/src/files/files.controller.ts:18` | `FilesController.any` |
| `entry:api:http:GET:/reports/:param` | `api/src/reports/reports.controller.ts:11` | `ReportsController.ofKind` |

Seven, because `@Controller(['orders', 'o'])` is two prefixes and each method
under it opens a way in per prefix. A person may type either name and the running
service answers both, so a graph holding only the first says a route does not
exist when it does — the same under-report R02 found in `bot.command([...])`.

## Requests — one row per `http_out`

All three are in `client/src/orders/orders.client.ts`, all rooted at `API_URL`,
which `api` declares.

| Call site | line | Address | Reaches | Bucket |
|---|---|---|---|---|
| `http.patch(...)` | 21 | `${API_URL}/orders/${id}` | `entry:api:http:PATCH:/orders/:param`, `static`, `via: baseUrlEnv` | `linked` |
| `http.get(...)` | 26 | `${API_URL}/files/latest` | `entry:api:http:GET:/files/latest`, `static` — **not** the catch-all, which also answers | `linked` |
| `http.get(...)` | 35 | `${API_URL}/reports/${REPORT_PATHS[kind]}` | nothing | `dynamic` |

The third is the one worth arguing about. `api` really does serve
`GET /reports/:kind`, and the address really does look like `/reports/` followed
by one segment. But the segment is one of the names the project writes down,
picked by a lookup, and a route declares a hole for values rather than for a
choice between the names the caller keeps in a table. Joining it would draw a
confident edge to a route this call may never reach (R01, R05), so its path keeps
the unread span and matches nothing.

## Counts

```jsonc
"httpOut": { "total": 3, "linked": 2, "byMarker": 0, "unknownEnv": 0,
             "noRoute": 0, "ambiguous": 0, "external": 0, "dynamic": 1 }
"routes":  { "total": 7, "called": 2, "duplicated": [] }
```

Two routes are reached, so five are `uncalled`, `GET /o/:param` and
`PATCH /o/:param` among them: an alias nobody calls is still a way in.

## What each shape defends

| Shape | The wrong answer it catches |
|---|---|
| `@Controller(['orders', 'o'])` | keeping the first name of a list, so half the routes vanish with nothing said |
| `http.patch(...)` | a verb table that maps a verb to the wrong one; nothing else in `fixtures/` writes a request that is not a GET or a POST |
| `@Get('*')` beside `@Get('latest')` | counting a catch-all as a segment spelled out, so `*` wins the tie and the literal route reads as reached by nobody |
| `${REPORT_PATHS[kind]}` | a hole that picks a name read as a hole that carries a value, which is a `static` edge to a route nobody asked for |

## `node_modules` in this fixture

`@nestjs/common` and `@nestjs/core` resolve through the shared
`fixtures/node_modules`. `@nestjs/axios` and `@nestjs/config` are hand-written
stubs in `fixtures/ground-truth/node_modules`, holding only the declarations the
extractor reads; the `@nestjs/axios` one carries `patch`, `put` and `delete` as
well as `get` and `post`, which is the only way the third verb has a type to be
recognised by.
