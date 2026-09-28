# trpc-join

The other half of `fixtures/trpc-router`: callers of procedures, joined to the
procedures they reach.

A procedure is addressed by its path — `orders.list` — and a client writes the
same path as property accesses on a proxy: `trpc.orders.list.useQuery(input)`.
There is no URL on either side to match, so the join is on the path alone, and
the whole question is which service to look in.

## Three services

- `api` serves a tree (`orders.list`, `orders.create`, `reports.daily`) and has
  a page of its own that asks it for `orders.list`.
- `web` is a front end whose configuration names `api` in `apiTarget`.
- `admin` serves a tree with `orders.archive` in it, and nothing says `web`
  calls it.

## What to watch

Each request is a `ui_api_call` of kind `rpc` carrying the path and what the
call does on the server's side (`query`, `mutation`), and is joined by the
linker with a `hits` edge:

- `api`'s own page reaches `orders.list` in `api` — `via: same-service`. Nothing
  configures it and nothing needs to.
- `web`'s `orders.list` query, `orders.create` mutation and `reports.daily`
  options factory reach `api` — `via: api-target`. The last is the newer binding,
  where the proxy is what a hook hands back.
- `web`'s `orders.list` *mutation* reaches the procedure too, and a
  `procedure-call-mismatch` row says it was declared a query: the two are sent
  differently and the server refuses it.
- `web`'s `orders.archive` joins nothing. `admin` declares that path, and the join
  does not go there on the strength of the string: a procedure path is short and
  common, and an edge made on a coincidence would be two services that never
  speak. The `procedure-not-found` row names `admin` and says what line of
  configuration would make it a join.
- `web`'s `trpc[section].list` names no procedure, and says so where it is
  written with `procedure-path-dynamic`. The linker counts it and adds nothing.

## What is not compared

What the caller sends is not compared with what the procedure takes. The server
records the input by the name it was written under (`meta.input: "OrderQuery"`)
and not as a shape in the registry, and a real input is nearly always a
validation schema whose type is the library's inference and resolves only where
the library is installed. `flowatlas contracts` lists every procedure boundary as
unchecked with that sentence rather than as agreeing; there are no types in this
fixture's registry at all, which is the same fact seen from the other side.

## The stubs

`@trpc/server`, `@trpc/react-query` and `@trpc/tanstack-react-query` are
hand-written under each service's own `node_modules`, declaring the kind each
thing is and nothing of another kind. The client reading needs no types from
them: a proxy is recognised by the factory that made it, so `web` reads the same
with its type argument as `any`, which is what a clone nobody installed looks
like.
