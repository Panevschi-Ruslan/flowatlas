# next-nested-apps

One repository, two whole applications, and the same address declared in both.

`app/api/orders/route.ts` is the application at the root of the repository, and
its address is exactly what the framework serves: `/api/orders`. Under
`examples/blog/src/app` there is a second application, complete and separate,
which declares `/api/orders` of its own and an `/api/posts` besides.

This is payload's shape, at the scale a fixture can hold: thirty-nine
applications under `test/`, `templates/` and `examples/`, each with an
`api/[...slug]/route.ts` in it. Reading the router root wherever it occurred and
nothing in front of it made every one of those declarations claim the same
seventeen addresses, and the graph kept whichever was read last — two hundred and
seventy-one declarations gone, with no row anywhere saying so, because as far as
the arithmetic could tell the addresses had all been placed.

So the segments in front of the router root are kept, and the second
application's routes are addressed from where that application is:
`/examples/blog/api/orders` and `/examples/blog/api/posts`. That is not the URL
the second application serves — it serves `/api/orders`, at an origin of its own
— and the alternative is worse in a way that cannot be seen from the output: one
address with two unrelated bodies behind it, and no way to tell which of them
answers. `src` drops out of the prefix because the framework itself treats
`app/` and `src/app/` as the same thing.

The root application's handler calls `lib/orders-store.ts`, so the addresses that
did survive are still joined to code, and the second application's handlers call
nothing, which is how a template that is only there to be copied usually reads.
