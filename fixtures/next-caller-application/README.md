# next-caller-application

Three applications in one service, a request written inside each of them, and
one written outside all three. The whole fixture is the difference between those
two positions.

`next-nested-apps` says what R125 settled: two applications serving one address
are two entries, and the application belongs in the identity rather than in the
path. What it could not say was where a request *goes*, because no node recorded
which application a call site belongs to. Since R132 a request node carries its
own application, read from the file it is written in, through the same
`applicationsServing` that decides whether an entry's id carries one.

## What each request means

| written in | asks for | reaches |
|---|---|---|
| `shop/app` (`.`) | `/api/orders` | `entry:shop@.:http:GET:/api/orders` |
| `shop/examples/blog` | `/api/orders` | `entry:shop@examples/blog:http:GET:/api/orders` |
| `shop/examples/blog` | `/api/posts` | `entry:shop@examples/blog:http:GET:/api/*` |
| `shop/examples/template` | `/api/orders` | `entry:shop@examples/template:http:GET:/api/*` |
| `admin`, another service | `/api/orders` | nothing — both applications named |

The first two are the point. The same string is written in two applications and
reaches two different entries, and neither answer is a guess: a relative address
asks the origin the page was served from, and that origin is the application the
file belongs to. Nothing about that is a deployment question, which is why the
caller's own application is preferred before specificity rather than as a
tie-break — `/api/posts` is spelled out in the root application and answered by
a catch-all in `examples/blog`, and the caller in `examples/blog` means the
catch-all.

The last row is the one that does not move. `admin` is outside every application
of `shop`, its address is rooted at a settings key, and which of shop's two
`/api/orders` answers it is decided by what is deployed behind that key. Both are
named and neither is chosen, exactly as R119 left it.

## Why `route-wildcard-only` is asked of one application

The template's request lands on its own application's catch-all and says nothing
else, because no route of *that* application spells anything out. Before R132
the question was asked of the whole service, so the routes the other two
applications spell out answered it — and a request that reached the only route
its own program has was reported as one a renamed route is hiding from. That
sentence was 35 of the 36 joins R125 cost on payload.

The row is still written where it is true: `examples/blog` spells `/api/orders`
out and answers `/api/posts` with a catch-all, so the request for `/api/posts`
gets it, naming the application rather than the service. The rule was scoped, not
removed.
