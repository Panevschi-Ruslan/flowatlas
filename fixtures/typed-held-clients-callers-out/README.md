# typed-held-clients-callers-out fixture

A React front end whose requests go through a client held in a field its
type names, and two services listening where those clients point: `catalog`
at 4600 and `stock` at 4700, both answering `GET /health`. What P330 reads:

1. **A field its type names the client.** `Reader` in `shop/src/api.ts`
   keeps its constructor's `AxiosInstance` in a parameter property; the
   repository's own `axios` types are installed, so the field is known by
   its type. `latestProducts` and `stockLevels` each make a `Reader` on an
   instance with its own base: each request at its caller, under the base of
   the instance that caller's `new` hands, before the type alone is taken.
2. **A caller handed the instance it calls the method on.** `check(reader)`
   calls `reader.health()`; `catalogUp` and `stockUp` hand it a `Reader` made
   on each instance. `Board` keeps a `Reader` in a field of its own and calls
   `this.reader.health()` in `show`; `catalogBoard` and `stockBoard` make one
   on each. The `/health` request is followed out of `health`, through the
   caller handed the instance, to each `new` that makes it: one request per
   caller, each joined to the service at its instance's port.
