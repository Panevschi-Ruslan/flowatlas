# script-tops-built-configs fixture

A plain page whose scripts only build at their top, with the clients
declared by a linter plugin's configurations built from other objects and by
a flat configuration's entries named by members. What P341 reads:

1. **A top that only `new`s a constructor or builds an object.**
   `web/js/router.js` writes `new Router({ '/catalog': function () { … } })`
   and nothing else: the handler is kept by nothing as a function of its
   own, so the top of the script is one, `router.js:top`, and `GET /catalog`
   is drawn from it. `web/js/app.js` only assigns `window.app = { forms: [{
   submit: function () { … } }] }`: `POST /orders` (body `item`) is drawn from
   `app.js:top`.
2. **A plugin's configurations built from others.** `web/.eslintrc.json`
   extends `plugin:shop/browser`, `plugin:shop/forms` and
   `plugin:shop/shared`. `eslint-plugin-shop` spreads `shared` from
   `./base`'s `configs` (declaring `axios`), assigns `forms` in with
   `Object.assign(plugin.configs, …)` (declaring `superagent`) and writes
   `plugin.configs.browser = …` after the plugin (declaring `ky`). Each is
   read: `GET /promos` (axios) from `loadPromos`, `ky` and `superagent` in
   the two tops above.
3. **A flat configuration's entries named by members.**
   `web/widgets/eslint.config.js` lists `lint.configs.widgets` of the
   installed `shop-lint`, which declares `unfetch`: `GET /stock` from
   `loadStock`. `lint.configs.node`, which declares `ky`, is named under
   `files: ['admin/**']` alone, so `ky.get` in `web/widgets/deals.js` is an
   `api-client-global-undeclared` row and `GET /deals` is called by
   nothing.
4. **What cannot be followed is said.** The flat configuration also lists
   `extra.configs.browser`, whose module `shop-extra-lint` is not installed,
   and `vendorLint.configs.browser`, a name nothing imports. The row for
   `deals.js` names both in `meta.unfollowedConfigs`, each with why.
