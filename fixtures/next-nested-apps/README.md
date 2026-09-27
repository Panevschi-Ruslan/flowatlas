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

So the segments in front of the router root are read — and since R125 they are
read as **the application**, not as the front of the address. An address is an
address within one application, and which application belongs in the identity:

    entry:next-nested-apps@.:http:GET:/api/orders
    entry:next-nested-apps@examples/blog:http:GET:/api/orders
    entry:next-nested-apps@examples/blog:http:GET:/api/posts

Every one of those paths is what the framework serves. The application at the
repository's own root is `.`, and it is named rather than left blank because
where there are two applications the root one is not the default — an unqualified
id is the claim that a service has a single address space. `src` is not part of
the application's name, because the framework itself treats `app/` and `src/app/`
as the same thing.

Until R125 the same uniqueness was bought in the path instead:
`/examples/blog/api/orders`. It cost the one thing every join in this tool is
keyed on. No framework serves that address — the second application serves
`/api/orders`, at an origin of its own — so a caller written against
`/api/orders` could not join to it, and no row said why. Two mechanisms for one
rule, and they disagreed about what an address is; that is what R125 closed, by
sending the file-system routers through the same `applicationsServing` that
decides it for every other adapter (R119).

What it costs, said out loud: two applications serving `/api/orders` is now two
entries of equal specificity, so a request to `/api/orders` from inside either of
them is ambiguous and the linker declines to choose — which is the right answer
from where the linker stands, since nothing in the graph records which
application a *call site* belongs to. It says so in a row of its own,
`ambiguous-route-application`, naming both. That is a worse answer than choosing
the caller's own application and a better one than the address being false.

No caller is written here, so that cost is not asserted by this fixture — it is
one repository and no link report. It is measured on payload, where the change
turned thirty-six browser joins into forty-two of those rows, and thirty-five of
the thirty-six had been answered only by a catch-all in another application.

The root application's handler calls `lib/orders-store.ts`, so the addresses that
did survive are still joined to code, and the second application's handlers call
nothing, which is how a template that is only there to be copied usually reads.
