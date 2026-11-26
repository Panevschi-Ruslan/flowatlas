# rest-props-inplace-components-instance-bases fixture

A React front end with a client class of its own whose instances are each
given their own base outside it, components written in place after a
wrapper's options, and a component whose rest of props is handed on; and a
NestJS service whose providers are built by functions reached through an
object. `catalog` listens at 4600 and `stock` at 4700. What P353 reads:

1. **Instances given their own base.** `web/src/account.js`: `ApiClient`
   sets `this.base = ''`; `catalogClient.base = ...` gives one instance
   `http://localhost:4600/v1`, `configure(stockClient)` another
   `http://localhost:4700/v2`, `Object.assign(ordersClient, ...)` a third
   `http://localhost:4600/orders`. Each request is under its instance's base:
   `Profile`'s `/v1/profile` (4600), `/v2/levels` (4700) and
   `/orders/recent` (4600). `loadSummary(client)` is handed one instance by
   each caller, so its `/summary` is `CatalogSummary`'s `/v1/summary` (4600)
   and `StockSummary`'s `/v2/summary` (4700). `loadAny(client)` is handed
   nothing read: its `/any` keeps the path it writes, and an
   `api-client-base-unread` row says which instance it holds is not read.
2. **A rest of props.** `Frame({ client, title, ...rest })` takes `client`
   itself, so the `rest` it spreads onto `Badge` lacks it: `/badge` is only
   `Badge`'s, under what `StockPage` hands it (4700), not under `Frame`'s
   `client` (4600).
3. **A component after a wrapper's options.** `Board` is
   `withOptions({ name }, function Board(...) {...})` and `Chart`
   `withOptions({ name }, memo((props) => ...))`: each is a component whose
   props each element hands, so `/board` and `/chart` are placed at
   `CatalogPage` under 4600 and at `StockPage` under 4700. `Row`'s comparator,
   written after the component in `memo(...)`, is no component.
4. **Providers built through an object.** `jobs/src/readers.ts`:
   `Providers.all()` (a static method), `registry.summary()` (a function an
   object holds) and `registry.mirror()` (an object's method) build the
   module's providers. The Nest reader reads each list, with no
   `module-providers-unread` or `call-through-token` row, and each
   `this.reader.read(...)` is a call of `Reader.read`: `/levels` and
   `/mirror` on 4700, `/summary` on 4600.
