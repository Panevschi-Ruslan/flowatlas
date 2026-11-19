# express-maker-direct-and-stated

An Express service declared and **not installed**, and a shop calling it. Every
application in `api` is `any` to the checker, so each is recognised from what
the source states (R142). P346 splits those statements in two.

The framework's own maker, imported straight from `express` and called right
there, held by a `const` or a `let` nothing assigns again, *is* the value - a
checker with the types installed would read nothing more. Its routes carry what
a typed reading carries, and so do the joins that land on them. Every other
statement is somebody's account of the value and stays `heuristic`, and so does
every route placed through a mount written on one.

| Route | Confidence | Why |
|---|---|---|
| `GET /health` | typed | `const app = express()` |
| `GET /api/orders`, `POST /api/orders` | typed | `const ordersRouter = Router()`, mounted on `app` |
| `GET /api/catalog/products` | `heuristic` | `catalogRouter` is what a function of the repository returns |
| `GET /api/catalog/reviews` | `heuristic` | `reviewsRouter = Router()` is direct, but it is mounted on `catalogRouter` |
| `GET /api/admin/stats` | `heuristic` | `new AdminRouter()`, a class of the repository extending `Router` |

The shop's five requests join through `apiTarget`: the two to `/api/orders`
are `static`, and the three to the stated routes are `heuristic` - the linker's
join takes the weaker of the caller and the route (`boundedByRoute`).

Fixture `express-not-installed` is the same reading on a service whose every
application is made directly, so none of its routes is `heuristic` any more.
