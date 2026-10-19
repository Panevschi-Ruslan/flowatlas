# nest-forwarded-verb

A request whose address is completed by its caller keeps the verb and host its
own code states (R161).

`src/items/items.client.ts` holds three leaves: a `fetch` to a whole URL with
`{ method: 'PUT' }`, an `axios.delete` inside a method named `get`, and a `GET`
default followed by a spread of the caller's settings. Two services call them
with literal ids. Each caller is credited with `PUT` or `DELETE` (or the caller's
own `POST`, for the spread) at host `api.example.com`, where the request used to
read as `GET` with a path starting `/https:/`. The settings object is not
recorded as the request's body.

`src/items/stock.client.ts` is handed the verb as well (P91): `fetch(url, {
method })` with `method` a parameter. `Restocker.restock` hands in `'PATCH'`
and is credited with `PATCH /items/:param/stock`; `Restocker.settle` hands in a
choice nothing can read, and its request keeps the verb unread, with an
`api-method-dynamic` row, where it used to read as `GET`.

`StockClient.send` is handed its body too (P128): `fetch(url, { method, body:
JSON.stringify(body) })`. `Restocker.reserve` hands in `{ id, count }`, and its
`POST /items/reservations` carries that literal's type and keys.
