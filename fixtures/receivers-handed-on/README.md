# receivers-handed-on fixture

A plain page whose request receivers are handed on through functions in
between and handed instances made with different bases, addresses with a
value written straight after the host, and a server writing the same
addresses. One service answers them. What P312 reads:

1. **A receiver handed on through a function that sends it.** `start(request)`
   in `web/js/notes.js` opens the request, `send(request, text)` hands it to
   `start` and sends it, and `addNote` makes it: the body (`{ text }`) is
   read where `send` sends it, one caller out. `begin` is handed its request
   through `prepare`, which only hands it on; `saveDraft` makes it and sends
   it (`{ draft }`), two callers out.
2. **Instances with different bases handed to one receiver.** `latest(client)`
   in `web/js/latest.js` is handed an axios instance on
   `https://reviews.example.test` by `latestReviews` and one on
   `https://ratings.example.test` by `latestRatings`: one request per caller,
   each under its own base. `Feed` is handed the two at the top of the
   script, where no function can carry each: one request under the path
   alone, and an `api-client-base-unread` row saying why.
3. **A value written straight after the host.** `versioned(version)` in
   `web/js/products.js` writes `https://shop.example.test${version}/products`
   and every caller hands a path: read at each caller, `/v1/products` and
   `/v2/products`, under the host. `local(port)` is handed `:4600`: the
   host's port, kept in the host. `lost(segment)` is handed nothing: the
   host kept and the path unread, with an `api-path-dynamic` row. The server
   `jobs` writes the same two shapes, read the same way: `/v1/products` under
   the host at the caller, and the health check's port kept in the host.
