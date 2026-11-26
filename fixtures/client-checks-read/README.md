# client-checks-read

What clients already check, read as such (P402): a shop API, an Angular page
and a React app, each asking for an item and its counts together.

- `shop-api` (Nest) answers `GET /api/items/:id` with `id`, `name`, `price`
  and `status`, and `GET /api/items/:id/stats` with `views` and `saves`.
- `shop-web` (Angular) gathers both with `forkJoin({ item, stats })` into two
  members. Its template checks `promo` (`@if`) and `badge` (`?.`) before it
  reads them, reads `legacyCode` plainly, `??`s `shares`, and switches over
  `status` with no `@default`.
- `shop-app` (React) asks through a ky instance (`ky.create` with a
  `prefixUrl`, `credentials`, a header and a `beforeRequest` hook) and gathers
  both with `Promise.all`, destructured; it checks `promo` with a ternary and
  switches over `status` with a `default`.

| What the code does | What the graph has to say |
| --- | --- |
| the template reads `promo`, `badge` and `shares` behind a check | `guarded` reads; held back from `answer-field-never-returned` |
| the template and the app read `legacyCode` plainly | one finding each |
| `forkJoin({ item, stats })`, `Promise.all([item, stats])` | each answer's reads on its own request; nothing of the item read off the counts |
| `ky.create({ prefixUrl, credentials, headers, hooks })` | the requests join at the API's base, carry `credentials` and the headers `x-shop` and `x-trace`, and their answers are read |
| `switch (item.status)` with a default, `@switch` with none | `switched` on the read: `default`, `none`, and the cases |

`expected.mcp/` holds `check_contract` on both routes and the findings.
