# script-ready-handlers fixture

A plain page whose code waits for the document to load, a CommonJS script a
bundler joins for it, and a server written in CommonJS whose modules export
their functions by name. What P317 reads:

1. **A handler the page runs once it has loaded.** `web/js/page.js` is
   `document.addEventListener('DOMContentLoaded', function () { ... })`: the
   handler is a function of its own, `onDOMContentLoaded`, the `fetch` in it
   is drawn from it, and the `showItem` function and `panel.open` member it
   keeps are functions joined from it, as a wrapper run at once keeps them.
   `web/js/orders.js` is `$(document).ready(...)` and `web/js/reviews.js`
   `jQuery(function ($) { ... })`, both `onready`; `web/js/widgets/stock.js`
   is `window.addEventListener('load', ...)`, `onload`. The `POST` in a click
   handler written inside `onready` is drawn from `onready`.
2. **A client a CommonJS script requires.** `web/js/bundle.js` writes `const
   axios = require('axios')`: the axios it imports.
3. **superagent called as a function, and query data.** `orders.js` calls
   `superagent('GET', ...).query({ page: 1 })`, a `GET` whose query is
   `page`, and `superagent('POST', ...).send({ item: 1 })`. `reviews.js`
   calls `$.get(url, { page: 1 }, callback)`: on a `GET` jQuery's data is the
   query, and the callback is neither query nor body.
4. **Exports naming a function.** `bundle.js` exports `{ listCatalog,
   findItem: findItem }`, and `page.js` calls them through `require('./bundle')`;
   `shop/items.js` exports `{ listItems, findItem: findItem }`, and
   `shop/index.js` calls one destructured and one as a member: each call joins
   the function, in the browser's reading and in the server's.
5. **The linter's override.** `web/.eslintrc.json` declares `ky` only in an
   `overrides` entry for `js/widgets/*.js` less `banner.js`: `stock.js` reads
   ky as the client, `banner.js` reads nothing.

Every request of the page goes to `http://localhost:4720`, where `shop`
listens, and joins its route there.
