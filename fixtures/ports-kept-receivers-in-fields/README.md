# ports-kept-receivers-in-fields fixture

A plain page and a server whose requests take their port from a number a
class or a module keeps, or their base from an instance held in a field or
an object member, and two services listening at those ports: `catalog` at
4600 and `stock` at 4700, both answering `GET /health`. What P324 reads:

1. **A number kept for a port.** `health(port)` in `web/js/kept.js` writes
   `http://localhost:${port}/health`; its callers hand `Ports.stock` (a
   static field holding 4700), `Ports.catalog` (a static getter answering
   4600) and `CATALOG_PORT` (a module constant): one request per caller at
   its port, each joined to the service listening there. `stockLevels`
   writes `Ports.stock` in the port place itself. `latestPage` writes
   `Paging.size`, a number a class keeps, in the path's place: a value of
   the path's (`/latest/:param`), never a port. The server `jobs` writes the
   same shapes and is read the same way.
2. **Instances held in a field or an object member.** `Reader` in
   `web/js/readers.js` keeps the client its constructor is handed in
   `this.api`; `latestProducts` and `stockLevelsRead` each make a `Reader`
   on an axios instance with its own base: each request at its caller,
   under the base of the instance that caller's `new` hands. `readOn(options,
   path)` sends through `options.client`; its callers hand objects holding
   either instance, written out and as a shorthand: the same.
3. **A port with no colon.** `probe(port)` in `web/js/malformed.js` writes
   `http://localhost${port}/health`; `probeCatalog` hands 4600, read as the
   code spells it, `localhost4600`, with an `address-port-without-colon`
   finding: it is no port. `probeStock` hands `':4700'`, the port. The
   server's `probeCatalog` is read the same way.
