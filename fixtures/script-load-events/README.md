# script-load-events fixture

A plain page whose scripts run in a wrapper and on the page's other load
events, with its clients declared by shared linter configurations. What P323
reads:

1. **The top of a wrapper run at once.** `web/js/boot.js` is `(function () {
   ... })()`: the wrapper is a function of its own, `wrapper`, and the
   `superagent.get` written at its top, outside any function, is drawn from
   it. The `order` function it keeps is its own, called from a click handler
   written at the wrapper's top, so the call is drawn from the wrapper too.
2. **Other load events.** `web/js/events.js` listens for `pageshow`
   (`onpageshow`), assigns `document.onreadystatechange`
   (`onreadystatechange`) and uses jQuery 1's `$(window).load(fn)`
   (`onload`): each is a handler the page runs once it has loaded.
3. **superagent's sent query.** `boot.js` hands `.send({ page: 1 })` to a
   `GET`: superagent writes it into the query string, so it is the query
   `page`, not a body. The `POST` in `order` keeps `.send` as its body.
4. **Shared linter configurations.** `web/.eslintrc.json` writes nothing but
   `extends`: `./config/eslint-base.json` declares `SHOP`, `superagent` and
   jQuery's environment, and `shop`, the shareable configuration
   `eslint-config-shop` under `web/node_modules`, declares `ky`.
   `web/widgets/eslint.config.js` spreads the flat configuration
   `./lint/shared.js` declares `axios` in, and ignores `vendor/` for every
   object.
5. **A client's global nothing declares.** `web/widgets/vendor/legacy.js` is
   ignored by the flat configuration, so `axios` is declared for nothing
   there: the call is an `api-client-global-undeclared` row, and `GET
   /legacy` is called by nothing.

Every other request of the page goes to `http://localhost:4730`, where `shop`
listens, and joins its route there.
