# browser-gateway-address

A booking service deployed with the Serverless Framework (`bookings`), and the
page that books with it (`web`): plain HTML and the scripts it loads, with no
`package.json` and no framework, configured as `browser` (P284). The scripts
are classic scripts sharing one global scope, so the address `config.js`
builds is the one `slots.js` and `book.js` send to. The page writes the API's
address out by hand, `https://<id>.execute-api.<region>.amazonaws.com/<stage>/<path>`,
with an id no file of the project holds.

| Call | Read as |
|---|---|
| `fetch(SLOTS_ENDPOINT)` in `js/slots.js` | `GET /slots` of `bookings`, `heuristic`: the REST API in `eu-west-1`, at the stage `dev` the deployment may be run with (`${opt:stage, 'prod'}`), joined by the path after the stage, with a `base-url-from-files` note |
| `fetch(BOOK_ENDPOINT, { method: 'POST', ... })` in `js/book.js` | `POST /bookings`, the same way, with its body |
| `request.open('DELETE', ...)` in `js/cancel.js` | `DELETE /bookings/{id}` of the HTTP API, served at its default stage, which writes none; the REST API at the same host has no route for it |
| `fetch(FORECAST_ENDPOINT)` in `js/weather.js` | a third party: no API of the project is served in `eu-central-1` |
