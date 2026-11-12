# gateway-served-everywhere

A library's APIs deployed four ways, and the plain page that calls them by the
address API Gateway serves each at, `https://<id>.execute-api.<region>.amazonaws.com/<stage>/<path>`,
with an id no file of the project holds (P294):

- `catalog`, a SAM template whose REST API is deployed to the stage its
  `Stage` parameter names (`dev` by default, any `sam deploy` is handed), in
  the region of its `samconfig.toml`;
- `loans`, Terraform: an HTTP API at its `$default` stage, which puts no stage
  in the address, with a provider that names no region;
- `stock`, a CDK app: a REST API deployed to `live`, its stack in `eu-west-1`;
- `reviews`, the Serverless Framework with `stage: prod` written out, which
  `--stage` still overrides;
- `web`, plain HTML and the classic scripts it loads (`browser`).

| Call | Read as |
|---|---|
| ``fetch(`${CATALOG_API}/books`)`` in `js/books.js` | `GET /books` of `catalog`, `heuristic`: the stage `dev` is the one its parameter gives where nothing chooses, with a `base-url-from-files` note |
| `request.open('POST', ...)` then `request.send(JSON.stringify({ stars, comment }))` in `js/rate.js` | `POST /books/{bookId}/ratings` of `catalog`, the same way, with the body it sends |
| `request.send(form)` in `js/borrow.js` | `POST /loans` of `loans`, served at the root of its default stage in any region, with a `FormData` body |
| ``fetch(`${STOCK_API}/copies/${bookId}`)`` in `js/copies.js` | `GET /copies/{bookId}` of `stock`, at the stage `live` its deployment writes |
| ``fetch(`${REVIEWS_API}/reviews`)`` in `js/reviews.js` | `GET /reviews` of `reviews` at the stage `dev`, though the file writes `prod`: any stage the command line names, with the note saying so |
