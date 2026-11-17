# ports-handed-by-callers fixture

A plain page and a server whose requests take their port, their host or
their base from the caller, and two services listening at the ports they
hand: `catalog` at 4600 and `stock` at 4700, both answering `GET /health`.
What P318 reads:

1. **A port every caller hands.** `health(port)` in `web/js/health.js`
   writes `http://localhost:${port}/health`; `catalogHealth` hands 4600 and
   `stockHealth` 4700: one request per caller, at `localhost:4600` and
   `localhost:4700`, each joined to the service listening there. `ping`
   writes the port straight after the host and its callers hand `':4600'`
   and `':4700'`: the same. The server `jobs` writes the first shape and is
   read the same way.
2. **A host a method answers, a port a class keeps.** `Probe.check(port)` in
   `web/js/probe.js` writes `${this.origin()}${port}/health`, the host a
   method always answers; `probeKept` hands `Ports.stock`, a constant the
   class keeps. Each caller's request is at its port; the call made as the
   page loads, at the top of the script, is drawn from the script's top,
   `probe.js:top`, a function of its own (P334), at its port too.
3. **Instances with different bases, the address followed out.**
   `readWith(client, path)` in `web/js/latest.js` is handed an axios
   instance on port 4600 with `/latest` by one caller and one on 4700 with
   `/levels` by another: each request under the base of the instance its
   caller hands. `readHealth(client)` writes `/health` and hands on the
   client it is handed, which `stockHealthCheck` makes: the request at
   `stockHealthCheck`, under its base.
4. **Callers held by a `const`.** In `jobs/src/index.ts` the callers are an
   arrow and a function expression held by a `const`
   (`export const productsV1 = () => readProducts('/v1')`): each request is
   followed out to them, the path or port each hands read there.
   `pingStock` hands `ping` a port a class keeps, `Ports.stock`, written
   straight after the host: the request at `localhost:4700`.
