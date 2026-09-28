# react-local-client

One browser, three client classes it wrote itself, and the question R87 asked:
what happens when the thing that makes a request is not a package.

The two clients this reader knew before are both installed — the browser's own
`fetch`, and `axios` — and both are described as fixed rows, because a package
is the same everywhere it appears. A class wrapping `fetch` behind `get` and
`post` is not: it exists in exactly one repository, under a name nobody else
uses, and it is how most front ends are actually written. Before this fixture,
a repository putting every request through such a class produced no request at
all and no row saying why. A wiki app is the measured case: ninety-seven call
sites, two request nodes, and both of those were incidental bare `fetch` calls
somewhere else.

Three classes, because there are three answers and the fixture is here to keep
all three honest.

`src/api/client.ts` is **recognised**. `ApiClient` declares `get` and `post`,
and both of them reach the browser's client through a private `send` two members
away. That chain is the evidence: a class is read as a client when one of its
own verbs can be followed to a transport, and not because of what it is called.
Its requests carry `localClient: "recognised"`.

It also declares a `patch` that returns its argument, and `OrdersPanel` calls it.
That call produces neither a request nor a row, which is the point of recording
the verbs a class proved rather than all seven: a name a class uses for
something else is not a request, and `ApiClient` is still a client.

`src/api/reports.ts` is **unread**. `ReportsClient` has the same two verbs, but
they reach the network through an exported function in another module, and
following a verb out of its class and through the module graph is a different
and much larger question than reading one declaration. So the reading stops —
and it says so, naming the class and the configuration key that would settle it.
That row is the half of R87 that is not optional: a request through a wrapper
nobody described used to be silence, and silence is the defect.

`src/api/billing.ts` is **declared**. `BillingClient` has exactly the shape that
cannot be recognised, and the configuration names it under
`adapters.frontend.localClientClasses`. Nothing is then asked about how its
verbs reach the network, because that is what naming it is for: recognition is
better when it works and worse when it guesses, declaring always works and
nobody writes it, and the two are not exclusive. Its requests carry
`localClient: "declared"`, so a reader of the graph can tell which of the two
happened without going back to the source.

`src/api/transport.ts` keeps the one row that was always right. The address is
its parameter, both classes pass their own parameter on, and no caller here
writes a readable one — so its own request stays where it is written and is
reported as an address built at run time, exactly as a module of plain functions
has always been.

There is no server in this fixture, so the three requests that were read reach
no route and say so. Joining a browser to a route is `react-next`'s business and
is already proved there; what is proved here is that the request exists at all.
