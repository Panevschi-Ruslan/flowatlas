# settings-chains-paired-calls fixture

A Remix `market`, read by both halves, whose three requests are each made by a
route's `loader` on the server and by a click in the browser: every one is a
`ui_api_call` and an `http_out` naming each other under `meta.sameCall`
(P283). Three services answer them. What P292 reads:

1. **A chain of `||` over settings.** `APP_URL` is
   `withScheme(process.env.PUBLIC_APP_URL) || PREVIEW_URL || 'http://localhost:4300'`.
   `withScheme` is a function of the repository whose every return is its
   parameter, the parameter after a scheme, or the empty text, so the call is
   the setting; the chain is rooted at `PUBLIC_APP_URL`, the text it ends in
   its fallback (`baseUrlDefault`). Before, the address was `/${…}/api/listings`
   with a row.
2. **A value at a port only the code says a service listens on.** Nothing but
   `inventory`'s `app.listen(4300)` says what is at `localhost:4300`: no compose
   file, no `PORT` in an env file. The fallback places the request there
   (`base-url-value`, a `base-url-from-files` row), on both halves; `market`
   serving `GET /api/listings` itself does not decide it.
3. **The setting's name, on both halves.** `LEDGER_URL` has no value anywhere.
   The server half was joined to `ledger`, the one service the name names; the
   browser half, which the name never decided, to `market`'s own
   `GET /api/entries`. Both now join `ledger` (`base-url-from-name`). Where the
   two halves still differ, the browser half follows the server half's join
   (`via: same-call`), save a join the configuration wrote for the browser.
4. **A deployment's public host alone.** `REVIEWS_API_URL`'s only value is
   `https://reviews.example.com/reviews-api` in `wrangler.toml`. The GraphQL
   operation is asked of the endpoints at `/reviews-api` under the rule a
   value for this machine has: exactly one endpoint there, declaring
   `Query.reviews` (`graphql-path`, heuristic), on both halves.

| Request (`app/lib/catalog.ts`) | Rooted at | Joins, both halves |
|---|---|---|
| `GET ${APP_URL}/api/listings` | `PUBLIC_APP_URL`, fallback `http://localhost:4300` | inventory `GET /api/listings` |
| `GET ${LEDGER_URL}/api/entries` | `LEDGER_URL`, by its name | ledger `GET /api/entries` |
| `request(REVIEWS_API_URL, LatestReviews)` | `REVIEWS_API_URL`, `wrangler.toml` | reviews `POST /reviews-api`, `Query.reviews` |
