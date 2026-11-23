# The files flowatlas writes

Everything is written under the configuration's output directory, `.flowatlas`
by default, and nothing is written into a repository it reads. The JSON files a
script or another tool may build on have a published JSON Schema in
[`schema/`](../schema), generated from the schemas the tool itself reads them
with, so a schema cannot drift from the reader. A file's version moves when its
shape does, and the schema's name carries the version.

| File | What it is | Version | Schema |
|---|---|---|---|
| `project-graph.json` | the whole graph: nodes, edges, types, what could not be read | `schemaVersion` | [`project-graph.v8`](../schema/project-graph.v8.schema.json) |
| `services/<name>/graph.json` | one service's own graph, before it was joined | `schemaVersion` | [`repo-graph.v8`](../schema/repo-graph.v8.schema.json) |
| `graph.db` | the same graph as SQLite, which every question reads | `schemaVersion` | — |
| `link-report.json` | what joined and what did not | — | — |
| `diff.json` | what `flowatlas diff` found | `diffFormatVersion` | [`diff.v5`](../schema/diff.v5.schema.json) |
| `diff-comment.json` | the figures of `diff --format comment` | — | — |
| `docs.json` | the doc blocks and mentions `flowatlas docs` read | `docsFormatVersion` | [`docs.v2`](../schema/docs.v2.schema.json) |
| `freshness.json` | each service's checkout and every file a build read, for answers to say when the code moved | `freshnessFormatVersion` | [`freshness.v1`](../schema/freshness.v1.schema.json) |
| `names.json` | the names the search hook can say something about | `namesFormatVersion` | — |
| `questions.jsonl` | what was asked, one line per question, when the [question log](CLI.md#the-question-log) is on; never sent anywhere | — | — |
| `observed.json` | what traffic was seen, from `flowatlas observe` | `observedFormatVersion` | — |
| `cache.json`, `stand-ins.json` | what the next build compares against | — | — |
| `pulled/` | the team's graph, from `flowatlas pull` | the bundle's manifest | — |
| `export/<kind>/` | `flowatlas export` | — | — |

The schemas' `$id` is the file's address in this repository's main branch. A
validator for draft 2020-12 reads them (Ajv's `ajv/dist/2020`, for one).

## What a node, an edge and a row carry

The schema fixes a node's `id`, `type`, `label`, `repo`, `file`, `line` and
`kind`, an edge's ends, `type` and `confidence`, and a row's fields. `meta` is
open: each reader records there what it read, and a new key does not move the
version. The keys a script is most likely to build on - where a request goes,
where a way in is served, how sure a join is - are these.

### Rows

Every row of `unresolved` has a `reason`, a stable kebab-case word, and the
`file` and `line` it is about, and may have a `level` (`action` where absent,
`info`, or `nothing`), a `message`, a `hint`, the `service`, and `sites` where
one informational row stands for several places - its `message` and `symbol`
the first place's, its `meta` only what every place says, each place listed
under `meta.causes` with what it says otherwise in its sample's own `meta`.
A cause keeps three samples; where places past them write, for the keys the
rows write differently, a value none of the samples writes, the cause's
`differing` lists each such value once - how many places write it and the
first of them, with its own `meta` (P344) - so no place's value is said only
by its own unfolded reading, and places writing one value are one item.
What a row is about is decided
from its reason in one place, `packages/core/src/model/row-kind.ts`: a **gap**
(something was not followed, the only kind counted as missed), a **note** (how
a join was made, with nothing missed) or a **finding** (something about the
code itself). The reasons added most recently:

| reason | kind | level | says |
|---|---|---|---|
| `grpc-package-service` | note | `info` | a gRPC server registers a service a package implements whose contract is none the tool knows; health checking and reflection are known and drawn |
| `grpc-method-unimplemented` | finding | `info` | a `.proto` contract declares a method the server registering the service implements no member for |
| `grpc-method-undeclared` | finding | `info` | the server implements a member the service's contract does not declare |
| `grpc-field-undeclared` | finding | `info` | a gRPC handler reads a request field the method's message does not declare under the names its loader hands |
| `navigation-locale-prefixed` | note | `info` | a navigation written without the locale the application puts in front of every address, joined to the page under the locale segment, as a guess |
| `listen-port-unread` | gap | `info` | a server's port comes from defaults a module loads by a path decided at run time, or from a value a write not read sets, so no request to a port on this machine is joined to it by that port |
| `listen-port-guessed` | note | `info` | a server's port is read only as a guess: the value from before a write whose own value is not read (`port = await getPort({ port })`, the port's `rewritten`), or a framework's default kept where an environment file the framework does not load before choosing its port sets it (Gatsby's `.env.development`) (P321) |
| `api-client-global-undeclared` | gap | `action` | a script calls the global a client's browser build leaves (`axios.get(url)`, `ky.post(url)`, `$.ajax(...)`) with no import, no script tag of a page loading the client, no `/* global */` comment and no linter global declaring it, so the call is not read as a request; `meta.client` and `meta.global` name the client and the name (P323); `meta.unfollowedConfigs`, where present, lists what the script's linter configuration names and could not follow, as `file: named (why)` (P341) |
| `route-entries-unread` | gap | `info` | a `<Route>` is written over a list some of whose entries are not read - an item not written as an object, a view or a `map` made otherwise, an entry whose path or screen is not read - so the screens they place are not placed; `meta.unread`, `meta.read` and `meta.why` say how many and why. Also where a list read off a registry instance made where it is read (`makeShelf().routes()`) places nothing, `meta.notes` saying so (P338), and where the registry's receiver may hold more than twelve instances, each past the first twelve counted in `meta.unread` and said in `meta.why` (P344), and where `Object.entries` over a list put together past a list read otherwise (a spread of a value read at run time) leaves the places past it not known (P351) |
| `address-port-without-colon` | finding | `action`, or `info` | a number written straight after a host with no colon, `` `http://localhost${port}` `` handed 4600, read as the code spells it (`localhost4600`): a host of its own, not a port. `action` after `localhost` or an address of numbers, where such a request is joined by no path; `info` after any other name, which may end in digits (P324, P330) |
| `container-image-unread` | note | `info` | a container's image whose Dockerfile is not read - pulled as it is, built by nothing the project holds, from a Dockerfile not found, or named by a chart value nothing settles - where the setting the code reads its port from hangs on it; said once per service and image, and nothing is fetched (P331, P337) |
| `server-start-unread` | note | `info` | a program of the project's own a script, a Makefile recipe or a `package.json` script starts with a port in its environment - a package's `bin`, a path such as `./bin/server` - whose file is not in the repository (a build writes it), so the port the service listens on started that way is not read (P343) |
| `plugin-not-enabled` | note | `info` | the server of a Strapi plugin of the repository that no key of `config/plugins` enables, so Strapi does not load it and its routes are not drawn (P335) |

Some older reasons now say more. `ambiguous-route-target` also names the
services a request's base may be - a condition's branches nobody settles, or a
chain of `||` and `??` over settings, a condition later in a chain choosing
among the later settings, or one setting several services claim - where more
than one serves the request, and the APIs served where an address naming its
API by an id is written; `unknown-base-url-env` names each service claiming a
setting where none of them serves the request.
`base-url-from-files` (a note) says when a request was taken as an API's by
where the API is served. `local-port-shared` is said where a port places more
than one service firmly; where every service heard at the port only guesses at
it - a framework's default, an example file's offer, a merged configuration, a
written fallback - it is said only where several of them serve the request, or,
where none does, where several written fallbacks or several guesses firmer than
a default are left, and a port only defaults place joins nobody.
`api-client-base-unread` is said where client instances made with different
bases are handed to one receiver outside any function, or where a framework
calls the method making the request on an instance no code read hands it; at
a request whose receiver is a prop some element hands through a spread not
read (`meta.spread`: the spread's file and line); at a class of the
repository's own whose base field is given different bases, or one not read,
on its instances outside the class, where its instances cannot be told
apart; and, where they can (P353), at the line making an instance whose own
base is not read, and at a request whose receiver holds an instance of such a
class that could not be followed to where it is made.
`route-registry-unread` is also said for a Strapi plugin a key of
`config/plugins` enables that is installed nowhere in the repository - one
row under the key, naming the dependency not installed it resolves to or is
spelled like, or those it may be - for a dependency not installed that the
repository says is a Strapi plugin by its name or its lockfile entry, at
`package.json`, unless a key turns it off (P345, P351), for a plugin whose
bundled build is read only so far, naming the value the follow stopped at,
and for Gatsby plugins listed by a name installed nowhere (`info`);
`route-mount-unread` for what an extension does to a Strapi plugin's routes
beyond adding a route; `route-handler-unread` for a route whose action or
controller an extension drops (P345, P351). A `channel-dynamic` row
about a job's name read off what a `catch` is handed names in its hint the
package whose error may be the one caught.

`link-report.json` counts the rows of the whole project in `totals` as
`missed`, `sites`, `notes` and `findings`, and a browser's requests that were
not joined in `ui.byReason`, by reason. A call both halves of a full-stack
application read is counted in `httpOut` and in `ui`, once in each.

### Requests

On an `http_out` (a request between services) and a `ui_api_call` (one made
in a browser), beside `url`, `path` and `host`:

| key | holds |
|---|---|
| `baseUrlEnv` | the setting the address is rooted at |
| `baseUrlDefault`, `baseUrlDefaultFrom` | what the code falls back to where that setting is not given, and the module the fallback is written in where it is not the request's |
| `baseUrlAlso` | the settings a chain of `\|\|` or `??` reads after `baseUrlEnv`, in order, or the settings of a condition's other branches |
| `baseUrlEither` | the settings of a condition's branches nobody settles, the first branch's first, `baseUrlEnv` among them: each as much the base as another |
| `baseUrlAlsoTiers` | the settings of `baseUrlAlso` in the tiers they are read in, written only where a tier holds more than one: `A \|\| (isProd ? B : C)` is `[["B", "C"]]` |
| `baseUrlVariables` | on an `http_out`, for each setting of the chain or the branches that a settings factory builds from a variable of the environment, that variable: `{ "legacy.url": "LEGACY_URL" }` |
| `baseUrl`, `baseUrlFrom` | the value the base was taken from and where it was found, written by the linker where a join rests on it; `baseUrlFrom` is `its name` where the setting's name decided |
| `sameCall` | the id of the other half of one call both halves of a full-stack application read, reached from both sides or from neither; the linker joins the two to one target and a reader counts them once |
| `through` | on a `ui_api_call`, the function of the repository the request was read through, its node standing at the caller: a wrapper, or a function a client is handed to |
| `protoFieldNames` | `proto` on a gRPC call whose client loads its contract keeping the contract's field names (`keepCase`) |
| `portWithoutColon` | `{ number, host }` where a number is written straight after the host with no colon (`localhost4600` is `{ "number": "4600", "host": "localhost" }`): the `host` is kept as spelled, and the row `address-port-without-colon` says so |

### Publishes

On a `producer`:

| key | holds |
|---|---|
| `heldIn` | where the receiver may be the static field of either of several classes, each declaring its own: each field (`Queues.mail`) with the channels read out of it, none where its value is not read |
| `messageTypes`, `discriminator` | the types of message its payload fixes and the field they were read from (`type`, else `kind`, `eventType` or `event`); the linker draws an `emits` edge onto each type's node, `channel:<name>#<value>` of kind `message_type` (P358) |
| `messageTypeUnread` | why a payload that has a type had it not read: a union a caller decides, a value worked out at run time; a `message-type-unread` row says so |

### Types of message

On a `consumer` (P358):

| key | holds |
|---|---|
| `selects` | the types its handler chooses on, each `{ type, consumer, via, line, file?, heuristic? }`: `consumer` the consumer drawn for the handler the choice runs, one call deep (its own id where the branch calls nothing of the repository's own), `via` one of `switch`, `if`, `guard`, `map`, `decorator`, `filter` (an rxjs `filter` in front of a subscription, P362), `parameter` (P369: the handler chooses nothing in its body and the declared type of its parameter has a literal discriminator); a choice handing the message to a function of the repository's own that chooses again is followed into it, two functions deep, and a handler choosing nothing whose callers call it under a choice takes that choice, `file` then naming the caller's file (P369); the linker draws a `consumes` edge from each type's node to that consumer. Absent on a consumer that reads no type: it takes every type alike |
| `selectsOthers` | a default branch that hands every other type on the same way |
| `selectionUnread` | why a choice the handler makes on the type was not read; a `message-type-unread` row says so |
| `selectedBy` | on a consumer drawn for a choice: the consumer whose handler made it |
| `subscriptions` | on a screen's consumer of a stream that subscribes to what the stream's frames are pushed into rather than holding the stream (P362): each `{ line, column, through }`, the `subscribe` call and the wrapper's member it subscribes to (`BoardStreamService.event$`); its types are read there, in the `filter`s of the `pipe` before it and in its callback. Also on a consumer whose handler is written in place and does more than delegate, drawn at the method or function it is written in (P369): `{ line, column, through }` is where the function itself starts, and it is read there |
| `everyChannelOf` | on a consumer that subscribes to every channel of a bus at once - a call on the bus that names no channel, its answer subscribed (`bus.all().subscribe(...)`) - the bus's description; the linker joins it to every channel a publish through that bus in the same service writes to, `via: every-channel` (P369); the types it selects are drawn only on those channels where a publish sends that type, or a type not read (`heuristic`), never on one whose publishes send no type (P374) |
| `handsOnTo` | on the consumer a stream's frames arrive at, where it only pushes them into a subject: the consumers subscribed to it, which stand for it when whether a type is selected is asked; `subjects` the subjects it pushes into |
| `unreached` | why the consumer never runs, said by the reader that drew it: the wrapper it subscribes through is injected or made by nothing (P362); a choice it makes is no selection |

On a `channel` of kind `message_type`: `channel` (the channel it is a type of), `messageType`, `discriminator`. Type nodes are counted in none of the link report's channel figures; `channels.unselectedTypes` lists those published where consumers choose by type and chosen by none.

### Ways in

On an `entry`:

| key | holds |
|---|---|
| `servedAt` | where a deployment's API is served, a list of `{ host, base, api }`: the host with `*` for a label the platform assigns (`**` for one label or several, where a name that may hold dots is written in: a Terraform workspace's), the segments in front of every route (`'*'` for a stage chosen when the deployment is run), and the API by name. `chosenDefault` is that stage where nothing chooses it, or with `chosenIn` (`the workspace production`) the stage that choice deploys; `chosenHost` is the host where nothing chooses a region, or with `hostChosenBy` (`the workspace`) the custom domain where nothing chooses what names it; `under` is the base path a custom domain maps the API at, which this address does not write |
| `stages` | the stages a Terraform API is deployed to; a stage the workspace names lists each workspace's |
| `implementedBy` | the package whose code answers the way in: a gRPC health or reflection service handed to the server |
| `protoFieldNames` | as on a request, for the service's contract |
| `handlerVia` | how the code behind the way in was found (`function`, `method`, `inline`, `named`, ...). Two say it is not the repository's: `framework`, a route the framework's own code answers (a Strapi core route whose controller writes no action), and `package`, one an installed package declares and answers (a Strapi or Gatsby plugin under `node_modules`), drawn at the file that enables it with `package` and `declaredIn` naming the package and its file |

A type the tool read from a `.proto` contract carries `declaredBy: protobuf`
with `protoMessage` or `protoEnum`, and each field `protoName` where its name
differs from the contract's, `protoPresence` (`implicit`, `explicit`), `oneof`,
and `protoForm: library` where a library decides how the value reaches the
reader.

### Ports

A repository node's `listen`, and a GraphQL endpoint's `graphql.listen`, list
where its server listens: `port`, `file`, `line`, the `setting` that moves it,
`default` for the library's own port, `handed` where the port is handed to the
function that starts the server, and `devServer` for a front end's development
or preview server. `merged` is the call of a merge helper of the repository
the port is read through (`file:line`), which makes a join on it a guess;
`rewritten` is where the value the port is read from is written again by
something not read (`config = await applyPlugins(config)`), the port being
the one from before it, a guess (P321); and `valueFrom` is the environment
file that gives the setting its value - one the code or the framework is read
loading before it listens, firm, or an example of it, read only as a
candidate.

### Edges

An edge's `meta.via` says how a request was joined. On `http_calls`,
`graphqlPath` (the GraphQL endpoint at the path a setting's value names),
`externalValuePath` (the one service serving the path a setting's value names
after a host no service is reached at) and `servedAt` (the one API of the
project served where the address is written, its id not read) are new, each
`heuristic` (a join on a value a deployment gives the function making the
request is `static`, whichever way it was made); on `hits`, `served-at` is the
same guess for a browser's request, and `same-call` marks a browser's half that
follows where the server's half of the same call was joined, as sure as that
join, its `via` in `sameCallVia`. Where the browser's half was joined by an
annotation or `apiTarget`, the server's half follows it instead: its
`http_calls` edge says `sameCall`, with the browser's `via` in `sameCallVia`.
`servedApi` names the API a `served-at` join took. `chosenAmong` lists the
settings a service was chosen among by serving the request, as
`ORDERS_URL (orders)`, and makes the join `heuristic`. `listensAt` says where
the service a request reached by a port listens - on this machine, or on a
container's or a cluster's network - with the setting and the file its value
is from, `(its default)`, `(a file nothing is read loading)` where that file
only offers the value, the merge it is read through, the write not read it is
from before, the call the port is handed at, and the mapping or the cluster's
service it is reached through.

A front end's navigations and route guards are `calls` edges. A navigation's
`meta` gains `alsoNavigates` (the other addresses written to the same page from
the same function), `branch` (a route placed under a condition nothing written
decides), `localePrefix` (the segment a middleware puts in front, `[locale]`),
`handler` (the markup event it is written in, `@click`) and `byUrl` (an
address Angular's router is handed whole, `navigateByUrl`) and `query`
(`guess` where a link of the application's own glues a value no use hands as
text to a segment written out whole, and the navigation is taken as one to
that segment's page with a query); a `branch`, a `localePrefix` or a guessed
`query` makes it `heuristic`. A guard or a resolver the router runs
before a screen has `guard` (its kind), `order`, `factory` where a call of a
factory hands the guard back (`roleGuard('admin')`), and `leaving` for what
runs as the screen is left (`canDeactivate`). A screen placed by a route
written under such a condition carries `routeGuessed`, the addresses it is
placed at through it.

## The graph in other tools

`flowatlas export dot | graphml | cypher | csv` writes the graph in the formats
graph tools read ([CLI](CLI.md#flowatlas-export-backstagestructurizr)). Loading
them:

```sh
dot -Tsvg .flowatlas/export/dot/graph.service.dot > services.svg
cypher-shell -f .flowatlas/export/cypher/graph.node.cypher
neo4j-admin database import full --nodes=.flowatlas/export/csv/nodes.node.csv --relationships=.flowatlas/export/csv/edges.node.csv
```

Every edge carries how sure the graph is of it: `confidence` in GraphML, Cypher
and CSV, and the line style in DOT (dashed for a best guess, dotted for an
annotation, bold where traffic was seen). The Cypher is `MERGE` throughout, so
running it again after a rebuild updates and never duplicates; it removes
nothing, so load it into an empty database for an exact copy.
