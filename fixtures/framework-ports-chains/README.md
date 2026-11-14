# framework-ports-chains fixture

A full-stack Next `web` whose server code and browser code make requests
P292 left open. Four services answer them. What P296 reads:

1. **A framework's default port.** `web`'s scripts run `next dev` and
   `next start` with no port, so it listens on Next's own 3000, as the
   setting `PORT` falls back to it (`default: true` in `meta.listen`). A
   default is the weakest word for a port: another service the code or the
   files place on 3000 would take it, and two defaults there are no answer.
2. **A long chain of `||`, written in another module.** `APP_URL` in
   `lib/constants.ts` is `withScheme(process.env.PUBLIC_APP_URL) || PREVIEW_URL
   || STAGING_URL || REVIEW_APP_URL || EDGE_URL || 'http://localhost:3000'`,
   read as one step however long it is. Its fallback is at 3000, where `web`
   listens, so `getServerSideProps` in `server/verify.ts` joins `web`'s own
   `POST /api/auth/verify-email`, and the row says the fallback is written in
   `lib/constants.ts` (`baseUrlDefaultFrom`). The constants a platform's host
   with a scheme put in front fills (`PREVIEW_HOST`, `STAGING_HOST`,
   `EDGE_HOST`) are the settings it goes to next (`baseUrlAlso`); one that
   builds a host out of a name (`REVIEW_APP_NAME`) is not an address.
3. **A later setting of a chain.** `STATUS_URL` is `process.env.PUBLIC_STATUS_URL
   || process.env.STATUS_API_URL || 'http://localhost:4400'`. Nobody claims the
   first; `status` claims the second, so the request joins it.
4. **A helper read per branch.** `under(process.env.STATUS_API_URL, true)`
   returns `` `${base}/admin` `` where its second argument is true and the base
   otherwise: the argument settles the branch, so the address is
   `/admin/checks`, on both halves.
5. **A public host with no path, on the server.** `SHOP_HOST` is
   `https://shop.example.test` in `.env.example`. `GET /items` is served by
   `catalog` alone and is joined there as a guess (`externalValuePath`), as the
   browser's half is by its route; `GET /health` is served by `catalog` and
   `orders`, and is a row naming both.
6. **A GraphQL operation through a gateway.** `GATEWAY_URL` is
   `https://gateway.example.test/v1`, a path no endpoint serves. The one
   endpoint of the project declaring `Query.reviews` is `reviews`' `/graphql`,
   joined as a guess (`graphql-path`); two such endpoints would be a row.
7. **A request sent where it is not opened.** `components/Upload.tsx` opens an
   `XMLHttpRequest` in `openUpload` and returns it; the caller sends it. The
   receiver is followed to the caller, so the body `{ name, size }` is read.

| Request | Joins |
|---|---|
| `POST ${APP_URL}/api/auth/verify-email` (`server/verify.ts`) | web `POST /api/auth/verify-email`, by the fallback at web's default port |
| `GET ${STATUS_URL}/checks` (`server/status.ts`) | status `GET /checks`, by the setting it reads second |
| `GET ${ADMIN_STATUS_URL}/checks` (`server/status.ts`) | status `GET /admin/checks` |
| `GET ${SHOP_HOST}/items` (`server/shop.ts`) | catalog `GET /items` |
| `GET ${SHOP_HOST}/health` (`server/shop.ts`) | none: a row naming catalog and orders |
| `request(GATEWAY_URL, LatestReviews)` (`server/shop.ts`) | reviews `POST /graphql`, `Query.reviews` |
| `xhr.open('POST', '/api/uploads')` (`components/Upload.tsx`) | web `POST /api/uploads`, body `{ name, size }` |
