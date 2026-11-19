# maker-held-by-property-parameter-constructor

Two Express services declared and **not installed**, and a shop calling both.
P346 made a route as sure as a typed one where its application is the
framework's own maker called right there and held by a name nothing else can
change; P350 added a field nothing but its constructor writes and a parameter
default every caller leaves alone. P354 reads the rest of what holds an
application: a property every write of which is known, a parameter every caller
of which is known, and a field the constructor gives its value.

| Route | Confidence | Why |
|---|---|---|
| `GET /api/orders`, `POST /api/orders` | typed | `mountOrders(app)` has one caller, `mountOrders(this.app)`, and `this.app` is a field written only by the constructor, with `express()` |
| `GET /api/catalog/products` | typed | `catalog.router`, a member of an object written in place, written nowhere else |
| `GET /api/status` | typed | `init(app = express())` is reached only through a map of lazy imports, `services[name]()`, whose one call hands it `this.app` |
| `GET /jobs/health` | typed | plain JavaScript: `this.app = express()` in the constructor declares the property, and nothing else writes it |
| `GET /api/plugins/list` | `heuristic` | `plugins.router` is written again from another module |
| `GET /api/reports` | `heuristic` | `mountReports` is handed round a list, so no caller of it can be read; its default places it |

The `api` server's application is a field declared with no value of its own,
`private app: Application;`, given `express()` by the constructor: with nothing
installed it is recognised from that write, and every route placed through a
mount on it is placed where the write says.

The shop's seven requests join through `apiTarget`: the five to typed routes are
`static`, and the two to the heuristic ones are `heuristic`.
