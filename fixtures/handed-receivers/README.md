# handed-receivers fixture

A plain page whose requests are opened on receivers the compiler knows nothing
of, and a server whose request goes under a public address whose path serves
nothing. Three services answer them. What P301 reads:

1. **A receiver handed in.** `start(request, id)` in `web/js/requests.js`
   opens a request on its parameter and `addNote` hands it a new
   `XMLHttpRequest` and sends it afterwards: the request is read by what the
   caller hands it, and its body (`{ text }`) is what the caller sends.
   `load(xhr, url)` is handed both the receiver and the address, each read at
   its caller. `show(target)` is handed an object with an `open` method of its
   own: no request.
2. **A field the compiler knows nothing of.** `Uploader` declares `request =
   null` and fills it in `begin()`, sending it in `finish(file)`;
   `StatusPoller` is handed its request by the constructor. Both are read by
   what the class gives the field.
3. **A client of the page's own, handed in.** `ProductList` is handed a
   `ShopClient` and calls `this.client.get('/products')`: read as a call of
   that client.
4. **A public address whose path serves nothing, on the server.** `jobs`'s
   `SHOP_URL` is `https://shop.example.test/api`, and nothing is served under
   `/api`. `GET /items` is served by `catalog` alone and is joined there by its
   own path as a guess (`externalValuePath`), as a browser's request under the
   value falls back to its route; `GET /health` is served by `catalog` and
   `orders`, an `ambiguous-route-target` row naming both.
