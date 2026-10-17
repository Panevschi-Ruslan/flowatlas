# house-patterns

A bookshop of three services whose wrappers are its own and come from packages
nobody here installed (P121): `catalog` publishes through `ShopBus.emit({ topic,
data })` and calls `stock` through `ApiClient.call('POST', url, body)`, `stock`
handles through `ShopBus.on('book.added', handler)`, and the React `storefront`
requests through `useApi().send({ method, path })`.

`flowatlas-patterns/house.yml` describes the four in four rules, each with its
tests. With it listed (`flowatlas.config.json`) the publish and the handler join
on `channel:book.added`, `catalog`'s request joins `POST /stock/reserve`, and the
storefront's two requests join `catalog`'s routes; every node a rule drew
carries `meta.describedBy`. The publish whose topic is chosen at run time is
read and its channel is `channel-dynamic`.

`variants/no-patterns` reads the same repositories without the file: the same
calls are `call-dynamic-receiver` places (`module-not-installed`), and
`flowatlas patterns suggest` proposes starters for the bus and the client from
them. `variants/ambiguous` adds a second rule for the same publish
(`pattern-ambiguous`, neither read), one whose type no call has
(`pattern-unmatched`) and one that cannot be compiled (`pattern-not-expressible`).
`variants/wrong-expectation.yml` is a rule whose test expects the wrong channel,
for what a failing test prints.
