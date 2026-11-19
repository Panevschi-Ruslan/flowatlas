# script-members fixture

A plain page whose requests are written in the methods of objects and in a
constructor's prototype, with axios the global a script tag loads; a server
that answers them; and an Astro site that writes no port. What P310 reads:

1. **An object's methods.** `web/js/api.js` keeps the page's requests in
   `const api = { items() {...}, item: function (id) {...}, reviews: { list:
   (id) => ... } }`. Each is a function of its own, `api.items`, `api.item`,
   `api.reviews.list`, and the request in each is drawn from it. `start()` in
   `web/js/page.js` calls `api.items()` and `api.reviews.list(...)`: `calls`
   edges to both.
2. **A prototype's members.** `web/js/cart.js` writes `Cart.prototype.add =
   function`, `Cart.prototype.addAll` and `Object.assign(Cart.prototype, {
   clear() {...} })`: `Cart.add`, `Cart.addAll` and `Cart.clear`. `start()`
   calls `cart.addAll(items)` and `cart.clear()` on `new Cart('guest')`, and
   `Cart.addAll` calls `this.add(item)`: each joined, `Object.assign`'s
   member by the instance's constructor; the `new` is a call of the
   constructor `Cart` (P349).
3. **A module's default object.** `web/js/account.js` is `export default {
   profile() {...}, save(profile) {...} }`: `default.profile` and
   `default.save`.
4. **axios as a global.** `web/index.html` loads axios from a CDN by a script
   tag, and `api.js` calls `axios.get(...)` with no import and nothing
   installed: read as axios. `account.js` also declares it for its linter
   (`/* global axios */`), which is enough on its own.
5. **Astro's own port.** `site/package.json` starts `astro dev` and `astro
   preview` and nothing writes a port: `meta.listen` holds Astro's 4321 for
   each, `default: true`. Nothing calls it, and as a default it would take a
   request only where the site serves it (P300, P307).

Every request of the page goes to `http://localhost:4700`, where `shop`
listens, and joins its route there.
