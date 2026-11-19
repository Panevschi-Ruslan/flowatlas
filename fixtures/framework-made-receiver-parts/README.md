# framework-made-receiver-parts fixture

A React front end whose components are handed their client as a prop, a
plain-script reader handed around inside objects, lists and factories, and a
NestJS jobs service whose pollers the injector makes and whose queues are laid
over instances by functions with untyped parameters. `catalog` listens at 4600
and `stock` at 4700. What P342 reads:

1. **Instances a renderer makes.** `web/src/pages.jsx`: `Feed` takes
   `{ client }`, `Panel` reads `props.client`, and the class component
   `Lister` reads `this.props.client` in `componentDidMount`, which React
   calls on the instance it makes from each element. `CatalogPage` renders
   each with `catalogApi` and `StockPage` with `stockApi`: each element is
   the component's instance and its attributes the props, so `/feed`,
   `/panel` and `/list` are each placed at the page rendering the element,
   under 4600 and 4700.
2. **Instances the injector makes.** `jobs/src/pollers.ts`: `Poller` is
   listed in `PollersModule`'s providers and injected `@Inject('CATALOG_API')`,
   provided with `useValue: catalogApi`; `probe` makes another with
   `stockApi` that nothing registers, so the `/health` its `@Interval` method
   requests is 4600's. `Levels` is injected a `Reader`, which the module
   provides with `useClass: StockReader`, whose constructor hands the
   `STOCK_API` its factory returns on to `super`: `/levels` is 4700's, while
   `catalogHealth`'s own `new Reader(catalogApi)` asks 4600 for `/health`.
3. **An untyped receiver read through parts.** `web/src/health.js`: a
   `Reader`'s `health()` called through a member of an object handed in
   (`options.reader`), what a factory handed in returns (`make()`), an
   element of a list (`readers[0]`, a `for...of`, a `forEach`), a member of
   an object a field holds (`this.deps.client`) and a value a function returns
   kept under a name. Each call is found as a call of `Reader.health`, and
   each request is placed at the function handing the reader, under the base
   of the client it was made with.
4. **An untyped parameter written over.** `jobs/src/senders.ts`: `setup`
   lays `{ queue }` over the `target` it is handed with `Object.assign`, and
   `wire` writes `target.queue`; each is called with an instance (`digest`,
   `alerter`), so `Digest.send` adds to `digests` and `Alerter.alert` to
   `alerts`.
