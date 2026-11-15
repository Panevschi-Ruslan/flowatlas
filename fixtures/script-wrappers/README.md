# script-wrappers fixture

A plain page whose scripts keep their functions inside wrappers run at once
and hand them to the page by name, with jQuery and superagent the globals its
script tags load and ky a global its linter's configuration declares; and a
server that answers them. What P311 reads:

1. **A wrapper's members.** `web/js/store.js` is `(function () { ... })()`
   keeping `var api = { items: function () {...} }`, a constructor `Cart`
   with `Cart.prototype.add = function` and `Object.assign(Cart.prototype, {
   get total() {...}, set coupon(code) {...} })`, and handing `window.api =
   api` and `window.Cart = Cart` to the page. Each is a function of its own:
   `api.items`, `Cart.add`, `Cart.total`, `Cart.coupon=`.
2. **What the page is handed, and what a wrapper returns.** `start()` in
   `web/js/page.js` calls `api.items()` and `window.reviews.list(1)` with
   nothing declaring either, makes `new Cart('guest')` and calls
   `cart.add(...)`, reads `cart.total` and writes `cart.coupon`: each joined,
   the getter and setter where the property is read and written. `stock.js`
   is `var stock = (function () { function load() {...} return { load: load
   }; })()`, and `stock.load()` joins `load`.
3. **jQuery inside a plugin's wrapper.** `web/js/reviews.js` is `!function ($)
   { ... }(jQuery)` calling `$.getJSON(...)`: `$` is what the wrapper is run
   with, the jQuery the page's script tag loads.
4. **superagent.** `web/js/orders.js` calls `superagent.post(...).set(...)
   .send({ cart })`: a `POST` whose body is what `.send` is handed.
5. **ky declared by the linter's configuration.** No script tag loads ky;
   `web/.eslintrc.json` declares it among its `globals`, which counts as a
   `/* global ky */` comment does.

Every request of the page goes to `http://localhost:4710`, where `shop`
listens, and joins its route there.
