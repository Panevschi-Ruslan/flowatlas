# script-tops-plugin-configs fixture

A plain page whose scripts write requests at their very top, with the clients
declared by a linter plugin's configurations. What P334 reads:

1. **The top of a script.** `web/js/top.js` has no wrapper and no handler:
   `ky(SHOP + '/catalog')` and `record('home')` are written at the top of
   the script, so the script's top is a function of its own, `top.js:top`.
   `GET /catalog` is drawn from it, and so is the call to `record`, whose
   `POST /visits` joins through it.
2. **A client's global called directly needs a declaration.** `ky(url)` is
   read as ky because `plugin:shop/browser` declares `ky`; in
   `web/widgets/promos.js`, where nothing the flat configuration reads
   declares it, `ky(SHOP + '/deals')` is an `api-client-global-undeclared`
   row and `GET /deals` is called by nothing.
3. **A plugin's configurations.** `web/.eslintrc.json` extends
   `plugin:shop/browser`: `eslint-plugin-shop`, installed under
   `web/node_modules`, keeps `configs.browser` declaring `ky` and `SHOP`.
   `web/widgets/eslint.config.js` hands the plugin under `plugins` and
   extends `'shop/flat/browser'` by text, which declares `superagent` for
   `widgets/cart.js`; the plugin's `node` configuration, which declares
   `unfetch`, is named by nothing and read for nothing.
4. **A named import reads that export alone.** The flat configuration
   imports `{ browser }` from `./lint/shared.js`, which declares `axios`;
   the module's `legacy` export declares `ky` and is not read.
5. **A wrapper's parameter called as a function.** `web/js/stock.js` is
   `(function (load) { load(SHOP + '/stock'); })(unfetch)` with nothing
   declaring `unfetch`: an `api-client-global-undeclared` row naming
   `unfetch`, and `GET /stock` is called by nothing.

Every upward look for what a configuration names stops at the repository's
root (`web`): nothing above it is read.
