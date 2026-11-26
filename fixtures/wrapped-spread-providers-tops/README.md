# wrapped-spread-providers-tops fixture

A React front end whose components are wrapped in calls and handed their
client through spreads, clients of its own whose base is written on the
instance, a NestJS service whose readers the injector makes from providers
built by spreads, a call and an alias, and a plain-script page whose top only
makes instances, its globals declared by a linter plugin that builds its
configurations. `catalog` listens at 4600 and `stock` at 4700. What P349 reads:

1. **Components wrapped in calls.** `web/src/pages.jsx`: `Feed`
   (`memo(function ...)`), `Panel` (`React.memo(...)`), `Field`
   (`forwardRef(...)`) and `Both` (`memo(forwardRef(...))`), none exported,
   are each a component; each element hands its props, so `/feed`, `/panel`,
   `/field` and `/both` are placed at `CatalogPage` under 4600 and at
   `StockPage` under 4700.
2. **A prop handed through a spread.** `Tile` takes `{ client }`. `Shell`
   spreads the rest of its props (`{ title, ...rest }`) onto it, so each
   page's `/tile` is its own; `Override` spreads its props and writes
   `client={stockApi}` after, which wins (4700); `Pinned` spreads an object
   written in place (4600). `Orphan` spreads the props of a component nothing
   renders: an `api-client-base-unread` row at `Tile`'s request says so.
3. **A local client's base written outside its class.** `web/src/account.js`:
   `AccountClient` sets `this.base = ''`, and `account.base = ...` after
   `new` gives it `http://localhost:4600/account`; `LevelsClient` is given
   `http://localhost:4700/v2` by `configure(client)`, whose parameter is
   typed as nothing. `Profile`'s `/profile` and `/levels` are
   `/account/profile` on 4600 and `/v2/levels` on 4700.
4. **Providers the injector reads.** `jobs/src/readers.ts`: `Levels`,
   `Mirror` and `Summary` are injected a `Reader` by a token, typed as
   nothing. `LEVELS_READER` is `useValue: new Reader(stockApi)` in a list
   spread in from `shared.ts`, `MIRROR_READER` its `useExisting` alias, and
   `CATALOG_READER` (with `Summary` itself) is in the list `moreProviders()`
   returns. Each `this.reader.read(...)` is a call of `Reader.read`, and each
   request is the injected class's: `/levels` and `/mirror` on 4700,
   `/summary` on 4600.
5. **A script's top that only makes instances.** `pages/js/boot.js` writes
   `new Pulse(...)` and `new Ticker(...)`: the top calls the class's
   constructor (`Pulse.constructor`, which asks for `/pulse`) and the
   constructor function `Ticker` (`/tick`). The page's `ky` and
   `superagent` are declared by `plugin:shop/browser` and `plugin:shop/forms`,
   which the plugin builds with `makeConfigs()` and writes through
   `module.exports.configs.forms`, so no global is said to be undeclared.
