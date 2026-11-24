# Changelog

All notable changes to the published packages. `@flowatlas/cli` and
`@flowatlas/markers` are versioned separately; an entry names the package when
only one of them moved.

## [Unreleased][unreleased]

### Added

- **Answers never say they are complete when they are not (P381).** `service`
  picks the symbol on `who_calls` and `impact` (a route said aloud is matched
  among that service's routes alone) and cuts no caller of one it holds:
  `who_calls({symbol: "GET /api/items", service: "market-api"})` answered
  "nothing reaches this", complete, where three ways in in other services
  request it, and `impact` on a route with its own service answered no entry,
  complete, where five exist. `callersIn` keeps one service's ways in (also
  `flowatlas impact --callers-in`); a service the symbol lies outside still
  cuts them; whatever a filter leaves out is said in `left` (`filter: 2 ways
  in in other services left out (callersIn: reader-web)`), `complete: false`,
  the call without it in `next`, on `who_consumes` and `who_emits` too. A name
  that means two or three nodes is answered for each under `answers`, the
  liveliest first, with `ambiguous` saying so (both services' `GET
  /orders/:param` in one call, where the candidates took a second); a name
  nothing holds answers the nearest names with `fuzzy: true`, never complete.
  `impact` takes `symbols`, one change (`targets`, every way in once,
  `unresolved` for a name that resolved to none), and sums the ways in by
  kind with the file handling each (`byKind: {screens: {web: [...]}, bots:
  ...}`), the routes the code runs behind apart (`changing`).
  `who_consumes` and `who_emits` take `channels`. Wherever a call passes,
  `ids` is the tool's own list, a list in the single input is the list and one
  string in the list the single input, so `who_calls({ids})`, which answered
  "ask with symbol or symbols", works; an answer of several that answers one
  with an error or candidates is not complete. Facts before verdicts: `dead`
  says `callers: 0` beside the verdict, a class's or file's `waysIn` say
  `callers` always and `uncalled` counts every way in no caller joins that
  nothing outside is said to call, the one a segment off too; code called only
  through ways in judged dead has `reach: "dead"` with `throughDead: true`
  wherever reach is said, and on `dead`'s answer beside its `alive` verdict;
  `list_entries({called: false})` lists the ways in no caller joins, and
  `reach: "dead"`, which listed two of the four uncalled routes and said
  complete, says the two judged a maybe in `left` with that call first in
  `next`. A new fixture, `service-picks-the-symbol`, a lending back end, a
  gateway serving one of its routes under the same path, a reader front end
  and a desk bot, with verbose and compact snapshots, and ten answer-budget
  questions with hand-written answers: `who_calls` with the service 1,718
  characters, the three ways in, complete (375, none, complete); `impact` with
  the route's own service 1,909, five ways in (832, none); `who_calls` on a
  route two services serve 3,208 in one call (333 of candidates, then a call
  each); `who_calls` with `ids` 2,381 (an error); `list_entries` with `called:
  false` the four uncalled routes in 534; with `reach: "dead"` 446, not
  complete (347, complete); `dead` on code behind a dead route says so in
  878; impact by kind 1,389, on two symbols 1,675, with `callersIn` 766, not
  complete. The budget re-records answers grown by `byKind` and `changing`
  (impact 131 to 253 characters each, 1,904 to 2,136 on multi-repo), by
  `throughDead` (18 to 54) and by `callers` (12 to 36), and the listing (core
  5,633 to 5,679, under its 5,700 ceiling with the core descriptions trimmed;
  default 10,321 to 10,412, all 12,904 to 12,995) for the new inputs; the
  tool listing ceilings move to 13,000 read, 37,250 in all and 33,600
  offered. Snapshots of code reached only through routes nothing in the
  fixture calls now say `reach: "dead"` and `throughDead`, of impact answers
  gain `byKind` and `changing`, of `who_calls` on `GET /orders/123` answer both
  routes, and `who_calls` on another service's symbol with `service` says what
  it left out.
- **One call per question: the guidance, inputs taken as agents write them,
  and the fixed overhead (P382).** The server's instructions name the one call
  for each question (`who calls this: who_calls({symbol})`, …, `does each side
  send what the other reads: check_contract({route} or {channel})`) where they
  taught chains beginning with a lookup, say a symbol is an id, a
  `Class.method` or a route said aloud with `service` picking among
  same-named ones, and say "before changing a route, handler, body type or
  message payload: impact first"; the line every answer needs (`reach`,
  `complete`, each tool's plural key) sits in the first 2,048 characters older
  clients kept, and every variant is held under the ceiling (2,368 from a
  configuration, 2,428 on a database alone, where 2,384 and 2,426). The guide
  `flowatlas agents install` writes drops "Narrow, then read" and "Begin with
  start_here" for one call per question, names each tool's key for several
  at once (who_calls and impact `symbols`, dead `ids`, find_symbol and search
  `queries`, get_type `types`) where it named one `ids` who_calls refused,
  points at no full guide, and in a `CLAUDE.md` whose repository's
  `.mcp.json` registers the server, read beside the server's instructions,
  writes the services and the edit habit only (366 characters where 1,054).
  `check_contract` reads `route` or `entry` as `edge` (the server reads the
  names agents reach for as each tool's input, unlisted: `route`/`symbol` for
  `get_flow`, `id` for `get_source`, `route` for `who_calls` and `impact`,
  `symbol` for `dead`'s `id`),
  takes one end alone, answers a type of message given as the channel on the
  channel or channels carrying it, and every input it cannot answer names the
  exact calls to make in `next`. `get_source` and `describe_for_prompt`
  answer compact as plain text, the code or Markdown unescaped with no
  structured content, `verbose: true` the JSON document; a class answers its
  skeleton, bodies folded with line numbers, `whole: true` all of it.
  `get_flow` at detail 2 says each fact once: no edge types the step's
  signature says, no reader meta (`adapter`, `controller`, `rawPath`,
  `source`, `package`, `receiver`, `entityType`), no fails and guards twice.
  The answer budget fails a text that is not
  `JSON.stringify(structuredContent)`, measures the database-alone
  instructions and the short `CLAUDE.md` block, and the tool tests' listing
  ceilings measure what the model reads. A new fixture,
  `one-call-per-question`, with verbose and compact snapshots and five
  budget questions, each one call: the route by `route` 394 characters (an
  error before), a type two channels carry 1,300 (an error, then 1,384 in two
  calls), a type one carries 664, a controller's skeleton 1,322 (1,769
  escaped), a detail-2 flow 5,186 (6,219); `get_flow.route-detail-2` 2,766 to
  2,143 and `get_flow.inline-type` 1,933 to 1,668 for the same reason.

- **Search takes a sentence (P383).** `search` and `find_symbol` answered
  "where is the order cancelled", "what handles payments", "order cancel" and
  `cancelOrder` with an error or an empty match marked `complete: true`, while
  the cancel route and `OrdersClient.cancel` were in the graph: both matched
  the query whole, as a substring. Every name is now split into its words
  once (camel, snake and kebab case, path segments), stored with the graph in
  an SQLite FTS5 table with a stemming tokenizer (`graph.db` layout 3; a
  database written before is indexed in memory on its first search, by the
  same code), and a query's words, stop words and single letters dropped, are
  ranked: only the names holding as many of the words as the best, then by
  how many the name holds, kind (a way in first), `reach` (code that runs
  first) and BM25 with the name weighted five times its service and file.
  `search` answers them as `best` (every kind, methods and functions too)
  when no kind holds the query as a name or the query is a sentence;
  `find_symbol` as its `matches`, ten to a page, when no name holds the query
  as written. Each row says the words it holds (`matched`); such an answer is
  never `complete`, and `left` says `fuzzy: ranked by the words …` with how
  many rows hold as many and how many fewer. A route path under the wrong
  verb is found the same way instead of "nothing matches". A new fixture,
  `search-takes-a-sentence`, with a decoy whose name stems as "cancelled"
  does, verbose and compact snapshots, and five answer-budget questions with
  hand-written answers, each one call: `find_symbol` "order cancel" on
  `multi-repo` 919 characters (no match, complete, before), `search` "where
  is the order cancelled" 896 (an error), "what handles payments" 1,515,
  `cancelOrder` 1,173 and "cancel OR refund" 1,774 (each an error or no
  match). `find_symbol`'s description says words (listing core 5,633 to
  5,637); the output schemas gained `best` and `matched`, so the tool
  listing's whole-size ceilings move to 36,650 and 33,000. A build of 53,700
  nodes spends about half a second on the words; a search reads them in
  under a millisecond on the fixtures and about 0.1 s for a word held by
  thousands of names.
- **Findings say what looks broken between the services first (P384).**
  `findings` opened with what is least likely a defect (unguarded routes,
  one-ended channels) while the graph's best evidence of a bug sat among the
  gaps: on `multi-repo` the gateway's call to `POST /orders/:param/cancel`, a
  route renamed `archive`, and the browser's call to a missing `receipt` route
  were in `start_here` and `cant_follow` only, and on `fields-read-and-sent` the
  one finding was a field optional for the receiver and always sent, while
  `deskId`, read and never sent, was none. Seven kinds now come first, each
  gated on the fact that makes it a defect and carrying `precision` (`high`,
  `medium`, `low`, as CodeQL's `@precision`), `evidence`, the nearest `fix` and
  `seenBy`, the ways in that meet it: `call-to-missing-route` (a
  `target-route-not-found` row, where every route of the target was read: no
  route, mount or prefix of it unread, no catch-all; the nearest route one
  segment off, under another verb or another prefix), `field-never-sent` (P368's
  `missing` on every channel, type by type, and every request's body, where the
  crossing was read whole, with the field it was likely renamed from:
  `likely renamed: deskNumber is sent, deskId is read`), `type-never-published`
  (a consumer choosing a type no publish on its channel sends, where every
  publish says its type: the reverse of `message-type-unselected`, which the
  graph's type nodes alone could not say, since no node is drawn for it),
  `contract-break`, `unguarded-among-guarded` (a route nothing guards while the
  routes beside it in its controller are guarded), `annotation-to-missing-route`
  and `env-not-set` (where the function's deployment was read whole). A
  candidate whose evidence does not hold is counted under `heldBack` with why,
  never listed. An unguarded route is ranked by deviance: guarded siblings, then
  writes (a delete now counts as one), then whether a person sends it (a
  browser's request, a screen's or a bot's code) rather than only another
  service, then reads; `unguarded` alone is `low`. An optionality disagreement
  where the receiver may go without a field the sender always sends breaks
  nothing at run time and is `info` (it was a `warning`, and a finding); the
  sender leaving out what the receiver requires stays a warning. The
  instructions list `findings()` as "what looks broken between the services".
  `flowatlas findings` prints the same ranked list, `--format sarif` writes it
  under `finding/<kind>` rules carrying their precision (`high` an error), and
  `--fail-on high` exits 1 on the defects nearly always right; `flowatlas diff
  --fail-on-broken-call` and the action's `fail-on: broken-call` fail on a call
  between the services the branch breaks (a join lost, or a new request to a
  route nothing serves, as `check` counts them). The overview's checks counted
  unguarded routes and N+1 loops under reasons `findings` never names, so they
  said 0; they count the kinds, and calls to missing routes beside them. A new
  fixture, `findings-between-services`, plants each defect beside a decoy whose
  evidence does not hold (a call to a service whose items controller computes
  its prefix, a type a publish of unread type may send), with verbose and
  compact snapshots and three answer-budget questions with hand-written
  answers: `findings()` on `multi-repo` names both calls to missing routes,
  the cancel one with `POST /orders/:param/archive` as its nearest route, in
  3,172 characters (1,723 before, naming neither), on `fields-read-and-sent`
  `deskId` with its rename in 573 (539, listing only the harmless warning), and
  on the new fixture the six defects with both decoys held back in 5,019. The
  budget re-records the instructions (2,384 to 2,424, the findings line) and the
  listing (default 10,321 to 10,316, all 12,904 to 12,899: the findings
  description says what comes first in fewer words); the tool listing's
  whole-listing ceilings move to 37,100 and 33,450 for the findings output
  schema's new fields. The contracts reports of six fixtures move a receiver's
  optional field from `warning` to `info`; the `findings` snapshots gain
  `precision` and, on `multi-repo`, the calls to missing routes.
- **A request joins the route that actually answers it, in routers that try
  routes in order (P385).** Express, Koa's router, Hono and NestJS on its
  default Express adapter answer with the first route registered that matches,
  so `GET /orders/:id` registered above `GET /orders/latest` takes every
  request for `/orders/latest`; the linker joined such a request to the
  literal route by specificity, and said on the edge that "the framework
  decides by registration order". It now decides by that order where it is
  read: by line within one NestJS controller or one Express, Koa or Hono
  router in one file, and across NestJS controllers by the place each is
  registered at, read from the module tree as the framework scans it (the root
  module's controllers, then each import's, depth first in the order written).
  NestJS on `FastifyAdapter`, or with `routeResolutionStrategy: 'specificity'`
  (NestJS 12), read from the `NestFactory.create` call, ranks by specificity as
  Fastify and the file and front-end routers do. The edge's `note` says how
  its route was chosen and `shadows` names the routes it answers before; a new
  finding, `route-shadowed-by-earlier`, names the route that never runs, the
  one registered before it, both lines and the callers that asked for it, and
  `dead` says the route and its handler are dead. Two routers whose order is
  not read (two files or receivers mounted under one prefix, an application
  whose adapter could not be read) keep the spelled-out route as a
  `heuristic` join with `orderUnread` and an info `route-order-unread` note. A
  route for every verb, under a wildcard, or with a parameter written with a
  pattern is never put first by its order. New fixture `route-order` (a NestJS
  service on Express with a shadowed route in one controller and one in a
  later controller, a NestJS service on Fastify, an Express service with a
  shadowed route and two routers in two files, and an Angular client), with
  verbose and compact snapshots and five answer-budget questions with
  hand-written answers, each one call: `who_calls` on the shadowed handler 567
  characters, its reach `dead` (925, `alive`, the client's request as its
  caller), `who_calls` on the `:id` handler listing the requests for `latest`
  and `export` 1,352 (816, neither), `dead` on the two routes and the handler
  1,148, all `dead` (996, all `alive`), `find_symbol` on the export client
  naming the `:id` route and handler 476 (491, the export route), and
  `findings` listing the three shadowed routes 2,607 (22, none). Three
  snapshots' edge notes move from the old sentence to the new one
  (`angular-interceptor-host`, `framework-routes-in-place-writes`,
  `request-lands-on-route`).
- **Prompt cards: the graph's answer before the first turn (P386).**
  `flowatlas agents install --hook` adds, beside the search hook, a Claude Code
  `UserPromptSubmit` hook. When a prompt names something the graph holds (a
  route said aloud or as a path, whatever its parameters are called;
  `Class.method`; a backticked identifier; a channel; an `UPPER_SNAKE` message
  type; a service beside "dead", "unused" or "nothing calls"), it hands the
  model the compact answer the tool for that thing gives, rendered by the graph
  server's own tools: `who_calls` for a route or a deployed function, `impact`
  for a method handling a route, `find_symbol` (where its requests land) for a
  method sending one to another repository, `impact` for any other method only
  where it reaches another repository, `who_emits` and `who_consumes` for a
  channel or a message type, `dead({service})` for a service. Headed with the
  graph's age and "call a tool only for what this does not say"; at most three
  names and 2,000 characters, an answer too long asked again smaller and at
  worst named by its call; each name once per session; silent unless a name is
  spelled exactly as the graph holds it, a plain word only in backticks; a
  service named in the prompt picks among names several services hold. A
  prompt naming nothing costs one process start and one read of
  `card-names.json`, which `build` now writes beside `names.json`; only a match
  starts the graph server, read-only. The prompt is never written or logged,
  and the cards' calls are kept out of the question log. `--no-prompt-cards`
  leaves the hook out; the benchmark's graph arms get it with
  `run.mjs --prompt-cards`. A new fixture, `prompt-cards`, four repositories
  with a route under a global prefix, two services sharing a handler's name, a
  client, a typed message on a channel and a plain-named channel, holds twelve
  prompts' cards (`scripts/card-snapshots.mjs`, `expected.cards/`), and the
  answer budget gains six questions asked as prompts, each answered with no
  call: who calls a route said with another parameter spelling (1,050
  characters), where a client method's request lands (803), which code handles
  a message type (1,352), what breaks if a handler two services share changes,
  the service named (978), what in a service is unused (640), and a prompt
  naming nothing (no card).

- **who_calls answers stay small and finish, also on several symbols
  (P379).** `depth` is how far the tree of callers is drawn, never a cut:
  every way in past it is listed under `waysIn` whatever it is, one symbol or
  several, so a depth is no longer said in `left`, `truncated` or `frontier`,
  and `next` never names `who_calls` on an asked symbol again. Asked several
  symbols with a depth, each answer was its tree alone, every one
  `complete: false`, with no `waysIn` and `next` asking `who_calls` once per
  symbol; it now draws each tree to the depth and says the ways in once, with
  `reaches`, complete where the walk finished. In a compact answer a step of
  a tree (`get_flow`, `who_calls`) says a long type written inline by its size,
  `{…22 fields}` (an edge's `params` and `returns`, a signature's types, a
  request's `bodyType`, past 48 characters), the `note` saying `verbose: true`
  gives it whole; a screen's `loc`, a line of its routing table, goes beside
  the `by` naming its component, in every compact `impact` and `who_calls`
  answer. `list_entries` with `in` says on each row who calls it (`callers`
  and the first `caller`, as `dead` on a class does) and names the `dead` call
  judging each first in `next`. `callers-walked-to-ways-in` gains a products
  controller of five routes, four requested by two screens' client, one body
  typed inline with 22 fields, with snapshots and four answer-budget
  questions with hand-written answers: `who_calls` on the five routes 2,381
  characters (2,682 before), with `depth: 1` 2,381 and complete (2,834,
  incomplete, no ways in), `get_flow` at detail 2 1,933 (3,808), and
  `list_entries` with `in` naming who calls each 1,152 (835, then `who_calls`
  on the routes: two calls, 3,517). The budget re-records the answers listing
  a screen, 32 to 66 characters smaller each (`impact` 873 to 840 up to 2,387
  to 2,321, `who_calls` 999 to 967 up to 2,926 to 2,862). Ten existing
  `who_calls` snapshots asked with a depth now list the ways in; the two named
  `depth-cut` are `depth-drawn`.
- **No turn spent loading the core tools (P380).** Claude Code defers every
  MCP tool by default, so a graph session's first turn went on a ToolSearch
  call, a turn that re-sends the whole session's context. The graph server now
  lists nine core tools with `_meta: {"anthropic/alwaysLoad": true}`, which
  Claude Code v2.1.285 and later loads upfront: `who_calls`, `list_entries`,
  `who_consumes`, `check_contract`, `find_symbol`, `impact`, `search`,
  `get_flow` and `dead`, chosen from what agents asked (`check_contract` in,
  `who_emits` out of the set the guide used to load). One list, `CORE_TOOLS`
  in `@flowatlas/mcp`, is what the server marks and what the guide names. The
  guide `flowatlas agents install` writes tells no ToolSearch call for them,
  only one call for any other tool a question needs (the skill keeps the
  `select:` line for older Claude Code), and the instructions say the same.
  `"mcp": { "alwaysLoad": false }` in the configuration or `flowatlas mcp
  --no-always-load` marks no tool, and the guide then writes the one
  ToolSearch call that loads them; `agents install` also reads
  `"alwaysLoad": false` or `--no-always-load` from a repository's
  `.mcp.json` entry. Upfront tools are paid on every turn, so the listing is
  leaner: a listed schema leaves out the lower bounds that say nothing
  (`minItems: 1`, `minLength: 1`, `minimum: 0` or `1`, still checked on every
  call), the descriptions of `search`, `list_entries`, `who_consumes`,
  `check_contract` and `dead` are shorter, and the instructions leave out what
  the core tools say themselves. Measured on the main fixture: the upfront
  listing 5,633 characters (about 1,400 tokens; the nine loaded by ToolSearch
  before were 5,870), held under `UPFRONT_LISTING_MAX` (5,700) by the tests
  and the answer budget; the instructions 2,493 to 2,384; the guide block
  1,205 to 1,055; every tool's listing 13,346 to 12,904. What a turn carries
  is 9,340 characters with the core tools in it, where it was 3,966 before
  the ToolSearch turn and 9,836 after it. The answer budget measures
  `listingCore` on the tools the listing marks, fails when they are not
  exactly `CORE_TOOLS` or their listing passes the ceiling, and counts them in
  every turn.

- **What lies past a channel, said once per consumer (P378).**
  `throughChannels`, in `impact` and `who_calls` alike, is one row per
  consumer: `{consumer, channels, consumers?, ways, sample?, walkCut?}`,
  `channels` every channel it takes messages from on the way (a name, or
  `{channel, type}` where it chooses a message type) and `ways` the distinct
  ways in beyond any of them, a route publishing on two counted once. A bot on
  three channels was three rows, each repeating the same ways in and the same
  three samples. `impact` keeps the nearest three as `sample`; `who_calls`,
  asked who calls the code, counts them only, and its `next` names the impact
  call that lists them. `impact`'s `channel` input also takes a row's consumer
  (its id or name), listing the ways in beyond every channel of its row, each
  once, with `acrossConsumer`; `next` offers that call where the first row has
  several channels. `flowatlas impact` prints one line per consumer under
  `Only beyond a channel`, and `--channel` takes a consumer too. `entriesNone`
  and `waysInNone` count the ways in beyond channels once each. The
  `impact-guarded-navigation` fixture's bot now takes messages from three
  channels four routes publish on, with three new answer-budget questions:
  `impact` on the list method 2,387 characters (3,032 before, three rows),
  `who_calls` 1,961 (2,983), and `impact` by the bot's consumer the five ways
  in, 1,440 (it answered none). multi-repo's `who_calls` answers 1,886 where
  it answered 2,004 (no sample) and its `impact` 1,904 from 1,901 (`channels`
  is a list). The budget matches a `throughChannels` row by its `consumer` and
  fails an exact list naming a row twice.
- **"Where does this request land" in one call (P377).** `get_flow` takes any
  symbol the way `who_calls` does (an id, `Class.method`, a short name that is
  the only best match, the candidates when several share it), and with nothing
  near names `find_symbol` (or a route search for a path), never an empty list
  of suggestions; `flowatlas flow` takes the same. An answer about one method
  says where the requests it sends land: `who_calls`' target, each
  `find_symbol` match and `get_source`'s answer carry `requests`, each
  `{route, by}` with `by` the code handling the route, and `requestsUnjoined`,
  a request joined to no route as written (`POST ${apiUrl}/admin/:param/catalog/export`),
  for the requests the method sends itself or through code of its own
  service (a helper, a base class's verb helper, a client wrapper), never a
  class it injects. `search` finds a route by the path a client writes,
  whatever its parameters are called (`:orderId`, `{orderId}`, `${orderId}`)
  and without the prefix the server adds (a global `/api`), a verb in front
  keeping that verb's routes. Wherever a tool takes `service`, the folder of the
  service's repository (as the configuration's `repo` writes it) names the
  service too, and a name that is neither answers the services there are
  (`what_changed` keeps its own answer for a service a diff names). A new
  fixture, `request-lands-on-route`, with verbose and compact snapshots and
  five answer-budget questions with hand-written answers, each now one call:
  `get_flow` on a client method's short name 1,485 characters (three calls and
  1,912 before), `who_calls` 999 (two and 2,314), `find_symbol` 536 (two and
  1,889), the client's path 436, the folder as `service` 411 (three and
  1,922). The budget re-records `find_symbol.several` (965 to 1,380) and
  `find_symbol.unreferenced` (656 to 922), whose client methods now say where
  their requests land, and the listing, 2 characters longer for `get_flow`'s
  `entry`.
- **who_calls reaches the ways in in one call (P376).** Asked without
  `depth`, `who_calls` draws the nearest callers (two hops; on a class or
  several `symbols`, each one's direct callers) and lists every way in the
  walk reaches once, nearest first, under `waysIn`, each with `reach`, `hops`
  and `by`, read by impact's walk: past every way in to the callers beyond it,
  never along a navigation, the ways in only past a channel counted under
  `throughChannels`; a chain an unread call could reach is a `maybe` row, and
  with no way in `waysInNone` says why. On a class each way in says which
  methods it reaches (`reaches`, the methods by name, as `calls` now names
  them on its callers), and asked several symbols the ways in are said once
  for all of them, `reaches` naming the ones each reaches. With `depth` the
  tree alone, as before, and a tree cut by depth names the same call without
  `depth` in `next` (and its `truncated` says so) instead of a deeper depth.
  The answer budget's `who_calls` questions now finish in one call:
  multi-repo's service method 2,004 characters where it took three calls and
  13,531, helpdesk's 1,027 (from 838, its one way in now also in `waysIn`),
  and three new questions on a new fixture, `callers-walked-to-ways-in`: a
  method five calls under its route in 2,828 (three calls and 11,993 at the
  old depth), its class with four methods sharing callers in 2,926 (three
  calls and 20,854), and two of its methods together in 1,554, complete
  (1,758, incomplete). The budget also fails a complete answer whose `next`
  asks the same call further, reads a list said once beside several answers,
  and compares a list a row must say whole.
- **List answers stay lean at any detail, and a class's routes in one small
  call (P375).** A row of a list (`impact`'s entries and maybe rows,
  `list_entries`, `find_symbol`, `search`, `who_consumes`, `who_emits`, a
  `dead` list's candidates) keeps from its `meta` only its plain facts in a
  compact answer, whatever the `detail`: strings, numbers, booleans and lists
  of them. Its structured facts - a route's `fails` and `access`, a method's
  `signature`, a consumer's `selects` - are one node's, and the answer says
  once, in `note`, which went and that `get_flow` or `impact` at detail 2
  gives one node's, `verbose: true` every row's; the target of `impact` keeps
  its own. `dead` on a class lists each way in it declares under `waysIn`,
  each with its verdict and, alive, who calls it first, with `uncalled`
  counting those no code calls; on a file, the ways in written in it or
  handled there. `list_entries` takes `in` (a class, a method or a file: its
  own ways in, each row with `reach`) and `reach` (one verdict). An `impact`
  row that other listed rows reach the target through (a route the screens
  and bots listed request) says `rowsVia`, how many, and impact's description
  says `by` is the code handling a way in, not a way in. The
  `rows-name-handling-code` fixture gains a cancel method refusing four ways
  behind a second guard and a reports controller with four routes the reports
  screen requests two of, with snapshots and four answer-budget questions:
  `impact` at detail 2 answers 1,580 characters where it answered 2,717,
  `list_entries` of the back end's routes at detail 2 2,288 from 4,376,
  `search` 974 from 2,083, and `list_entries({in, reach: "dead"})` exactly
  the two uncalled routes in 475. Every `impact` answer whose route row
  others reach through grows by its `rowsVia` (12 characters on each of five
  budgeted answers); the listing grows 345 characters for the two inputs and
  the descriptions (all tools 13,312, core 5,836).
- **What a pilot after P368-P373 got wrong (P374).** Each row of `impact`
  (and each `throughChannels` sample, now `{id, by?}`) says `by`, the code
  that handles its way in on the chain to the target: a screen's component, a
  route's, a bot command's or a consumer's handler, and for a webhook whose
  handler is written where the route is declared and hands the update to a
  class (a worker's inline handler calling a bot's method), that class's
  method; `flowatlas impact` says it on each row with its file and line. A
  field read through a key the code holds is read where the reading settles
  the key (a `const`, a parameter's default, a member of an object literal
  written as the default behind `??` or `||`), marked `sureness: "default"`,
  and a local assigned the value in one branch of several (`bag = req.body`)
  holds it for every read; every `left` line of `check_contract` names the
  method a use it could not follow is in, never only the guard's class. A
  branch of a dispatch is handled by a call into another class only when it
  hands that call the message itself, so a branch toasting a field is handled
  where it is written, never by the toast; and a consumer whose subscription
  is made by a method of a class nothing builds and nothing outside it calls
  never runs (`dead`, `reach: dead`, its selections `unreached`), whatever
  publishes to its channel. A subscriber to every channel of a bus draws the
  types it selects only on the channels whose publishes send them (or a type
  not read, as a guess), never on one whose publishes send no type. A compact
  answer keeps a row's `field` when it is spelled as the tail of the id of the
  method reading it. A new fixture, `rows-name-handling-code`, with verbose and
  compact snapshots, a CLI tree and four answer-budget questions: `search` for
  the type answers one row where it answered three (631 characters from
  1,126), the guard's field one read in its method, complete (422 from 354,
  unanswered), and `who_consumes` the notice service's own handler, `dead`,
  where it named the toast, alive through every screen calling it.
- **An answer budget in the gate (P373).** `scripts/answer-budget.mjs`, run by
  `pnpm fixtures:check` (and alone as `pnpm answer:budget`), asks 22 agent
  questions of seven fixtures through the graph server as an agent asks them,
  compact: which ways in could break (`impact`, five targets), who calls,
  which handlers take a type of message, a search on a type's name, the three
  questions about fields, `dead` with several ids, `get_flow` at detail 1 and
  2, `find_symbol` with several queries and a paged `list_entries`. Each
  answer's characters (and tokens, estimated as characters / 4), the rows of
  its main lists, whether it says `complete` and the calls it takes when an
  agent follows the page or the deeper walk it names are recorded in
  `scripts/answer-budget.json` beside the right answer, written by hand: the
  ids a list must hold, the ids it must not, a list that must hold exactly
  those, what a row must say (a verdict, a `reach`) and `complete`. The gate
  fails when an answer grows more than 10% (or 300 characters, whichever is
  larger) past its budget, lists an id it must not, misses one it must, says
  `complete: false` where the right answer is complete, or takes more calls
  than recorded; `--update` re-records the sizes, never the expectations, and
  prints before and after. The fixed overhead of every turn is recorded and
  held the same way: the instructions, the guide block and skill description
  `flowatlas agents install` writes, and the listing a model reads for the
  core tools, the tools a project is offered and all of them. A change that
  grows an answer re-records with `--update` and says why in its commit.
- **What P363-P367 left open (P370).** `flowatlas impact` answers as the
  graph server's `impact` does, by the same function (`impactOf`, one walk):
  the tree draws the chain back to each way in that could break, in any
  service, and under it each row with whether it runs and `via`, the maybe
  rows with their gap, the unreached count and what was left; `--format json`
  prints the tool's answer, compact on one line, and whole with `--verbose`;
  `--offset` pages it, and `--depth` bounds the chains drawn. A method or a
  component whose name its repository writes nowhere but at its declaration
  (no call, reference by name or string key, template binding or value handed
  on; comments do not count; in a front end, not a member of a class that
  extends or implements anything, a decorated member, an `ng…` hook, nor
  anything in a repository whose manifest publishes an entry) is marked
  `unreferenced`: `dead` says `likely-dead` with `evidence.unreferenced`, and
  `reach` says `unreached` rather than `maybe` where its file holds no step the
  reading could not follow; `impact` counts such chain ends in `unreached`
  instead of listing them as maybe rows. Compact answers leave out
  `truncated`, `stoppedBy` and `frontier` where `left` says each, say a tree's
  row as its node with `edge` and `children` beside it, and an edge's
  `confidence: "static"` goes, an edge with nothing else said as its type.
  `SCHEMA_VERSION` is 8 for the `task` and `screen` entry kinds
  (`schema/*.v8.schema.json`): a graph of 7 is said to be older and rebuilt
  (a server with `mcp.rebuild: on-change` starts the rebuild), and a graph
  newer than the reader says a newer flowatlas reads it. An Angular
  template's elements are matched against the repository's component and
  directive selectors into `calls` edges (`meta.renders`), as JSX tags are,
  so a child a routed screen renders is reached through it and a component
  nothing reaches is `likely-dead` rather than `unknown`; a click handing a
  loop's element to a method (`(click)="go(entry)"`) is followed into the
  method's parameter, its navigation read over the list as a bound
  `routerLink` is; and an address that is nothing but values read at run time
  is a `dynamic` row naming the code, not a `missing` one naming `:param`.
  New fixture `angular-rendered-reach`.

- **Consumers the reading missed, and types it could not tie to a handler
  (P369).** A handler that chooses no type in its body is read for the types
  it takes: the code calling it under a `case` or an `if` on the message it
  hands it says which (`bot.handleReady(event)` under `case 'ORDER_READY'` in
  the route that relays the channel), and failing that the declared type of
  the parameter it is handed the message in, where its discriminator is a
  literal (`handleReady(event: OrderReady)`, `via: parameter`); where both say
  and differ, the caller's choice is drawn and a `message-type-differs` row
  (info) says so. A choice that hands the message to a function of the
  repository's own that chooses again is followed into it, two functions deep,
  so a constant set gating a callback that hands on to a method's `switch`
  draws each type onto the handler the `switch` runs; a callback that only
  hands the message on chooses what the method it hands it to chooses, read in
  the parameter it is handed in. A subscription to every channel of a
  project's own bus at once - a call on the receiver a broker description
  names that names no channel and whose answer is subscribed
  (`this.bus.all().subscribe(...)`) or that is handed only functions - is a
  consumer (`meta.everyChannelOf`), joined by the linker to every channel a
  publish through that bus in the same service writes to (`via:
  every-channel`), and narrowed by the types its callback and what it hands on
  to choose; one that names a bus nothing in its service publishes through is
  a `subscription-matches-nothing` row. A handler written in place that does
  more than delegate - a subscription's callback, a stream listener in a hook
  or a method - is read for its types where it is written (its position in
  `meta.subscriptions`), no longer as the method or component it is written
  in. On the new fixture `typed-handlers-bus-wide-subscribers`,
  `who_consumes` with a type and `search` on a type name every handler in one
  call where they answered `unsure` with no consumer.

- **Which code reads or sends a field, in one call (P368).** The reading
  writes, on the handler of every HTTP route and of every consumer that
  chooses for itself, and on every guard, interceptor, pipe and middleware a
  route runs first, the fields of the message or the body it reads
  (`meta.fieldsRead`: the field, the function it is read in, the line, and the
  types of message a `switch`, an `if` or an early return on the
  discriminator reads it under), following member reads, destructuring, a
  local that is the value again, the value handed to the repository's own
  functions (bounded), and a body however the code reaches it (`@Body()`,
  `@Body('x')`, `req.body`, `ctx.request.body`, `await c.req.json()`, a
  guard's `getRequest()`); a use it cannot follow (spread, handed to a library,
  indexed by a variable, its keys walked) is `meta.fieldsUnread`, never
  dropped. `who_consumes` and `who_emits` take `field` and keep only the
  handlers that read it (each with `readIn`, the function and line) or the
  publishes that send it, a union narrowed to the type asked; at detail 2
  each row says `reads` or `sends`. `check_contract` takes a route (said aloud
  too) and answers `reads`, every body field the handler, guards, pipes,
  interceptors and middleware read, with `layer`; takes `channel` and `type`
  and answers `missing` (read, not sent) and `unused` (sent, never read) with
  where, a channel of several types compared type by type; and on a request
  edge says the same for its body. `search` finds a field by its name under
  `fields`. The instructions' channel, shape and search lines say `field`
  (2,488 characters), and the guide `flowatlas agents install` writes says a
  field question is one call. On the new fixture, `fields-read-and-sent`,
  each of the three field questions takes one call.


- **Reach that never hides a maybe, and impact that answers "what could
  break" in one call (P367).** `reach` is `alive`, `maybe`, `unreached`,
  `dead` or `outside`, and no longer `unknown`: `maybe` is `dead`'s
  `likely-dead`, or code nothing read reaches whose chain ends where an unread
  call could reach it (code judged `likely-dead`, a component a template may
  render by its tag, or a file with a step the reading could not follow and
  says why), naming it with `gap` (that step's gap id) and `behind` (the code
  the chain stops at), and `from` the nearest way in beyond the unread call
  where its code is known, `behind` otherwise; `unreached` now means no way in
  reaches it and no unread call could; `outside` is a way in something outside
  the project calls (a webhook, a bot update or command, a cron, a screen, a
  public route) or a class from a library, so a webhook way in no longer reads
  as doubtful. `dead({id})` carries `gap` and `behind` too. `impact` walks back
  past every way in to the callers beyond it, with the hops `from` walks (a
  screen showing the component whose method requests the route, a bot command
  whose handler does, a consumer of a channel the chain publishes to), and
  lists every way in that could break, in any service, in `entries`, each on
  the calling side with `via`, the crossing it came through
  (`PATCH /orders/status (shop-api)`, `channel <name>`), and a chain that stops
  at an unread call before any way in as a `maybe` row with its gap, counted
  in `maybe` and said in `left`; a link or a navigation onto a screen is no
  call into it and is not walked back along. Its description says detail 1 is
  enough. A compact answer leaves out any field below the answer's own whose
  value is the answer's target id (a failure's `at` thrown in the method impact
  was asked about) and a `file` an id beside it holds. The server's
  instructions and the guide `flowatlas agents install` writes say the five
  words and to keep `maybe` rows when asked what could break or what calls
  something. Core gains `recordsFollowCause`.
- **Answers that finish in one call (P364).** Each row naming code in
  `who_calls`, `who_consumes`, `who_emits`, `impact`, `search` and
  `find_symbol` says whether it runs, `reach` (`alive`, `unreached`, `dead`,
  `unknown`: the verdict `dead` gives, by the same functions, `unreached` for
  `likely-dead` or for code something calls that no way in reaches), and where
  it is reached from, `from`: the nearest way in (`screen /queue`,
  `GET /orders/:param`, `cron nightly`, `consumer tenant:*:events`, or `none`),
  its own service first, with `ways` counting several - walked back through
  the handler a consumer runs, the component a method or a handler's file
  belongs to and the class an injection builds, through only the types a
  consumer selects, bounded per row and per answer and saying where it was cut.
  So a handler's row says the screen it is shown on, and needs no `dead`,
  `who_calls` or `search` after it; `dead({id})` names its way in too. `dead`
  takes `ids`, `find_symbol` and `search` `queries`, `get_type` `types` and
  `who_calls` `symbols`, beside the single form: several inputs answered in
  one call, each under `answers` with what it `asked`. Every list answer
  (those, `list_entries`, `dead`'s rows, `get_flow`, `get_type`) says
  `complete: true`, or `complete: false` with `left` naming what was cut or
  left unread - a page, a depth or node cut, gaps where a caller may hide, a
  publish whose type was not read, steps not followed. `next` no longer
  suggests `dead` on a row that shows `reach`, nor `who_calls` or `search` on
  one that shows `from`. The linker's `deadJudge` judges many nodes of one
  graph with what every verdict reads of it read once.

- **A screen the router registers is a way in, and a link rendered over a
  constant list reaches every screen the list names (P363).** Each route of a
  front end's configuration that shows a component of the repository - an
  Angular route named, loaded lazily, nested in `children` or in a module a
  `loadChildren` mounts; a React Router table or `<Route>`; a Vue Router route;
  a page a file router places - is an `entry` of the new kind `screen`,
  `entry:<service>:screen:<path>` at the full address it is mounted at, the
  component behind it by a `handles` edge, the guards and resolvers the router
  runs first listed on it. So `who_calls`, `impact` and `describe_for_prompt` on
  a routed component name the address it is shown at, linked or not; `dead`
  answers a component (now judged, as a function is) alive, `routed at
  /star-map`, saying whether a link to it was read; `search` with
  `kinds: ["routes"]` finds a screen by its address and by the component it
  shows. A screen is opened by whoever types its address, so it is triggered
  from outside the graph, as a schedule is, and never listed as a route nobody
  calls; server routes' counts and reports are as they were. In an Angular
  template, `[routerLink]="item.route"`, `routerLink="{{ item.route }}"`,
  `router.navigate([item.route])` and `navigateByUrl(item.route)` inside
  `@for` or `*ngFor` are read over the list the loop walks: a member of the
  component - a field, a getter, a method, a `computed(() => …)` or a
  `signal(…)` - followed to the constant array of objects it is made of,
  through `filter`, `slice`, `sort`, `concat`, a `map` to objects spreading or
  naming the element's members, `flatMap`, `Object.values`, an import and a
  nested loop over an element's member; each entry's address is a `triggers`
  edge to the screen at it (`meta.listed`), an address no route answers is a
  `route-target-unresolved` row naming it, and what of the list is not read is
  a `route-link-dynamic` row saying why. `routerLink="/x/{{ id }}"` now keeps
  the text around the hole.

- **A channel published through a project's own bus reaches the screens a
  per-scope hub feeds, and the screens that subscribe through an rxjs wrapper
  choose its types (P362).** A hub fed by name - the publish helper posts
  `{ channel, message }` to the object's stub, from `getWorkerEnv().X`,
  `env.X`, `(env as …).X`, `this.env.X` or any member the worker's
  configuration binds - relays every channel the helper is handed: the write's
  parameter is followed out to every call that names a channel, and a test of
  the channel on the way (`startsWith`, `===`, a pattern, a constant list and
  `some`, an early return) narrows which; the channel is consumed by each route
  the hub's stream branch answers. A route's handler that is a member of the
  object a factory returns (`sse.boardEvents`, `{ boardEvents, stream:
  boardEvents }`) is the function the member names, for every route reader,
  and a handler registered on several streamed routes is one relay per route.
  On the screen, the function an `EventSource`'s frames arrive at that pushes
  them into a subject (`this._event$.next(data)`) is followed to what exposes
  the subject (a field made of it, a getter, the subject itself) and to every
  `subscribe` on that in the repository, past `pipe` and `asObservable`, in an
  Angular, React or plain-script reader alike: each function a `subscribe` is
  written in is a consumer of the stream (`meta.subscriptions`), and its types
  are read in the `filter`s before it (`via: filter`) and in its callback, now
  also `SET.has(x.type)` and `LIST.includes(x.type)` over a constant or a
  field. A wrapper nothing injects or makes says so (`meta.unreached`), and a
  choice made through it is no selection. Whether a type is selected no longer
  counts a route that relays to screens or a wrapper that hands on to
  subscribers as passing every type on, so `channels.unselectedTypes` and
  `message-type-unselected` are sure where every screen was read. The helper
  may also hand the channel on through a record of handlers looked up by a key
  (`this.transportHandlers[t](channel, message)` over `t` of
  `resolveTransports(channel)`): the routing table the key is drawn from (a
  constant `Map` or object of channel family to a list or set of keys, with
  its `??` default) decides which channels reach the hub's member, `static`
  for a listed family and a guess for the default or a table not read. What
  reaches a subject is followed through other classes too - a field, getter or
  parameterless method made of it, past casts - and a subscription through one
  instance of a generic stream class (`new LiveStream<T>()` held by a feature
  service that hands it its address) is fed by that service's requests alone;
  `event['type']` is read as `event.type`. A hub's own channel carries no type
  nodes where nothing written to it says one. Only the value the hub reads as
  the channel (the `channel` member of what is posted to it) is followed out,
  through the names it is held in; it is read where it is worked out, a
  parameter also written as a message's type is never followed, and an object
  or a name shaped like a type of message is never a channel. A hub that picks
  the streams it writes to by a test (`inScope(sub, channel)`) relays each
  channel to its routes as a guess, saying the test in `meta.filteredBy`. A
  type a consumer selects is drawn on a channel only where the channel's
  publishes carry it, as a guess where one of them has a type not read, and on
  a channel none of whose publishes were read for a type as before. A call to
  a function of the project's own whose channel the walk reads - out from a
  hub write, a publish the broker reader drew whose channel is a parameter, or
  a method marked `@CallsService` that is handed a channel - is itself a
  publish of that channel, drawn as a producer named for the function
  (`channelVia: helper`) with its payload's type read, unless the broker
  reader already drew that call; and the broker reader reads a channel held in
  a `const` (`const channel = \`board:${id}:events\`; publish(channel, …)`) as
  one written in place.
- **A stream answered by a per-scope object relays the channel the object
  subscribes to (P361).** A route that hands its request to a Durable Object's
  stub - `env.ROOMS.get(env.ROOMS.idFromName(…))`, `getByName`, a stub a
  helper of the project's own hands back - is followed to the class the
  namespace is made of, said by its type (`DurableObjectNamespace<Room>`) or by
  the worker's `wrangler.jsonc`/`wrangler.json`/`wrangler.toml`
  (`durable_objects.bindings`, the class the entry exports), into the class's
  `fetch` or the method called on the stub. A `fetch` that tells paths apart
  (`=== '/x'`, `startsWith`, `endsWith`, a `switch`, a pattern tested against
  the path) is read for the branch the request's path takes. The stream and
  the subscriptions are then read there as in the route's own code, with a
  subscription the object opens in its constructor or alarm counted where it
  feeds the streams the object holds; the route records the class in
  `meta.servedBy`. An object that holds the streams open and is written to
  through its stub - a method of it, or a branch of its `fetch` that holds no
  stream - is the hub of a channel of its own, `durable-object:<Class>`: each
  such call is a producer of it and the route a consumer, so the walk runs from
  the call to the screen with no broker between. A plain worker's own `fetch`
  (`export default { fetch }`) whose branch hands a stream to an object is read
  as a `GET` route of the path the branch's test names (`meta.adapter:
  "worker-fetch"`), or a `route-path-dynamic` row where the test names none. A
  class not followed - bound and declared nowhere, declared by another worker,
  bound nowhere - is said in `meta.handedTo` and in the route's
  `stream-relay-unread` row. The worker's configuration is now read by one
  parser shared with the settings reader, which also reads an array written
  over several lines and a dotted key in TOML.

- **A channel relayed onto a stream of server-sent events reaches the screens
  holding it open (P359).** A route whose handler streams server-sent events
  (Nest's `@Sse`, which alone now declares a `GET` route; Hono's `streamSSE`
  and `writeSSE`; a `text/event-stream` answer; frames written as `data: …`)
  is read for the subscriptions in the code behind it, a few calls deep, with
  the broker descriptions consumers are read with; a channel handed to a
  helper of the project's own is read at the call that hands it. Each channel
  makes the route a consumer of it (`meta.relay` on the consumer,
  `meta.stream` and `meta.relays` on the route). A screen's `EventSource` is
  read by the React, Vue, Svelte and plain-script reader as the Angular one
  reads it, and in both the function its frames arrive at - named, called by
  a listener written in place, or handed into a hook by its caller - is a
  `consumer` of kind `sse` the request `triggers`. The linker joins the two:
  the channel `consumes` into each screen's consumer, with the route and the
  request on the edge, so `who_consumes`, `get_flow`, `impact` and `dead` walk
  from publisher to screen. A stream whose relayed channel is not read is a
  `stream-relay-unread` row, a stream with no handler found a
  `stream-handler-unread` row.
- **Types of message on a channel, read at both ends (P358).** One channel
  often carries many kinds of message told apart by a string field, and one
  consumer takes them all and chooses by it. The type a publish writes is
  read - a literal, a typed constant, an enum member, a constant object's
  member, a helper's answer, a member of the union the payload is typed by -
  and so are the choices any consumer's handler makes on it: a `switch`, an
  `if` and its `else if`s, a guard returning early, a record or map of
  handlers looked up by the type, a decorator naming the type on a method a
  registry finds, each with the handler it runs, one call deep. Each type is
  a node of its own, `channel:<name>#<value>` of kind `message_type`, so
  `who_consumes` and `who_emits` take a `type`, `search` finds a type by its
  value under `messages` with its publishes and handlers, and `dead` and
  `impact` answer per type. A type no code that runs selects is answered as
  such, with which consumers choose other types, which pass every type on and
  which were not read, and how sure that is; one published where consumers
  choose by type and chosen by none is the finding `message-type-unselected`.
  A selection in a class nothing builds carries why it never runs. A type not
  read is a `message-type-unread` row, never dropped. No schema change: a type
  is a channel node with a kind. The choice is read in whatever function a
  consumer runs, found by its node or by where it is written, in a server's,
  an Angular and a React reading alike; `dead` now judges a consumer too
  (dead where nothing builds its class, otherwise as what it consumes).

- **A narrower root bounds a reading inside its checkout too, and what a
  tsconfig names above it is said (P357).** A configuration kept beside or
  below its services reads no higher in its checkout than its own directory
  and each service's, each widened to the workspace declaring it; an install
  at the checkout's top still resolves a package, as Node resolves it, and a
  gRPC contract or Prisma schema is searched for from the top everything the
  run reads in the checkout shares. Every
  command loading a configuration (the MCP server, `extract` and the commands
  asking about a repository) bounds its walks so, and a project a library
  opens with none set is bounded at its root. A tsconfig `extends` naming a
  package resolves from an install inside the bound wherever a tsconfig is
  read, and one installed only above is a `tsconfig-extends-installed-above`
  row; a relative `extends` or a `references` above the bound is read and
  said (`tsconfig-read-above-root`, info), an `include` or `files` above it
  is a `tsconfig-not-read-above-root` row. In a linter plugin's `configs`, a
  key written before a spread of another module's object is the one taken
  where that module writes no such key - the module is read to see - and a
  spread that cannot be read is said beside the reading.

- **A port a framework only assumes places only the requests its service
  serves (P300, P307).** Where every server heard at a port of this machine
  is there by its framework's default, a merge, an example environment file
  or a written fallback (`process.env.PORT ?? 3000`), a request is placed at
  the one serving its verb and path, operation or procedure; several serving
  it are a `local-port-shared` row, and a written, published or loaded port
  still wins outright.
- **Ports read through merges, callers, held configuration and loaded
  `.env` files (P305, P315).** A port a repository's own merge helper lays
  over its defaults, a module variable a setter fills before the read, each
  caller's argument to a port parameter, and the `PORT` a loaded `.env`
  sets (Nuxt/Nitro, classic Remix, dotenv, NestJS `ConfigModule`,
  `--env-file`, Bun, Create React App) are read; an example file is only a
  candidate. Defaults loaded from a computed path are a `listen-port-unread`
  row. Astro's `server` written as a function is read per command. A tRPC or
  gRPC link at a port only a default answers is placed where the procedure
  is served.
- **Ports P315 left open: framework commands, loaders' order, example
  fallbacks, held writes and computed paths (P321).** `gatsby develop` and
  `gatsby serve` (`-p`, `PORT=`, else 8000 and 9000 as defaults; a `PORT` in
  the site's `.env.development` is not loaded before the port is chosen, so
  the default stays a guess with an info `listen-port-guessed` row),
  `fastify start` (`-p`, then `FASTIFY_PORT` or `PORT` from its command or
  the `.env` fastify-cli loads, else 3000) and Strapi's `config/server.*`
  (`env.int('PORT', 1337)`, moved by the `.env` or `ENV_PATH` Strapi loads,
  1337 where none is written; read by a new `strapi-server` adapter that
  reads no route yet). Several loaded files are ordered as each loader
  does: a script's or the runtime's files over the code's, the last of
  Node's and Deno's repeated `--env-file`, dotenv's `override`, dotenv-cli's
  `-c` cascade, and Bun's `.env.local` over `.env.<NODE_ENV>` over `.env`;
  dotenv's paths and `ConfigModule`'s `envFilePath` stay first-wins. A code
  fallback is offered the port an example environment file gives its
  setting, as a guess. A setter's write inside a callback, a write through
  `this` or an object's key (a field or key merged by a setter, a
  constructor's write read at each `new`, `{ ...this.values, ...given }`),
  and a variable of a function written again (`config = await
  applyPlugins(config)`) are followed to the write before the read; a write
  whose value is not read (`port = await getPort({ port })`) keeps the value
  from before it as a guess (`rewritten`, a `listen-port-guessed` row).
  Defaults loaded by `require`/`import` of a path built from the file's own
  directory (`path.join(__dirname, 'defaults')`, `path.resolve(__dirname,
  '../config')`, `` `${__dirname}/x` ``) or written relative to it are read.
- **Strapi's routes, Gatsby's functions, ports written in place and per
  instance (P327).** A Strapi application (new type `strapi`, which `init`
  suggests for `@strapi/strapi`) is read for its ways in: each API's
  `createCoreRouter` routes, named by the content type's `schema.json`
  (`only`, `except`, `prefix`), and custom `routes: [{ method, path,
  handler }]`, under `/api` or `config/api`'s `rest.prefix`, each handler
  the controller's action where it is written and Strapi's own core action
  where a core controller writes none; its port reads
  `config/env/production/server.*` over `config/server.*`, another
  environment's port an info `framework-environment-differs` row. A Gatsby
  site (new type `gatsby`) is read by the server reader, each `.js`/`.ts`
  file under `src/api` a function at `/api/<path>`. A held configuration
  changed in place - `Object.assign(config, { port })`,
  `Object.assign(config.server, ...)`, `Object.assign(this, options)`,
  `config.server.port = 4000` - is read where it is changed, the last write
  of the read's own block standing for those before it; a class's field is
  read per instance (each instance's setter calls, its own `new`, each call
  of the method reading it). Repeated `process.loadEnvFile` calls, and
  `loadEnvFile` imported from `node:process`, keep the first file's value, as
  Node sets only what is unset.
- **Strapi plugins, policies and start environments, Gatsby plugin
  functions, `fastify start --config`, writes through getters and per
  instance through parameters (P329).** A Strapi local plugin
  `config/plugins` enables with a `resolve` path is read for its server's
  `routes`, as Strapi mounts them: a list at `/<plugin>` on the admin API,
  routers by name on the API their `type` names (`content-api` under
  `/api`), under their `prefix` or `/<plugin>`, each handler the plugin's
  own controller's action; Strapi's built-in admin routes are not the
  repository's and are not read. A routes file exporting a function, a
  factory's result or a variable is read. A route's `config.policies` are
  drawn as guards and its `config.middlewares` as middleware in front of
  its handler, resolved by uid (`global::`, `api::`, `plugin::`, or a bare
  name in the route's own API or plugin) to the file that runs; a route an
  extension pushes into an installed plugin's router is a
  `route-mount-unread` row. `NODE_ENV` set on the script that runs `strapi
  start` picks the `config/env/<env>` read. A Gatsby local plugin's
  `src/api/<plugin name>` functions are ways in at `/api/<plugin
  name>/...`, the site's own winning at one address, and `gatsby serve
  --prefix-paths` serves every function under the `pathPrefix` too. `fastify
  start --config <file>` gives the port its JSON or `module.exports` file
  writes, after `-p` and `FASTIFY_PORT` and before `PORT`. `Object.assign`
  into a held configuration reached through a getter's return or a
  parameter is followed, and a key the literal does not declare, or declares
  under a type its name resolves to (`const config: Config = {};
  config.port = 4000`), is held. An instance a parameter, a field or a
  parameter property holds is resolved to its own `new`, a method called on
  a parameter read once per caller, so a field is read for that instance.
- **Strapi routes registered in code, installed plugins and extensions;
  Gatsby plugins by path and installed; `fastify start --config` packages
  and ES modules; writes and instances through parameters (P335).** Routes
  code registers on Strapi's server - `strapi.server.routes(...)`,
  `strapi.server.api('<api>').routes(...)` and
  `strapi.server.router.<verb>(path, fn)` - are read as `server.routes`
  mounts them, their handlers by full uid. The plugins an application
  enables are read as `getEnabledPlugins` takes them: a key of
  `config/plugins` (and `config/env/<NODE_ENV>/plugins`) resolving a
  directory enables it only with `enabled: true`, and a dependency whose
  package says `strapi.kind: 'plugin'` is a plugin by its `strapi.name`; an
  installed one is read from its package - the source its `exports` ships
  for `strapi-server`, else the file `require` loads - its routes ways in
  whose code is the package's (`handlerVia: 'package'`), and
  `createContentApiRoutesFactory` and lists spread into a list of routes
  are read. An extension's `plugin.routes['<router>'].routes.push(...)`
  adds the route to that router of a local or installed plugin and its
  `plugin.controllers.<controller>.<action> = fn` answers the action; what it
  does otherwise, or to a plugin not read, is a `route-mount-unread` row, a
  plugin a key enables that is not installed a `route-registry-unread`
  row, and a plugin's server no key enables an info `plugin-not-enabled`
  row. A Gatsby plugin listed by a path (`require.resolve('./x')`,
  `path.resolve(__dirname, 'x')`, `'./x'`) or resolved as a workspace
  package serves its functions as a local one does; one installed under
  `node_modules` serves them as ways in of the package's code, and plugins
  installed nowhere here are one info row. `fastify start --config` naming
  a package reads the file its `exports` or `main` gives, and an ES module
  or TypeScript file's `export const port` (or `export { port }`, or
  CommonJS `exports.port`) is its port; a port only under `export default`
  is a `listen-port-unread` row, as `require` hands it under `default`. A
  key written through a parameter (`apply(config)` writing `target.port`) is
  cut at the call before the read that makes it, through calls each made in
  their function's body, and an instance is told per caller through any
  number of parameter levels, out to eight functions and 256 calls.
- **Jinja, kustomize, sceptre and CDK items (P306).** Namespaces are shared
  back out of macros, set and filter blocks and recursive loops, and
  `loop.changed` compares as Jinja does; kustomize name references for
  storage, priority and ingress classes and persistent volumes; sceptre
  projects anywhere in the repository and through `../` paths; CDK
  `SecretValue.unsafePlainText` is followed to what it wraps, and a role
  imported by ARN carries a row for the policies its account attaches.
- **Settings offered as candidates (P309, P313).** The settings of a
  condition nobody settles (`baseUrlEither`) and of an `A || B` chain are
  each asked in turn: the request joins the service that serves its route,
  as a guess, several serving it an `ambiguous-route-target` row, and a key
  built from a variable is looked up for every one of them.
- **A setting several services claim, and a chain after a condition
  (P319).** A request rooted at a setting two services claim, alone or first
  in a chain, asks each claimant whether it serves the route: the one that
  does is the join, a guess naming each claim in `chosenAmong`; several are
  an `ambiguous-route-target` row; none, and the `unknown-base-url-env` row
  naming them stays. `(isProd ? A : B) || C` reads `C` as a later tier
  after both branches, as a plain chain does. A port the code writes as a
  setting's fallback, `process.env.API_PORT ?? 3000`, where the service's
  own environment file gives the setting (`API_PORT=4000` in
  `.env.development`), is heard at the file's port, firm, and no longer at
  the fallback; an example file's value is offered beside the fallback.
- **A condition later in a chain, and a container's port from its env
  files and its image (P325).** `A || (isProd ? B : C)` reads `B` and `C`
  as one tier after `A`, each claimant asked alike: one serving the request
  is the join, a guess; both serving it is an `ambiguous-route-target` row
  ("a condition nobody settles choosing among the later ones") where `B`'s
  service used to win for being written first. Readers write the grouping
  as `baseUrlAlsoTiers` beside `baseUrlAlso` wherever a tier holds more than
  one setting; branches that each run on to a chain read their later
  settings side by side. A container's environment is its image's
  Dockerfile (`ENV` of the stage built - compose's `build.target`, else the
  last - and the stages it is built from, with `ARG` defaults and
  `build.args` or `--build-arg` put in), under each `env_file:` in order, a
  later file over an earlier, under `environment:`; a `docker run`'s is the
  image a project command builds with `docker build -t`, under each
  `--env-file`, under `-e`. A port a non-secret setting is given in an env
  file the container is started with is read whatever the file is called,
  `.env` included, though nothing else of such a file is. So a code fallback,
  `process.env.PORT ?? 3000`, inside a container is where those files put
  it, firm, `listensAt` naming the file (`inventory/.env (inventory)`); the
  service's own files on the machine stay the machine's. A `${PORT}` a
  compose file writes is filled from the `.env` beside it, as compose does,
  for ports only.
- **Plain scripts (P310, P311).** An object's methods, a prototype's
  members, members inside a wrapper run at once, `window.x`,
  `module.exports` and `exports.m`, and getters and setters are functions of
  their own, their requests drawn and calls joined. A client a page loads by
  a script tag - axios, jQuery (`$.ajax`, `$.get`, `$.getJSON`, `$.post`),
  superagent, ky - is the installed client where a page loads it, a
  `/* global */` comment or an ESLint configuration declares it. Astro's dev
  and preview servers listen on 4321 by default.
- **Plain scripts' handlers, required clients and query data (P317).** A
  handler the page runs once it has loaded - `DOMContentLoaded`, `load`,
  `window.onload`, jQuery's `$(fn)`, `$(document).ready(fn)` and
  `$(window).on('load', fn)` - is a function of its own (`onDOMContentLoaded`,
  `onload`, `onready`) whose requests are drawn from it, and its inner
  functions and members are kept as a wrapper run at once keeps them, `$` in
  `jQuery(function ($) {})` the jQuery the page loads. `const axios =
  require('axios')` (and jQuery, superagent, ky) is that client's import.
  superagent called as a function, `request('POST', url)` or `request(url)`,
  is read, `.query(...)` along its chain is the query, and jQuery's `data`
  on a `GET` or `HEAD` - `$.get(url, data)`, `$.getJSON(url, data)`,
  `$.ajax({ type: 'GET', data })` - is the query rather than the body, a
  callback in its place neither. A module's exports naming a function, `{
  list }` or `{ list: list }`, join `list` in every reading and in the
  server's, wherever the importer is read. ESLint's `root: true` and a flat
  configuration stop the walk up the directories, the first cascading file
  of a directory is its configuration, and an `overrides` entry's or a flat
  configuration object's `globals` count only for the files its `files`
  (less `excludedFiles` or `ignores`) name.
- **Plain scripts' wrappers, load events, superagent's sent query, shared
  linter configurations and undeclared client globals (P323).** A wrapper
  run at once is a function of its own (its own name, the name it is kept
  under, else `wrapper`), so a request or a call written at its top, outside
  any function in it, is drawn from it as from a ready handler. `pageshow`
  and `readystatechange` listened for, `window.onpageshow = fn`,
  `document.onreadystatechange = fn` and jQuery 1's `$(window).load(fn)` and
  `.bind('load', fn)` are handlers the page runs once it has loaded
  (`onpageshow`, `onreadystatechange`, `onload`). What superagent's `.send`
  hands a `GET` or a `HEAD` is its query, beside `.query`'s. ESLint's
  `extends` is followed to the globals it declares - a file by its path, or
  a shareable configuration installed under `node_modules` by its short
  name (`shop` is `eslint-config-shop`) - and so is a module a flat
  configuration takes in by a name it imports or requires (`...shared`,
  `[base, { … }]`, `tseslint.config(base, …)`), each under the `files` it
  is named in; a flat object writing `ignores` alone leaves the files it
  names unlinted, declaring nothing, and one writing `ignores` beside
  `globals` declares them for every file but those. A client's browser
  global called with nothing declaring it (`ky.post(url)`, `axios.get(url)`
  with no import, script tag, `/* global */` comment or linter global) is a new
  `api-client-global-undeclared` row rather than silence.
- **The top of a plain script, linter plugins' configurations and named
  imports, and every client global asking for a declaration (P334).** A
  plain script that writes a call at its very top, outside every function,
  wrapper and handler, is a function of its own named after its file
  (`boot.js:top`), so a request written there is drawn from it and a call
  there joins the function it calls; a handler written there is drawn from
  it as one written at a wrapper's top is. A client's browser global called
  directly (`ky(url)`) needs the import, script tag, `/* global */` comment
  or linter global its member calls (`ky.get(url)`) need, else it is an
  `api-client-global-undeclared` row - as is a wrapper's parameter called as
  a function when what the wrapper is handed is a client global nothing
  declares (`(function (load) { load(url); })(unfetch)`). ESLint's
  `plugin:x/y` in a cascading `extends` reads `configs.y` of the plugin
  installed as `eslint-plugin-x` (`@acme/eslint-plugin` for `@acme`), and a
  flat object's `extends: ['x/y']` reads the configuration of the plugin its
  `plugins` hands under `x`, else of that package; a plugin, a parser or a
  processor merely handed over is no configuration. A name a flat
  configuration imports by name (`import { base } from './shared.js'`, `const
  { base } = require(…)`, `require(…).base`) reads that export alone,
  followed through a re-export and a local name.
- **Plugins' configurations built from others, configurations named by
  members, and script tops that only build (P341).** A plugin's `configs`
  spread from another object (`configs: { ...base.configs, … }`), built by
  `Object.assign` (into `plugin.configs` or from several objects) or
  written after the plugin is (`plugin.configs.browser = { … }`, the last
  write winning) are read with the globals they declare. A flat
  configuration's entry or `extends` naming a configuration by members
  taken off a module (`lib.configs.browser`, `require('x').configs['browser']`,
  `const { configs } = require('x')`, `await import('x')`, a namespace
  import) reads those members alone, wherever the root is imported or
  required. What a linter configuration names and could not follow - not
  installed inside the repository, a name nothing imports, a plugin keeping
  no such configuration, members written in a way not read - is said in the
  `api-client-global-undeclared` row of a script under it
  (`meta.unfollowedConfigs`). The top of a plain script that only `new`s a
  constructor or builds an object holding a handler nothing keeps as a
  function of its own (`new Router({ '/items': function () { … } })`) is a
  function of its own too, and the handler's requests are drawn from it.
- **Receivers handed on, bases per caller and values after a host (P312).**
  A request object handed through functions is followed one call at a time
  to where each sends it; instances with different bases handed to one
  receiver are one request per caller with its own base; and in
  `https://host${x}/rest` the value is a port or a host's rest where it is
  followed to one, otherwise the opening of a path followed to the callers.
- **Ports handed by each caller, bases along an address followed out, and
  callers held by a `const` (P318).** `` fetch(`http://localhost:${port}/x`) ``
  called as `health(3000)` and `health(4000)`, or with `':3000'` straight
  after the host, is one request per caller at `localhost:3000` and
  `localhost:4000`, each joined to the service listening there, in both the
  browser and the server reader; a caller that hands no port it reads leaves
  the request where it is written. A host a method answers and a port a
  class keeps as a constant (`this.origin()`, `Ports.stock`) are read where a
  value after the host is told apart, as the address itself reads them. A
  receiver handed instances with different bases whose address is read at
  a caller takes the base of what that caller hands. On the server a caller
  written as an arrow or a function expression held by a `const`,
  `export const productsV1 = () => readProducts('/v1')`, is a caller a
  request is followed out to.
- **Ports a class keeps as numbers, bases held in fields and objects, and a
  port written with no colon (P324).** A number in a host's port place is
  read where a module or a class keeps it - `const PORT = 4700`,
  `static port = 4700`, a getter or a method answering one, a field the
  constructor writes - handed by a caller or written in place, in both the
  browser and the server reader; a number in the path's place stays a
  value of the path's. Instances with different bases held in a field the
  constructor fills (`this.api = api`) or in a member of an object handed in
  (`readOn({ client: stockApi }, '/levels')`) are read along the calls the
  address came out through, from each `new` and each object to the instance
  it was given, and a request in a method of the receiver's class is
  followed to each caller of the method under the base of the instance it
  calls it on; each request at its caller under its own base, where an
  `api-client-base-unread` row stood before. A number written straight
  after a host with no colon, `` `http://localhost${port}/health` `` handed
  4600, is read as the code spells it, `localhost4600`, with a new finding
  `address-port-without-colon` saying it is no port (info after a name
  that may end in digits).
- **Typed client fields, instances handed further out, and no path join for
  a host with a glued port (P330).** A field or a parameter whose type names
  the client, `constructor(private api: AxiosInstance)`, is read for the
  instances it is handed before its type: one base where they agree, each
  caller under its own where they differ, the type alone (no base) where a
  value is not an instance that is read. A request in a method is placed at
  the callers of that method rather than at whoever makes an instance, and
  a caller that calls it on an instance it was itself handed - a parameter,
  `check(reader: Reader) { return reader.health(); }`, or a field of its own
  `this` - is followed out, a few callers at most, to the `new` that gives
  it, each request there under that instance's base. A browser's request to
  `localhost4600` or an address of numbers with digits glued to it is no
  longer joined by its path alone: the server's reader joins it to nothing,
  and the browser's now counts it under `address-port-without-colon`, the
  reader's finding the one row.
- **Route registries reached across modules and read through views, and
  link props followed through what each use hands (P314).** A store a
  module exports and others add to is found by every reference; a reader
  that filters, sorts or maps the store over the entry's path is read as
  that view, any other view its entries unread; a link prop of another name
  is followed through the values each use hands, and a link rendered over a
  list lands once per entry.
- **Registries kept by a class's field or added to by another module's
  class, views the caller makes, and a row for a route list's entries not
  read (P320).** A class's static field is followed wherever a module names
  it (`Registry.items.push(...)` outside the class, in a function or
  outside any), an instance's off the `const` holding it, and a static
  field read by name is a store as a module's variable is; a registry's
  adding function may be a method of another module's class, called on the
  class or on an instance. A view the caller makes before the route list
  (`listPages().filter(...).map((page) => ({ ...page, path }))`) is read as
  a reader's own view is. A link of the application's own handing its `to`
  or `href` prop after a segment written out whole (`` `/app${to}` ``),
  every use's value unread, is an address under that segment: each use
  says so in a `navigation-unresolved` row with the text in front as its
  `prefix`, and the wrapper draws no navigation of its own. A new info
  `route-entries-unread` row says, at the route, how many entries of the
  list it is written over are not read and why.
- **Views made by flatMap, Array.from or reduce, an instance reached
  however it is handed, and a wrapper's prop of any name (P326).** A view
  of a list's or a registry's entries made with `flatMap` (an object, a list
  of objects, either side of a condition), `Array.from(list, fn)` or a
  `reduce` from an empty list gathering objects (`[...all, { ... }]`,
  `all.concat({ ... })`, `all.push({ ... })`) is read as a `map` to an
  object over each item is, a report flat-mapped to two objects placing two
  routes and an item handed on as it is (`page.hidden ? [] : [page]`) kept
  as it is; one made otherwise is counted in `route-entries-unread` with
  why.
  An instance's registry field is followed through an import, a parameter
  it is handed (`installPanel(panels, panel)`) and a field of another class
  given it when made (`new PanelBook(panels)`, then
  `this.registry.items.push(...)`), each call adding only where what it is
  handed, or the instance it is made on, holds that instance. A link of the
  application's own putting a prop of any name after a segment written out
  whole (`` `/area${path}` ``), directly or through a `const` of its own
  body, every use's value unread, is an address under that segment as a
  `to` or `href` prop is.
- **Steps one over another, objects a reduce gathers, registries handed
  through props and factories, and a query glued to a wrapper's segment
  (P333).** A step over a view mapped already (`list.map(f).flatMap(g)`,
  `map(f).map(g)`) is read step after step, in a caller's view and a
  registry reader's; a `reduce` from an empty object writing objects under
  keys (`{ ...all, [key]: { ... } }`, `all[key] = { ... }`,
  `Object.assign(all, ...)`) and an object written in place are read
  through `Object.values`, and through `Object.entries` where a step takes
  each pair apart (`([, entry]) => ...`); pairs read otherwise are counted
  in `route-entries-unread` with why. A registry's receiver is followed
  through a destructured parameter or a component's props (`function
  Routes({ registry })`, `props.registry`, `<Routes registry={panels} />`,
  `install({ registry: panels }, ...)`) and through a factory function's
  call (`const panels = makeRegistry()`), whether it hands back a `new` or
  an object written in place keeping its store in a field or a variable of
  its own, each instance read on its own. A value a link of the
  application's own glues to a segment it writes out whole, with no `/`
  between (`` `/search${query}` ``), lands on that segment's page firmly
  where a use hands a query or a hash (`?q=shoes`); where no use's value is
  read it lands there as a guess (`query: 'guess'`, heuristic) beside the
  row naming the address under it; after a `/` (`` `/portal/${href}` ``)
  it is the row alone.
- **Methods called on untyped receivers, requests in methods a framework
  calls, fields written from outside the class or through super, and
  resource names from unset context (P336).** In plain JavaScript a method
  called on a receiver the checker types as nothing (`function
  check(reader) { return reader.health(); }`) is now a call of the method
  wherever what the receiver may hold - followed through names, what each
  caller hands a parameter and what a class writes into a field of `this`,
  a bounded walk - is an instance of its class or the object it is written
  in; it runs the method where every value is one, so the address and the
  instance are followed out through it as the TypeScript shape is. A
  request on instances with different bases in a method no code read calls
  but a framework does - a method a package's decorator marks, a lifecycle
  method of a React, Preact, Lit, Angular or NestJS class, a custom
  element's `connectedCallback` - is placed at the instance handed to what
  registers it (`document.body.appendChild(feed)`, `app.register(new
  Poller(api))`, a provider's `useValue`), not at every function that makes
  one; where none is read, each maker keeps it, with an
  `api-client-base-unread` row saying the framework calls the method.
  `mailer.queue = ...` and `Object.assign(mailer, { queue })` on an
  instance outside its class now count as values the field may hold, and a
  constructor's `Object.assign(this, options)` in a class others extend is
  followed down each `super(options)` to what that class's own `new` hands
  it. A `tryGetContext` value no file sets written in a record handed to a
  library construct (`new sqs.Queue(this, 'Q', { queueName: ctx })`) is a
  name chosen when the app is synthesized, unread with the reason
  `context`, rather than a generated name; a stage name and a stack's
  region keep P298's reading.
- **Instances a framework makes, receivers read through parts, and
  untyped parameters written over (P342).** An element written with a
  component as its tag (`<Feed client={api} />`) is that component's
  instance, its attributes the props: a request a function component makes
  through a destructured `client` or `props.client`, or a class component
  through `this.props.client` in `componentDidMount`, is placed at the
  function rendering each element under the base of the client it hands.
  A class a NestJS module lists as a provider (`providers: [Poller]`, `{
  provide: Reader, useClass: StockReader }`) is the instance the injector
  makes, each constructor parameter handed what the module provides for its
  `@Inject(token)` or its type (`useValue`, what `useFactory` returns, a
  class listed or `useClass`), a parameter handed on to `super(...)`
  followed up to the field it fills. An untyped receiver is followed
  through a member of an object (`options.reader.health()`,
  `this.deps.client.get()`), a value a function returns (`make().health()`,
  `const r = readerOf(api); r.health()`) and an element of a list
  (`readers[0]`, `for (const r of readers)`, `readers.forEach((r) => ...)`,
  one `push`ed), as a call of the method and as the instance a request is
  placed at, bounded in parts as in values. `function setup(m) {
  Object.assign(m, { queue }) }` and `m.queue = ...` on a parameter typed as
  nothing count for the field where a caller hands it an instance of the
  class.
- **Wrapped components, props handed through a spread, providers built and
  aliased, bases written outside a client, and what a script's top makes
  (P349).** A component a module keeps unexported under a capitalised name,
  wrapped in calls (`memo(...)`, `React.memo(...)`, `forwardRef(...)`,
  `memo(forwardRef(...))`), is a component, its props what each element
  hands. A prop handed through a spread is followed where what is spread is
  read - a rest of the props (`{ title, ...rest }`), the props whole (an
  attribute written after the spread winning), an object written in place;
  one not read is an `api-client-base-unread` row at the request
  (`meta.spread`). Core's search for a method's calls reads the instance the
  NestJS injector hands a parameter typed as nothing (`useValue: new X()`,
  `useClass`, a class listed, `useExisting` followed, `@Dependencies(...)`
  in plain JavaScript), in provider lists spread in, held by a `const` or
  returned by a function, and the Nest reader draws a call on a
  `useValue: new X()` token to `X` and reads a provider list a function
  answers with. A local client's `this.base` is read with the writes on its
  instances outside the class (`client.base = …`, `Object.assign(client, …)`,
  over a value typed as nothing), a field the class only sets to nothing
  taking theirs; several bases are an `api-client-base-unread` row. A `new`
  in a plain script draws a call to the constructor function or the class's
  constructor (`Pulse.constructor`) it runs. A linter plugin's `configs`
  built by a function it declares, and a configuration written through
  `module.exports.configs.x` or `exports.configs.x`, are read.
- **A local client's base per instance, a rest of props less its siblings,
  components after a wrapper's options, providers built through an object
  (P353).** A client class of the repository's own whose instances are given
  different bases outside it is read per instance, as an installed client's
  are: each request on an instance is under the base the writes made on it
  give it (`client.base = …`, `configure(client)`, `Object.assign(client, …)`),
  a receiver handed several instances is each caller's that hands one, and a
  receiver whose instance is not read, or an instance whose base is not, is
  an `api-client-base-unread` row. A rest of a component's props
  (`({ client, ...rest })`) is the props less the members named beside it,
  so `rest.client`, a `client` taken out of it and what `<Feed {...rest} />`
  hands `client` are nothing. A component written in place after a
  wrapper's options (`withOptions({ name }, (props) => …)`) is a component;
  a function written after it, as `memo`'s comparator, is not. A provider
  list a function reached through an object builds - `Providers.all()`, a
  static method, an object's method or a function it holds - is read by
  core's search for a method's calls and by the Nest reader.
- **A pair's key, an entry handed beside its store, a receiver of several
  instances, and an instance made where it is read (P338).** The key of a
  `[key, entry]` pair is bound to the key its entry is kept under - a
  property's name, a literal, or the expression a computed key or a
  `reduce` writes it under - in a step (`` ([slug, page]) => ({ ...page,
  path: `/pages/${slug}` }) ``) and in a route or a link written straight
  over the pairs (`Object.entries(SCREENS).map(([path, Screen]) => <Route
  path={path} element={<Screen />} />)`), an entry written as a component
  rather than an object read as the screen, `([path, { Screen }])` as a key
  of the entry. An adding function handed its entry in the object it is
  handed the store in (`install({ registry, widget })`) adds that entry. A
  receiver that may hold several instances of one class or one factory's
  object - a prop handed `widgets` at one use and `gadgets` at another - is
  read as each in turn, the entries of each counted. An instance made where
  it is read (`makeShelf().routes()`) holds only what its class or factory
  writes - a field's array written in place, a constructor's writes - and
  where that is nothing the `route-entries-unread` row says so in
  `meta.notes`; a singleton a function makes on first use (`dock ??= new
  DockRegistry()`, a static field written the same way) is the one
  instance every call hands back. A folded row's own `meta` keeps only what
  every row folded into it says: two navigations under different prefixes
  no longer show the first one's prefix for both, each place listed in
  `meta.causes` carrying its own (`samples[i].meta`).
- **A registry's keyed store, entries taken apart by a pattern, a list's
  places, every value a fold drops, and receivers of many instances
  (P344).** An entry an adding function writes straight under a key
  (`this.pages[name] = entry`, `this.panels.set(path, Screen)`, a key the
  function writes itself or a key of the entry) is kept under the key each
  call hands, and a store written as an object in place starts with its
  entries under their keys; read back through `Object.entries`, a `Map`'s
  `entries()`, or `Object.keys` and a `keys()` with the entry looked up by
  its key (`this.tools[name]`), each step's key name spells its path, and a
  reader looking a list up by a parameter (`this.areas[area]`) finds the
  one written under it. A step taking a pair's entry or a list's item apart
  with an object pattern - nested, with defaults - reads each name as the
  entry's own value. `Object.entries` and `Object.keys` over a list written
  in place bind each item's place (`0`, `1`). A folded row lists, per cause,
  each value the places past its three samples write that none of them
  does, with how many write it and the first (`differing`). A receiver that
  may hold more than twelve instances reads the first twelve and counts the
  others in its `route-entries-unread` row.
- **Routes over keys, deeper patterns, places of lists put together,
  objects written per call, webpack-built Strapi plugins (P351).** A route
  or a link written straight over `Object.keys(...)` (`path={path}`,
  `` path={`/tools/${name}`} ``, `element={PAGES[path]}`) is one per key;
  a route-level pattern nested deeper than one key of a pair's entry or a
  list's item (`([slug, { meta: { Screen } }])`) is read, and a template or
  a sum reading a mapped item's key or member is read per entry.
  `Object.entries` over a list a spread, a `concat`, a `map` or a function
  of the repository puts together from lists whose order is known keeps
  each item under its place; past a list read otherwise the places are
  said not known in the `route-entries-unread` row. An object an adding
  function writes into its store from its parameters (`this.pages[name] =
  { Screen }`) is one entry per call, read with that call's arguments under
  the key it hands. An installed Strapi plugin shipped as a webpack bundle
  is read through its table of modules (`__webpack_modules__`, webpack 4's
  bootstrap array, `__webpack_require__.d` and `.n`); a dependency not
  installed that a key of `config/plugins` names otherwise - resolving its
  package, a `file:` directory, a name spelled alike - is one row under the
  key, and a key naming no package says which dependencies not installed it
  may be. An extension writing `plugin.controllers` itself (a fresh object,
  one spreading the plugin's, `Object.assign`) answers with the controllers
  it writes, the plugin's where it keeps them, and a `route-handler-unread`
  row for each route whose controller it drops.
- **Strapi plugins shipped as bundles, plugins a fresh clone has not
  installed, and controllers an extension writes whole (P345).** An
  installed Strapi plugin shipped only as a bundled build is read through
  the bundler's wrappers - rollup's `requireX()` functions and chunk exports,
  esbuild's and rolldown's `__commonJS` factories, `__esm` initializers and
  `__export`, interop helpers and a `default` taken as Strapi takes it - and
  what is still not read is a `route-registry-unread` row naming where the
  follow stopped. A dependency not installed that the repository says is a
  Strapi plugin, by its name (`strapi-plugin-*`, `@strapi/plugin-*`,
  `@<scope>/strapi-plugin-*`) or its lockfile entry, is a
  `route-registry-unread` row at `package.json` unless a key of
  `config/plugins` turns it off. A controller an extension writes whole
  answers the actions its object or factory writes, the plugin's own beside
  them where it spreads them, and each route on an action it drops is a
  `route-handler-unread` row. A write cut at a call several functions out
  binds each function on the way, so an outer parameter its value names is
  that call's argument.
- **Minified bundles, the order modules add in, and adding functions handing
  on their parameters (P355).** A bundler's helpers are told by what their
  bodies do, not their names, so a minified build renaming them is read as
  one that keeps them: a CommonJS wrapper (esbuild's, rolldown's) makes `{
  exports: {} }` and calls the factory it is handed, webpack's loader
  indexes its table of factories by its one parameter - and is the third
  parameter each factory is handed - an export helper defines each key of
  its second argument as a getter on its first, an interop helper speaks of
  `__esModule`; statements a minifier joins by commas are read one by one,
  and a bundle whose helpers are of no shape known stays the
  `route-registry-unread` row it was. A list added to across modules and
  read as `[place, item]` pairs - a registry's (`[...this.items.entries()]`)
  or a module's own list `push`ed onto from other modules
  (`Object.entries(panels)`) - keeps each item under its place: those it is
  written with first, then those added outside any function in the order
  the modules are evaluated from the one entry point reaching them all (each
  module's static imports first, in the order written). Where a module adding
  to it is loaded only by `import()`, the modules are reached from several
  entry points, or an item is added inside a function or by `unshift`, the
  `route-entries-unread` row says so; what other modules push onto a
  module's list is now read at all. An object an adding function writes per
  call is read at the calls of an adding function handing it its own
  parameters (`addHome(Screen) { this.add('home', Screen) }`), through as
  many such functions as are written.
- **Settings chosen by a branch, and read inside a function handed nothing
  (P302).** A condition nobody settles whose branches read different
  settings, `isProd ? process.env.API_URL : process.env.DEV_API_URL`, written
  in place, held in a constant or returned by a helper, is rooted at the
  first branch's setting with the others where it may go instead
  (`baseUrlAlso`), the address a guess; a helper's returns that nothing
  chooses between are read together as the branches of a condition in place
  are, on one setting the path they agree on with the rest a hole. A
  function of the repository called with nothing, `apiBase()` returning
  `process.env.API_URL ?? 'http://localhost:4000'`, is the setting it
  returns, a parameter it is not handed at its default.
- **Registries, link props and Vite ports P296 and P297 left open (P303).**
  A route table read off a registry whose store no class keeps is followed
  as the class one is: a function of the repository, or a method an object
  holds, reading a module's `Map`, array or object, a field of the object
  holding it, or a store handed in, every entry handed to the functions
  beside it that add to that store (a handed store only where both calls
  name it), kept by the key it is filed by or a `filter` / `find` test reads
  (`store.filter((entry) => entry.group === group)`), with the entries
  written into the store itself. A link of the application's own whose
  address prop is named apart from the link's attribute (`NavLink({ to })`
  rendering `` <Link href={`/${locale}${to}`}> ``) is read through to the
  link it renders where the prop starts no segment of its own and its uses
  write addresses. Remix's `remix vite:dev`, React Router's `react-router
  dev` and SvelteKit's `vite dev` listen on Vite's 5173 where neither the
  configuration nor the script writes a port, as a default that places a
  request only where the application serves it.
- **Requests on receivers the compiler knows nothing of, and a public
  address whose path serves nothing (P301).** A request opened on a receiver
  with no type - a parameter, a field declared `null` and filled in later, a
  field the constructor is handed, a parameter property whose type is not
  installed - is read by what the receiver is given: each caller's argument
  (each `new` for a constructor's), a field's initializer and every
  `this.<field> = ...` its class writes, a variable's assignments. Where every
  value known for anything is an `XMLHttpRequest`, one instance of an
  installed client, or one client class of the repository's own, and one is,
  the call is that request; a value known for something else (an object with
  an `open` of its own) makes it none. An `XMLHttpRequest` handed in is sent
  where each caller sends it after handing it, and a field of an object
  written in place where its other methods send it. A server's request under
  a public address whose path no service serves the request under falls back
  to its own path, as a browser's does: the one service serving it joined as
  a guess (`externalValuePath`), several an `ambiguous-route-target` row, as
  are several serving it under the path.
- **The queue and AWS items P298 left open (P304).** A worker's processor
  written at its construction (`new Worker('receipts', async (job) => ...)`)
  that does more than hand the job on is a handler of its own with the calls
  its body makes, named by the class constructed. What a `catch` is handed is
  each value its try block throws in the repository, a method of another
  instance included; where a call on a package's value may throw out of it, a
  job or queue read off the error has a row naming that call rather than
  nothing, and the values the repository throws are read beside it. A CDK
  context value stays one the deployment chooses when handed to a function or
  class of the app as an argument, defaulted by a parameter, kept in a field
  or destructured out of a record. A stage `terraform.workspace` names is open
  with its name in the `default` workspace and in each workspace a map it is
  looked up in is keyed by (`lookup(var.m, terraform.workspace)`,
  `local.env[terraform.workspace].stage`), through locals and module inputs.

- **The rest of the deployment templating and grants P289 and P295 left open
  (P299).** A command keeping releases with a selector and `--include-needs`
  keeps what they need from any sub-helmfile of the state (transitively with
  `--include-transitive-needs`). A kept release whose chart a chart
  repository or a registry holds (`<repository>/<chart>`, `oci://`), or whose
  chart path holds no chart, is a `manifest-unread` row saying so, about the
  releases needing it too; `.Release` in an action of a helmfile's own text is
  a row saying helmfile refuses it unescaped. kustomize's
  `ValueAddTransformer` (`fieldPath`, `filePathPosition`, `targetFilePath`),
  `PrefixTransformer`, `SuffixTransformer` and `IAMPolicyGenerator` are read;
  a folder under `transformers:` or `generators:` is built as a kustomization,
  its own patches, prefixes and labels over its configurations; kustomize's
  default name references (config maps, secrets, services, service accounts,
  claims, roles, autoscaler targets) are renamed with what they name, a
  reference that writes its `kind` naming only that kind; and a selector
  reads `namespace`, `labelSelector` and `annotationSelector`. sceptre's Jinja
  runs `namespace()` and `{% set ns.x %}`, the tests (`is`, `select`,
  `reject`, `selectattr`, `rejectattr`), `groupby`, a macro reading a name its
  file binds after it, `loop.changed`, `for ... if` and recursive loops; a
  command beside another sceptre project launching this one is read, and a
  stack's hooks are a row. An AWS write through a repository is read where
  `Object.assign` puts a parameter after the literal that no caller hands the
  key, where the v2 client is a field the constructor assigns with `aws-sdk`
  not installed, and where the table is a static field set from the
  environment; the data reader's `db-layer-unread` row is withdrawn for a
  class a producer was read through; and a producer whose variable every
  function of its service is given the same value is joined (heuristic). A
  CDK role's managed policies (AWS ones by their access, a policy the app
  writes by its statements, one looked up named), a user's groups and a
  `CompositePrincipal`'s members carry their grants.
- **Ports, settings and requests left open (P296).** A full-stack
  framework's own server - Next, Nuxt and Nitro, Remix's `remix-serve` and
  React Router's `react-router-serve` - listens on its documented 3000, as
  `PORT`'s fallback, where no configuration, script or workspace target says
  (`default: true`), and on the port a script's own environment gives it
  (`PORT=3020 next start`, `-p ${PORT:-3020}`); a script handing the port in
  unread (`-p $PORT`) assumes nothing. A default is the weakest word for a
  port: it yields to any service the code or the files place there, and two
  defaults on one port are no answer. A chain of `||` or `??` is read as one
  step however long it is; the settings it reads after the first
  (`baseUrlAlso`) are where it goes next, their values and claimants its own,
  and its fallback is said in the module it is written in
  (`baseUrlDefaultFrom`). A helper is read per branch its arguments settle
  (`!x` included), a function an object holds as a plain one, and a request
  between services keeps the path a constant writes after its setting. A
  server's request under a public host with no path joins the one service
  serving its path as a guess (`externalValuePath`), as a browser's does,
  several an `ambiguous-route-target` row; a GraphQL operation under public
  hosts none of whose paths an endpoint serves joins the one endpoint serving
  it (`graphql-path`), several a row. An `XMLHttpRequest` opened in one
  function is sent where its receiver goes: another method sending the field,
  a field it is kept in, the function it is handed to, the caller it is
  returned to, the module holding it.
- **Front-end, SDK and gRPC items P291 and P293 left open (P297).** A link
  component of the application's own is read through to the link it renders:
  its address prop handed on as it is, inside text (`` to={`/help${to}`} ``),
  or to a function with the locale (`href={withLang(locale, href)}`, which
  lands under the top `[locale]` segment even where no middleware declares
  it), a component rendering such a link (`<Button href>`) or styled from one
  (`styled(LangLink)`) included; the link inside it says nothing of its
  own. A route table's list follows a registry of the repository's own (a
  class whose method reads a field its other methods add to, the entries
  handed to those methods anywhere in the repository, filtered by the key the
  store is looked up by), and an entry written over another list's elements
  is one per element, read off it through spreads and a JSON module. A first
  segment is a locale only if the application declares it (its Next `i18n`,
  next-intl's `defineRouting`, the `[locale]` segment's
  `generateStaticParams`), by its shape only where none is declared. An
  Angular route's `canDeactivate`, its own then its parents', is drawn from
  its screen with `meta.leaving` and an order of its own. A request written in
  a method of a class that is not a client of the repository's own is drawn
  from `Class.method`. typescript-apollo-angular's `sdkClass` (named by
  `serviceName`) and per-operation services are read from a module nobody
  committed, and a committed service extending `Apollo.Query` is read. Remeda
  composes (`piped`, `createPipe`), and `export default flow(...)` is called
  where it is imported. A gRPC handler's reads of `call.request` (or a NestJS
  method's message) that its message does not declare under the loader's
  names are `grpc-field-undeclared` findings (info), and an answer read under
  a loader keeping the case is compared under the server's names.
- **Queue and AWS items P286, P290 and P294 left open (P298).** A job record a
  queue layer plans, splits and hands back is read along that way: a name a
  `const` destructures out of what a function answers is that key of each
  record it may answer, a field of an instance written out is what its
  constructor keeps, `map.get(key)` of a `Map` a `const` holds each value it
  is given, an element at a place a spread or a `push` may move one of the
  list's elements, a value that is one of several - some waiting on a caller -
  each followed out on its own, and what a `catch` is handed each value its
  try block throws in the repository's own functions; two of a layer's calls
  drawn at one caller are one producer naming every job either names. A
  scheduler's template with no `name` names its job by the scheduler's id
  (the `argument-property` locator's new `otherwise`). A worker's processor a
  caller writes in place that does more than hand the job on is a handler of
  its own, with the calls its body makes. An API Terraform maps onto a custom
  domain records `servedAt` at the domain and at its own address with the
  base path it does not write (`under`); a stage reached through a `local` or
  a child module's input is open where a root variable or the workspace
  decides it; a module's provider is the one its call's `providers` map
  hands it. A Serverless region from the file is the default of any region
  `--region` names (`chosenHost`), as a CDK stage or region from
  `tryGetContext` is of any `-c` names, and a SAM parameter a parent template
  hands down from its own parameter is open; the served-at join asks the API
  deployed to by default at the host a request writes before the rest
  (`fixtures/job-batches-planned-by-a-layer`,
  `fixtures/gateway-served-at-deploy-choices`).

- **Kustomize transformer and generator files, labels, and what P289 left of
  helmfile and charts (P295).** A kustomization's `transformers:` and
  `generators:` are read from the files (or the folder, or the inline text)
  they name: kustomize's built-in `PrefixSuffixTransformer`,
  `LabelTransformer`, `AnnotationsTransformer`, `NamespaceTransformer`,
  `ImageTagTransformer`, `PatchTransformer`, `PatchJson6902Transformer`,
  `PatchStrategicMergeTransformer` and `ReplacementTransformer` each over the
  fields its `fieldSpecs` name, and `ConfigMapGenerator`, `SecretGenerator`
  and `HelmChartInflationGenerator` as the fields they stand for; an exec or
  Go plugin or a KRM function is a `manifest-unread` row saying kustomize runs
  it. `commonLabels`, `labels:` (`includeSelectors`, `includeTemplates`,
  `fields`) and `commonAnnotations` are written where kustomize writes them,
  a service's selector and a pod template's labels among them, and a
  configuration's `commonLabels`, `commonAnnotations`, `namespace`,
  `namePrefix`, `nameSuffix` and `images` field specs add to those. A field
  naming a resource is renamed from any name the resource had, a base's
  included, so an overlay's route naming a base's gateway reaches it under its
  prefix. A sub-helmfile writing no selectors keeps every release of its own
  where a command runs helmfile with explicit selector inheritance
  (`HELMFILE_EXPERIMENTAL`), only `selectorsInherited` taking the command's,
  and one writing both is a row; a release's need is answered by any helmfile
  of the state, so a need on a sibling sub-helmfile's release is installed
  after it rather than `release-need-undefined`. A chart's dependency settles
  what its own dependencies import before it hands values up. Rows say why
  what stays unread is: a release's or a helmfile's hooks (programs, run and
  not read), a remote sub-helmfile (fetched when helmfile runs), and a chart
  dependency only a chart repository has (no repository is read).
- **Route tables over a list, pages under a condition, a locale prefix, and
  an Angular route's guards (P291).** A `<Route path={config.path}
  component={config.component} />` written over a list's items places one page
  per entry of the list a hook, a `const` or a function of the repository
  hands back. Pages each placed under its own side of a condition nothing
  written decides (`env.X ? <Switch>a</Switch> : <Switch>b</Switch>`) are
  branches: a navigation to their address lands on each, `heuristic` with
  `meta.branch`, where it was `ambiguous`. In a Next application whose pages
  sit under a top `[locale]` segment and which declares a middleware or
  routing configuration that adds it, an address written without the prefix
  lands on the page under it, `heuristic` with `meta.localePrefix` and a
  `navigation-locale-prefixed` note, and next-intl's own `Link`, `useRouter`
  and `redirect` are navigations. Two navigations from one function to one
  page keep every address (`meta.alsoNavigates`), the one written outright
  before a guess. An Angular route's `canMatch`, `canActivate`,
  `canActivateChild` and `resolve`, its own and its parents', are `calls`
  edges from its screen (`meta.guard`, `meta.order`), whether or not they
  navigate, with a functional guard's calls on `inject(Service)`.
- **Settings and full-stack requests left open (P292).** An address rooted
  at a constant that is a chain of `||` over settings
  (`withScheme(process.env.APP_URL) || PREVIEW_URL || 'http://localhost:3000'`)
  is rooted at the first setting, read through a function of the repository
  that only reshapes what it is handed (every return the parameter, the
  parameter after a scheme or with a path after it, or no value), with the
  text the chain ends in as its fallback; a browser's request carries that
  fallback too. A value at a port of this machine is placed at the service
  whose code listens there, where no compose file or env file says so. A
  browser's request is placed by its setting's name as one between services
  is, and the two halves of one call read by both halves of a full-stack
  application go to one target: the browser's half follows the server's join
  (`via: same-call`), save a join the configuration wrote for the browser,
  which the server's half then follows. A GraphQL operation whose setting's
  only values are public hosts is asked of the endpoints at the path they
  agree on, under the rule a value for this machine has (one endpoint, a root
  field it declares); a request between services is tried under an external
  value's path only where the values agree on it. The coverage harness counts
  a call read by both halves once, in a row of its own, and a hand label on
  it is right where either half joined the right way in.
- **gRPC messages as payload types, a package's health and reflection
  services, and what a server and its contract disagree on (P287).** A
  `.proto` file's messages and enums are read (nested ones, `repeated`,
  `map`, `optional`, `oneof`, proto2 and editions) and registered as types:
  fields named as JavaScript reads them (`user_id` as `userId`), the 32-bit
  numbers as `number`, the 64-bit ones as `number | string`, an enum as its
  names or a number, a `oneof` as one shape per member chosen, the well-known
  types other than `Empty` claiming nothing. Every gRPC way in - a server's,
  a NestJS controller's, a service declared by its contract (following the
  files it imports) - carries its request and response as a procedure's
  input and output, and a call carries the request it writes, its keys, and
  the answer its callback or its promise reads, so `flowatlas contracts`
  compares a caller's request object with the message: a field the message
  does not declare, a value of the wrong kind. A field of a message may always
  be left out by its sender (a new wire rule, `proto-presence`), so no gRPC
  field is ever an optionality finding. A health service a package hands the
  server (`addService(health.service, ...)`, `new
  HealthImplementation(...).addToServer(server)`) is drawn as
  `grpc.health.v1.Health/Check` and `/Watch`, and a reflection service as
  `ServerReflectionInfo` of both versions; a package's service of any other
  contract is a `grpc-package-service` row. A method the contract declares
  that the server registering the service does not implement is a
  `grpc-method-unimplemented` finding, and a member an implementation object
  or a NestJS decorator names that the contract does not declare a
  `grpc-method-undeclared` finding, both informational. The coverage harness
  lets a target declare services by a document (`documents`), passed into the
  configuration it generates.
- **Routes and navigations written through helpers, lazy screens and
  templates (P288).** A route's path and a navigation's address are read
  through a function of the repository that hands back text, its arguments
  bound (a rest parameter's `join` and `length` included), a `const` in a
  template, and an optional parameter both ways; a condition nothing decides
  is one address per branch, the edge `heuristic` with `meta.branch`, a
  route so placed named in `meta.routeGuessed`. A route's screen is read
  through any lazy loader handed `() => import(...)`, a module handing on
  another's default export, and a member of the object a loader hands back
  (`Screens.Home.Component`). `createBrowserHistory()` navigates. In a service
  of several applications a navigation's candidates are its own
  application's pages, and a page file that hands out another file's
  component places it at its address. A navigation in a template's handler
  (Vue, Nuxt, Svelte), a SvelteKit application's plain `<a href>`, Angular's
  `(click)="router.navigate(...)"` (a `triggers` edge) and a functional
  guard's `createUrlTree` / `parseUrl` (a `function` node, `meta.redirects`)
  are read. A call in a member of an object a factory hands back, where the
  factory does more, is held by the member alone.
- **Deployment templating P273 and P272 left open (P289).** A helmfile's
  sub-helmfiles (`helmfiles:`, a path or a `*` pattern, with the `values` and
  `selectors` an entry gives, the command's selectors where it gives none) are
  read in its environment; a release takes the release templates it inherits
  (`templates:` and `inherit:`, `except` honoured) and the mapping a YAML merge
  key names (`<<: *default`, now merged by every YAML reader), its fields
  written as templates of the release rendered with it; `-l` selects by any
  label. A chart's packed dependencies (`charts/<name>-<version>.tgz`) are
  rendered in its release, their files said inside the archive, and what a
  dependency hands up through `import-values` is in the parent's values. A
  kustomization's `configurations:` rename the fields their `nameReference`s
  name (an `HTTPRoute`'s `backendRefs`, say) with the name prefix and add
  `varReference` fields vars are substituted in; a generator's `files` are
  keys of the config map. sceptre's Jinja runs `loop.cycle`, `revindex`,
  `previtem` / `nextitem`, tuple `set`, a macro's `varargs` / `kwargs`,
  `range`, `dict`, the methods of a text and a mapping and the rest of the
  common filters; a command launches the stacks the stacks it names depend on
  (`dependencies`, and every `!stack_output` read); `command_path` is the path
  launched; `!ssm` is said by the parameter it names. A table or a queue
  written through a repository base class is decided by the class extending
  it - what its constructor hands `super(...)`, what builds it, or what it
  initialises a field the base only declares to - and drawn where that is
  decided, `dynamodb/<table>` as readily as a one-part address. A CDK function
  handed a role (`role:`) carries the role's grants, statements, inline
  policies and attached `Policy`s, and `Grant.addToPrincipal` adds to the
  grantee's.
- **Where every AWS API is served, and what `XMLHttpRequest` sends (P294).**
  The routes of an API a SAM or CloudFormation template, a CDK app or
  Terraform creates record where it is served (`meta.servedAt`), as a
  Serverless API's do: the gateway host of the region the samconfig, the
  stack's `env` or the `aws` provider states, any region where none does, once
  per stage, the root for an HTTP API's `$default` stage, and any stage where
  it is left to deploy time - a parameter, a root module's variable or
  `terraform.workspace`, with the value it has where nothing overrides it - so
  an address written out with the API's id joins them too. A Serverless
  service's written stage (`stage: prod`) is now its default and any stage,
  since `--stage` overrides it, and of APIs whose stage is open, one deployed
  by default at the stage an address writes is asked first. The body an
  `XMLHttpRequest` is handed by `send()` after `open(verb, address)` is read
  as `fetch`'s is: `JSON.stringify(x)`, a `FormData`, a const.
- **Plain browser code, and an API's address written out with its id (P284).**
  A directory with no manifest that holds a page and the scripts it loads, and
  nothing that builds them, is the type `browser`: `link` and `init` offer it,
  and the browser reader reads the requests its scripts send - `fetch`, and
  `XMLHttpRequest`'s `open(verb, address)` - with the classic scripts of one
  page sharing their globals. Every route of a Serverless service's own API
  records where the API is served (`meta.servedAt`): the gateway host of its
  region with the id left open, under its stage, or any stage where the file
  leaves it to the command line. A request written anywhere in the project to
  `https://<id>.execute-api.<region>.amazonaws.com/<stage>/<path>` is joined to
  the one API served there, the path after the stage asked of its routes,
  `heuristic`, with a `base-url-from-files` note; several APIs there are an
  `ambiguous-route-target` row naming them.

- **The coverage harness measures whether a join is right, and reads a
  system split across repositories (P278).** A target may carry hand labels,
  `scripts/coverage/labels/<target>.json` (gitignored; the format is
  `labels.example.json`): call sites written from the source with the way in
  each reaches, `none` for a call that leaves the system, or `unread-ok` where
  a row is the right answer. Its report gains *Against the hand labels* - per
  kind, right, right and also elsewhere, wrong, missed, falsely joined and
  sites not found, with precision and recall, and every label that was not
  right listed by file and line with what was expected and what was got; a
  label whose text moved is followed and says so, one whose file or text is
  gone is reported, never dropped. A target may also be several repositories
  (`repositories`, each with its `repository`, `commit`, `read` and `types`
  and the directory it is cloned to), cloned side by side and linked as one
  project, with the counting rule's extent, the read gate, I14 and `--pin`
  working per repository and a report section *Across repositories* counting
  the requests and messages each one sends that land in another. A report of
  one repository without labels is unchanged. The harness is not part of the
  published packages.

- **Deployment templating P263 and P264 left out (P273).** A helmfile's
  `bases` are layered under it as helmfile layers them - each base's parts,
  environments' values and releases before the helmfile's own, its paths
  written from the helmfile's folder - and a release's `needs` is kept as the
  releases it is installed after; a command keeping releases by name with
  `--include-needs` (or `--include-transitive-needs`) keeps what they need, and
  a need no release of the helmfile is, is the new finding
  `release-need-undefined`, as helmfile refuses to apply it. `helmfile -f`
  naming a folder reads every helmfile in it. kustomize's deprecated `vars`
  are substituted, each the value at its `fieldref` of the resource its
  `objref` names once the build is named and prefixed, in containers'
  `command`, `args` and `env`, an `Ingress`'s hosts and a `ConfigMap`'s data;
  a var whose resource or field is not there stays `manifest-unread`. In
  sceptre's Jinja, macros (with defaults, keywords and `{% call %}`), `include`,
  `import`, `from ... import`, `extends` with `block` and `super()`, `raw`,
  `with`, `filter` and `set` blocks are run, the files named read beside the
  file rendered, every way an undecided condition goes; a template a stack
  names is read whatever its own text declares, a `.j2` file only another names
  is a part and not a template, and a template its undecided conditions render
  differently is not read. `fixtures/cluster-templating-joins` and
  `fixtures/multi-repo-jinja-files` show each case.
- **Codegen documents nobody commits, operations sent through helpers, and a
  schema a library patch chooses (P275).** A `…Document` imported from a
  module the repository does not commit - one its GraphQL Code Generator
  configuration generates, or one named like a codegen output - is the
  operation of that name (PascalCase, with or without its type after it) in
  the documents the configuration lists, or in every `.graphql` file of the
  package, with the fragments of all of them; a name none holds is still
  `graphql-document-dynamic`, naming where it looked. A call whose document
  is a parameter of the repository's own helper, or a member of one
  (`runQuery({ query })` over urql's `createRequest`, `runMutation(doc)` over
  `client.mutation`, through Vue's `reactive`), is the operation each caller
  hands, drawn at the caller with `through`; a caller handing an unreadable
  document is a row at that caller. A client a helper is handed is the one
  its callers agree on, and a client whose whole address is a setting is
  rooted at that key. `window._env_?.X` (and `window.__ENV__`,
  `globalThis.env`, `__RUNTIME_CONFIG__`) is a settings root, read through a
  constant imported from another module. A resolver with no scope is served
  by the schema a committed patch of the GraphQL library gives it, where a
  line the patch adds reads `Reflect.getMetadata(KEY, …) || 'scope'`
  (`fixtures/graphql-codegen-helpers`).
- **Workers made by a construction, a job named further out than its queue,
  and a job no handler takes (P271).** BullMQ's `new Worker(name, processor)`
  is a consumer wherever it is written, and the older library's
  `queue.process('job', handler)` one that names its job. A worker made with a
  name the code hands in is read once per queue the name stands for: out to
  each caller of the function it is a parameter of, and through each loop it
  is a variable of - `for…of` / `for…in`, `forEach` / `map`, over a record's
  keys, values or entries, an enum, a list written out and its spreads - so a
  worker per key of a record of handlers is a consumer per key, its handler
  the member of the record the processor looks it up in by that name
  (`handlers[name](job)`, in the processor or a function it runs); a list the
  code does not write out is a `channel-dynamic` row saying so. A job name a
  caller further out than the queue decides is followed out the way the queue
  is, and so is one whose queue is read where the broker is called; the
  entries of `addBulk` name their jobs, a list the layer maps
  (`jobs.map((data) => ({ name, data }))`) included, several names kept as
  `jobNames`. Once every repository is merged, a job added to a queue whose
  every handler names another job is the finding `job-no-handler` (info); a
  queue with a handler that takes every job is not asked about, and neither is
  a handler of a job nothing adds.
- **Queues kept by a base class, job records built further in, and BullMQ
  flows (P286).** A queue or a worker made from a field its class keeps from
  the constructor - `super(Topic.Mail, …)` in each class extending it - is
  read once per class: a worker made with `this.topic` is a consumer of every
  topic the classes extending its class hand `super(...)` (or a `new` of it
  hands its constructor), and a publish on a queue a client opened in another
  method (`this.queue = new Queue(topic)` in `open(topic)`, `this.queue.add`
  in `add`) is drawn where the caller holds the instance, with the topic that
  instance was built with - through `super(...)` where the instance is of a
  class extending the one that keeps it. A class chosen by a condition,
  `const Made = paid ? PaidWorker : Worker`, is the transport's where either
  branch is. A job record handed to a layer is read where it is built: a
  `const`, a record spread into another, each record a function may answer
  (an `async` one awaited; a `return` of nothing is no record) with its
  parameters bound to what the call hands, a name taken out of an options
  object, and each branch of a condition, one queue per value. BullMQ's
  `FlowProducer.add` and `addBulk` add a job to the queue of every node of the
  tree, the parent's and each child's, `name` and `data` read per node. A
  registry typed `{ [kind in JobKind]?: Queue }` states its entries are
  queues (`fixtures/job-queue-layers`).
- **A worker's processor handed in by each class extending its base, flows
  built from what callers hand in, and a way out of any length (P290).** A
  worker a base class makes from the topic each class extending it hands
  `super(...)` runs, for that topic, the processor handed to it on instances
  of that class - followed along the calls the topic was handed through, then
  out to each call on such an instance (`this.init(this.processor())` in the
  class's constructor, `worker.init(handle)` outside it) - so it is one
  consumer per queue with its own handler, where it was one consumer at the
  construction for every queue with `consumer-handler-unresolved`; a method
  that answers the processor it writes is the handler. A `let` is each value
  it is given, so a flow built in a loop that makes each job the parent of
  the one before (`last = { ...node(job), children: last ? [last] : [] }`) is
  read node by node, each node once. An element of a list not written where
  it is named - a `for (const job of jobs)` variable, a `map` or `forEach`
  callback's parameter - is each element of that list as its caller writes
  it: a rest parameter is each argument from its place on and the elements of
  a list spread into it, a list is the elements it is written with and those
  `push` and `unshift` add to it, `jobs[0]` the element at that place, and
  each branch of a condition is read on its own; an element that cannot be
  read is a `channel-dynamic` row beside the queues of those that can. The
  walk out from a publish to the callers that decide it is no longer cut
  after five calls, which drew a queue a layer hands through its own fallback
  inside the layer: it reads as far out as the queue goes, stops a recursion
  where it meets a function a second time, and stops after reading 5000
  calls for one publish, which a row says (`fixtures/job-flows-from-callers`).
- **An MCP client joined to the server's tools, MCP names read as far as the
  source states them, a server function reached through a client the
  repository builds, and a written return type read for a method call
  (P277).** An MCP client - `new Client(...)` from the SDK, connected with
  `client.connect(transport)` to a `StreamableHTTPClientTransport` or
  `SSEClientTransport` handed its URL - asking with
  `client.callTool({ name, arguments })`, `client.getPrompt({ name })` or
  `client.readResource({ uri })` is a request joined by the procedure join to
  the `mcp:tool:`, `mcp:prompt:` or `mcp:resource:` way in of its own service,
  of the service its transport's URL names, or of the one `apiTarget` names;
  a name worked out at run time is `procedure-path-dynamic`, a name nothing
  declares `procedure-not-found`, and a tool asked for as a prompt is
  refused. A resource is now keyed by the URI a client reads it with, a
  `ResourceTemplate`'s URI a pattern every URI it matches reaches. A name
  written in part, `` `find${collection}` ``, is a pattern named by its
  written text, joined `heuristic`, with an info `mcp-name-dynamic` row naming
  the part the run decides; a name a record carries, `registerTool(item.wireName,
  ...)` in a loop, is read from the records the repository writes with that
  member as text beside the definition the registration dispatches to
  (`{ wireName: 'countOrders', tool: countOrdersTool }`), each tool drawn where
  its builder defines it (`defineTool({...}).handler(fn)`), its handler behind
  it as sure as the guess that the configuration serves it. A server function
  or server action handed to a function of the repository that calls it,
  `createOrdersClient({ runOnServer })`, is called from that function, `static`
  where every call of it hands the same way in. A method of the repository
  that writes its return type, `this.factory.client()` or
  `await Registry.get().db()`, states the client's type for a call written in
  place and for a name holding its value, as a function called by name did.
- **gRPC services and the calls made to them (P274).** The repository's
  `.proto` files - every one from the service's directory up to the top of
  its repository or project, a shared `proto/` directory included - are read
  by a small tolerant parser for their package, services and methods, and
  each method a server implements is an `rpc` way in keyed
  `grpc:<package>.<Service>/<Method>`, with how it is called (unary, a stream
  either way or both) and the function behind it: `server.addService(...)`
  on `@grpc/grpc-js` or `grpc` with a service of a loaded contract
  (`loadPackageDefinition(loadSync('shop.proto')).shop.CartService.service`),
  a generated definition, or a generated name nobody committed that a
  contract declares, implemented by an object of functions or an instance of
  a class; and a NestJS controller's `@GrpcMethod`, `@GrpcStreamMethod` and
  `@GrpcStreamCall`, its package from `transport: Transport.GRPC` options. A
  server's calls - `new CartServiceClient(address, credentials)` generated
  or taken from a loaded contract, through `promisify`, and NestJS's
  `getService('CartService')` - are requests between services of kind `rpc`
  joined to the method of the service their address names (`CART_ADDR`, a
  host, the client options' `url`). A service written in another language is
  declared by its contract, `document: { kind: "protobuf", path, services }`
  (the new `services` narrows a file every service shares), and its methods
  are ways in callers join to. New rows: `grpc-service-unread` (a service
  registered, or a client made, that cannot be named), `grpc-contract-unread`
  (a service no contract here declares, its methods named as written) and
  `grpc-method-unserved` (methods a contract declares that nothing configured
  implements, one row per caller and service). `@grpc/grpc-js` and `grpc`
  make a repository's type `grpc`, and a service with no TypeScript among its
  sources reads its JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`), so a plain
  Node server is read rather than skipped. The counting rule counts
  `addService(definition, implementation)` and the NestJS decorators.
- **Where a send goes that does not say, from what its function is granted;
  an address of a template's own API; a service's parameter with no value;
  and lists of several elements (P272).** A send whose address is not read -
  a queue's URL looked up in a cache the code fills by listing the account, a
  topic handed in - is drawn, `heuristic` with `via: "grant"`, to each queue,
  topic, bus, table, stream or bucket every function that runs it is granted
  by name, and a start reaches each function or workflow granted; a
  `channel-from-grant` note (new reason) replaces the row that said the
  address was not read, quoting it. A grant on every one of the kind - `*`, an
  ARN ending in a wildcard, a managed full-access policy - draws nothing, and
  the row that stays says which grant bounds nothing. Grants are read from
  SAM's policy templates and statements and the role a function's `Role`
  names, CloudFormation's `AWS::IAM::Role`, `AWS::IAM::Policy` and
  `AWS::IAM::ManagedPolicy`, a service file's `provider.iam.role`,
  `iamRoleStatements` and a function's own, Terraform's role, its
  `inline_policy`, `aws_iam_role_policy` (a policy document data source,
  `jsonencode` or JSON) and attachments, and a CDK construct's `grant*` calls
  and `addToRolePolicy` statements; a function carries them as `grants`. A
  SAM or CloudFormation function deployed with `!Sub https://${Api}.execute-api...`
  of its own API, or an HTTP API's `ApiEndpoint`, is handed that API, and a
  request rooted at it joins the route after the stage. A Serverless
  resource or value named by `${param:<name>}` with no value is named by the
  parameter (`${…}@params.<name>`, `deployed-name-from-parameter`). A list of
  several elements, and a `Map` or `Set` made with or given several values,
  is one address per element where the walk used to stop.
- **Every router's navigations, a client's default headers, an answer handed
  back, a wrapper's body and an object of functions a factory hands back
  (P276).** `push` and `replace` on a router however it was got
  (`useRouter()` of Vue Router or Next, `createRouter`, React Router's data
  routers, Next's `Router`, `this.$router`, `push` taken out of
  `useRouter()`), React Router's `navigate` from `useNavigate()`, SvelteKit's
  `goto`, a `redirect(...)` of Next, React Router, Remix or SvelteKit,
  `<RouterLink to>` outside Nuxt, and `<Link to>`, `<NavLink to>` and Next's
  `<Link href>` in JSX are `calls` edges to the page shown, with the
  `navigation-external` and `navigation-unresolved` rows, as Nuxt's are, and
  left out of `cycles`; an Angular class's `router.navigate([...])` and
  `navigateByUrl(...)` too. A Next page of the older router under `pages/`
  is a screen with its `route`; two pages that fit as well in two
  applications of one service are told apart by the navigating file. A header
  written to a client's defaults (`api.defaults.headers.common['X'] = v`) is
  carried by its requests in the browser and on the server, unread only where
  written as code, under a condition, removed or for one verb. A response
  handed back from the function the request is made in - an Angular service
  returning `http.get(url, { observe: 'response' })` - is read for the headers
  where each caller holds it. A wrapper drawn in front of a way in that names
  a function of the repository has its body walked, its node calling the
  function. A member of an object a factory writes whole and hands back
  (`export default Gateway()`, `Gateway.listOrders(id)`), and `this.member()` in
  another member, land on the member, a function and a scope of its own.

- **A handler behind its wrapper, a request handed in as one object, and a
  GraphQL server made into a Lambda (P269).** A `pages/api` default export
  that is a call of wrappers - the repository's own or a package's -
  handed a function, `export default withTracing(handler)`, is read as that
  function with the wrappers drawn in front of it as middleware, and answers
  the verbs the function compares the request's method to (`switch (method)`,
  `req.method !== 'POST'`) instead of `ALL`; one written in place inside the
  wrapper is pointed at where it is written, a factory of the repository is
  the handler as for a verb export, and a package's handler built from values
  is the `route-handler-unread` row that says so. The app router, Remix,
  SvelteKit and Medusa readers land a verb export built by wrappers round a
  declared function on that function the same way, and a landing through a
  wrapper nobody installed is `heuristic` with `wrapperUnread`. A wrapper that
  takes its request as one object and takes its members out where the
  parameter is written, `({ url = '', method = 'GET' }) => fetch(url, {
  method })`, has each caller's request read at the caller, its address and
  its verb the members the caller writes or the defaults the pattern writes,
  in the browser and server readers alike, and a caller written in a method
  of an object a function hands back is attributed to that function on the
  server side too. A name taken out of the environment where it is declared,
  `const { SHIPPING_URL = '' } = process.env` (or `import.meta.env`, or a
  settings root), is that setting read, with its default. A Lambda whose
  handler is a GraphQL server made into a function -
  `new ApolloServer({ resolvers, typeDefs }).createHandler()`, or a server
  handed to `startServerAndCreateLambdaHandler` - is read as that server
  (`handlerVia: graphql`), the route in front of it is its endpoint with its
  schema and no `/graphql` is invented, Apollo Server's Lambda, Azure
  Functions, Cloud Functions and micro packages are read for resolvers, and
  a resolver map put together from another map's members
  (`...orderResolvers.Query`) or handed a resolver by its name (`{ author }`)
  is read.
- **A queue a service runs through a layer of its own is read where each
  caller names it (P267).** A server that wraps BullMQ in a queue service of
  its own - `@InjectJobQueue(Queues.mail) mailQueue: JobQueueService`, then
  `this.mailQueue.add(SendMailJob.name, data)`, into a driver interface, into
  `this.queues[queueName].add(jobName, data)` - had every queue's consumers
  and not one producer. The broker's call is now followed out to the calls
  that decide its queue: a parameter becomes what each caller passes (a
  destructured one too), a field becomes what the instance was built with,
  read at the `new` that built it or at the decorator a caller asked the
  container with, through a decorator of the repository's own that wraps
  `Inject(token(name))`, to the provider that builds the instance under that
  token. Each enqueue is drawn at its caller with its job and its message
  (`meta.through` names the functions it came through; `heuristic` where a
  call on the way may run another implementation), and the broker's call
  draws nothing of its own once every call of it is attributed. A client kept
  in a registry by queue - `this.queues[name] = new Queue(name)` - is that
  queue (the `receiver-registry-key` locator), and is known to be a BullMQ
  queue from the registry's annotation with nothing installed; `new
  Queue('reports').add(...)` is read too, as is a repeated job registered
  with `upsertJobScheduler`. `SomeJob.name` reads as the class's name, so a
  job named after its handler is one job at both ends. An instance whose
  queue cannot be read is a `channel-dynamic` row at the caller naming it.
- **Every way a cluster is installed and a server asks itself (P263).** A
- **Ways in reached by a name, and ways in nothing serves (P270).** A
  TanStack Start server function - `export const placeOrder =
  createServerFn({ method: 'POST' }).middleware([...]).handler(fn)` from
  `@tanstack/react-start`, `solid-start` or `start` - is an `rpc` way in keyed
  `serverfn:<file>#<name>`, sent with the verb its options write (`GET` where
  they write none), its middleware in front of it, and reached by import: each
  call of the export is a `calls` edge to it, as a Next server action's is. A
  chain nothing names is a `server-action-unread` row. An MCP server's tools,
  prompts and resources - `registerTool`, `tool`, `registerPrompt`, `prompt`,
  `registerResource`, `resource` on an `McpServer` of
  `@modelcontextprotocol/sdk` or `@modelcontextprotocol/server`, recognised by
  its type or by `new McpServer(...)` and the annotation where nothing is
  installed - are `rpc` ways in keyed `mcp:<kind>:<name>`, handled by the
  function each is handed; one registered under a name decided at run time is
  the new `mcp-name-dynamic` row. koa-router's `router.register(path, ['get',
  'post'], [middleware, handler])` declares a route per verb, the last handler
  answering and the ones before it in front (a route description's new
  `verbList` field says where such a method keeps the three); verbs decided at
  run time are `route-verb-unread`. A tRPC or oRPC tree a workspace package
  assembles that no tree holds, no mount serves and nothing names, and a way
  in declared on its own (`export const stats = authed.query(...)`) that no
  tree holds and nothing names, are the finding `procedure-unmounted` (info),
  one row per service with the files of each in its causes, where before both
  were set aside without a word. A
  `helmfile.yaml` installs its releases in each environment it declares (or
  the one `helmfile -e` names), rendered over the environment's values; a
  chart renders its dependencies (`file://` charts and `charts/`) inside its
  release with its values' subtree, a false `condition` leaving one out; a
  kustomization inflates its `helmCharts`, generates its `configMapGenerator`
  and `secretGenerator` config maps and applies its `replacements`, and a
  pod's `envFrom` and `configMapKeyRef` read the values they hold. An
  `Ingress` rule with no `host` serves the front ends behind it, and each path
  is a way in at its own rule's host only. `helm`, `helmfile`, `kubectl apply
  -k` and `kubectl port-forward` in GitHub workflows and GitLab jobs are read,
  by the one command reader the deployment readers share (moved to
  `@flowatlas/serverless`), and the overlay a pipeline applies is the one
  read. A Next or Nitro server's own `fetch('/api/x')` with no host is the
  finding `server-request-without-origin` (it throws as written), while
  Nitro's `$fetch('/api/x')` joins its own route in process, `static`.
  `proxiedTo` is now a list naming every hop's setting.
- **Failure destinations of every mapping, Jinja statements, sceptre's
  resolvers and Terraform directives (P264).** A CloudFormation or SAM
  `AWS::Lambda::EventSourceMapping`'s `DestinationConfig.OnFailure`, a SAM
  stream event's destination of the kind its `Type` says, a Serverless stream
  event's `destinations.onFailure` and the CDK's `onFailure` (`SqsDlq`,
  `SnsDlq`, `S3OnFailureDestination`) hand what a mapping gives up on to its
  destination, as Terraform's do; where both the source and the destination
  are imports, the destination is a choice inside each of the mapping's
  readings, which the linker settles. sceptre's files are rendered with
  `{% if %}`, `{% for %}` and `{% set %}`, the common filters (`default`,
  `lower`, `upper`, `replace`, `join`, `int`, `string`, `trim`, `tojson`, ...),
  `stack_group_config` and `--merge-vars`; a condition the files do not decide
  is rendered every way, and only what every way agrees on is read. Its
  resolvers `!file`, `!stack_attr`, `!join`, `!split`, `!select`, `!sub` and
  `!no_value` are read, `!rcmd` and `!cmd` said as values not known.
  Terraform's `%{ if }` and `%{ for }` in a string template or a
  `templatefile` are read part by part around imports, a condition nothing
  decides read both ways. A NestJS module imported from a package that is not
  installed is read by its import and said as `module-import-not-installed`
  (new reason), where it was `module-import-dynamic`. New fixture
  `multi-repo-failure-values`.
- **Navigations, the headers a client's hooks add, and the headers an answer
  is read for (P265).** `navigateTo(...)` and `<NuxtLink to>` are `calls`
  edges to the page each shows (`meta.navigates`, `meta.route`,
  `meta.page`), matched by path - a template's `${…}` as a parameter - or by
  the name Nuxt gives a page's file or its `definePageMeta({ name })`; a
  middleware's `return navigateTo(...)` is `meta.redirects`; an address with
  a host or `{ external: true }` is a `navigation-external` note, and one no
  page shows, two fit or written as code a `navigation-unresolved` row;
  `abortNavigation()` is `meta.abortsNavigation` on the function that calls
  it; `cycles` (and the overview's count) leaves navigations out, so two pages
  linking to each other are no cycle. An `addRouteMiddleware` inside `onMounted` (or `onBeforeMount`) in
  `app.vue`'s setup is in every page's order as one at the top of the setup is,
  `meta.mounted: true`. What an axios interceptor, ofetch's `onRequest` and
  ky's `beforeRequest` do to the headers is read - names set unconditionally
  are the request's, anything else `meta.headersUnread`, and one that does
  nothing to them adds none - in the browser and on the server, where an axios
  instance's own headers and interceptors, the module's, and NestJS's
  `HttpModule.register({ headers })` and `axiosRef` interceptors are read too.
  An Angular interceptor's `req.clone({ headers: req.headers.set(...) })` and
  `headers: new HttpHeaders({...})` are read as `setHeaders` is. The three
  readers record the headers a caller reads off the answer
  (`meta.responseHeaderKeys`), and a detailed oRPC output's `headers` are
  compared with them from the caller's end: a capital read as a key is an
  error, a name the output does not declare a warning (`header-not-declared`),
  one the HTTP layer writes not compared. New fixture `nuxt-navigation`;
  `rpc-shared-types` extended.
- **Several GraphQL endpoints, and the client each operation is sent with
  (P266).** A NestJS server's every `GraphQLModule.forRoot*` is an endpoint of
  its own, its options read in place, from a `useFactory` or from a
  `useClass`'s `createGqlOptions()`, and its `path` as any string (a template,
  a constant, an enum member; one not read keeps `/graphql` with a
  `graphql-endpoint-unread` row). Which resolvers each serves is the scope its
  options name that the repository's resolver decorator tags them with
  (`SetMetadata`), or else the modules its `include` names with what they
  import; where endpoints serve different resolvers each field is keyed by its
  path (`Query.me@/settings`), each endpoint carries only its root fields
  (`meta.graphql.fieldsAt`), and an operation joins only its endpoint's. A
  plugin of the repository's that answers a request itself makes a missing
  root field a `graphql-field-no-resolver` note, not `graphql-field-unknown`
  (`meta.graphql.open`). An Apollo operation is sent with the client it names
  (`{ client }`, the client it is a method of), followed through
  `new ApolloClient({ uri | link })`, a factory handed `{ uri }` or the
  default it writes, and `useContext` to its provider's `value`, and otherwise
  with the one `<ApolloProvider client>` is handed (`graphql-client-unread`
  where a named client is not followed). An operation whose address's opening
  was not read joins the one endpoint whose path ends with the rest,
  `heuristic` (`via: graphql-path`); two are `ambiguous-route-target`. A
  helper posting `JSON.stringify({ query })` is read with the document each
  caller hands it, and a value inside a string of a document is a value. New
  fixture `graphql-endpoints`.
- **Events built by factories, elements of lists, and names a parameter
  with no value gives (P268).** A send's address is read through what the
  value it walks is made by: a member of a record of values or factories a
  lookup chooses (`events[name](data)`, `events.Placed(data)`), a function
  called by its name and the record it answers, its parameters bound to the
  call's arguments, an element of a list a loop or a callback takes (`for
  (const r of list.filter(...).map(...))`, `list.forEach((r) => ...)`), and
  the one value a `Map` or `Set` is given and read back through `values()`.
  Where a member is chosen by a parameter of the function the send is
  written in, or the record is that parameter, the send is drawn at each
  caller with the parameter bound to what it hands, wherever every caller
  writes it; otherwise the send stays where it is and its row names the
  parameter and the callers that hand something unread. A name read out of a
  collection by a key worked out when the code runs (`cache.get(key)`) is a
  `channel-dynamic` row naming the collection and the key. A SAM or
  CloudFormation resource named by a parameter with no value is named by the
  parameter's declaration (`${…}@Parameters.<name>`), and a value of the
  environment that is that parameter names that resource: a table, a stream
  or a queue joins its writers and readers within the deployment, and a
  function so named is deployed under the stand-in rather than being
  `function-name-unread`, said by
  `deployed-name-from-parameter` (new reason, a note). An
  `AWS::Kinesis::StreamConsumer`'s `ConsumerARN` is the stream it is
  registered on. A Serverless function's environment value that is an API
  Gateway address in the service's region and at its stage
  (`https://<id>.execute-api.<region>.amazonaws.com/<stage>/<path>`) is the
  service's own REST API - an HTTP API's where no stage is written - and a
  request rooted at it joins the route at `<path>`, `heuristic`, with a
  `base-url-from-files` note saying the id is written out. New fixtures
  `serverless-event-factories` and `sam-parameter-names`.

- **The front end's and the RPC readers' last open names (P262).** An
  `addRouteMiddleware` at the top of `app.vue`'s setup, or of a composable
  that setup calls, is a route middleware in every page's order after the
  plugins' (`meta.setup`, `meta.addedIn`, `meta.firstNavigation: false`); one
  a component, a handler or a callback adds is a `route-middleware-unresolved`
  row (`why: scoped`) at the call and at a page that names it. Nuxt UI (`U`)
  joins the table of component libraries, a prefix the application sets is
  read (PrimeVue's `primevue.components.prefix` or its resolver's `prefix`,
  Nuxt UI's `ui.prefix` or its Vite plugin's), and a library a layer's
  `modules` installs is installed; the libraries' Nuxt modules are known
  modules. A query key held in a constant (`params.set(PAGE, v)`, an `as
  const` member, an enum, `{ [PAGE]: v }`) is that key, and `{ [key]: v }`
  with a key of no single value is no longer read as a key named
  `__computed`; an address built with `+` after its `?` is read in the
  browser, Angular and the server readers. Where Nitro's
  `experimental.tasks` is off (before Nitro 3), every task and schedule is
  `meta.enabled: false` and a `framework-feature-off` note says the build
  registers none; Nitro 3's `nitro` package is detected. A detailed oRPC
  input's headers are compared from the procedure's end: only its declared
  names, lower-cased, with a name it spells with a capital said; a client
  instance's own headers and an Angular interceptor's `setHeaders` are the
  request's; headers written in a way not read, or that a hook or an
  interceptor may add to, are `meta.headersUnread` and not compared; a
  header the procedure does not declare is no longer an `extra_field`. A
  coverage probe `sveltekit-server-load`. New fixture `nuxt-startup-names`;
  `rpc-shared-types` extended.

- **Every way a cluster or a proxy routes a request (P260).** A chart's
  templates are rendered with its `values.yaml` and the values files, `--set`s,
  release and namespace of the `helm install`/`upgrade`/`template` a script or
  a Makefile runs (value lookups, pipelines, `include`, `if`, `with`, `range`);
  a condition nothing decides is rendered every way, read where the ways agree
  and the row `manifest-unread` where they do not. A kustomization is built
  over the folders it lists, with its strategic merge and JSON 6902 patches,
  `images`, namespace and name prefix; where overlays nothing chooses differ,
  the base is read alone and the row `manifest-overlay-unchosen` says so, and
  `settingFiles.environment` or the new `settingFiles.overlays` /
  `settingFiles.chartValues` choose. An `Ingress` (with `rewrite-target`) and
  an `HTTPRoute` (with `URLRewrite`, hosts from its `Gateway`) send a public
  host's request to the service behind them at the rewritten path
  (`via: ingress`, `heuristic`, `wayIn`), a front end the way in serves
  included; a `nodePort` and a `kubectl port-forward` make a port of this
  machine reach the service. A Vite proxy key written as a regular
  expression, any regular-expression rewrite replaced by a literal, an
  http-proxy-middleware `router` table and a target read from a setting the
  service's files fill (`proxiedTo`) are read; a request a proxy forwards to
  another proxy is followed through up to four servers (`proxiedThen`), a
  longer or circular chain the row `proxy-chain-unfollowed`. A Next server's
  own request with no host joins its own route or its rewrites
  (`via: ownOrigin`). Coverage probes `ingress-route`, `chart-value`,
  `kustomize-patch` and `port-forward`. New fixtures `cluster-route-joins` and
  `proxy-chain-joins`.
- **The last deployment values and injection tokens no reader followed
  (P261).** A CDK template literal, `+`, `Fn.sub` or `Fn.join` with
  `Fn.importValue` or `valueForStringParameter` among its parts, and a
  Terraform interpolation over parameters of the account and outputs of
  another configuration's state, are read part by part as CloudFormation's
  `!Sub` is; a Terraform output of a root whose backend is written is published
  under `state:<backend>#<output>`, and `terraform_remote_state` outputs are
  values another deployment publishes. A mapping's failure destination that is
  itself an import is drawn as a choice inside each of the mapping's readings,
  and the linker keeps the one under the reading kept, where it was a row. A
  sceptre stack inherits its groups' `parameters` and `sceptre_user_data`; its
  files are rendered with `{{ var.x }}` and `{{ environment_variable.X }}` from
  the commands that launch it (`--var`, `--var-file`, their environment) and
  the var files `services[].infra.vars` names; `!stack_output` and
  `!stack_output_external` are joined as exports, `!environment_variable` read
  from the launch's environment; a `.j2` template is rendered with plain
  `sceptre_user_data`. sceptre and rain commands are read in shell scripts,
  GitHub Actions workflows and GitLab CI files too, a shell's `cd` followed;
  every `rain deploy` option is known, so an option's value is never taken for
  the stack. NestJS: an alias (`useExisting`) the provider index finds is
  followed to what it names; `@Inject(appConfig.KEY)` and
  `@Inject(getConfigToken('app'))` are provided by the `registerAs` that
  `ConfigModule.forRoot({ load })` or `forFeature` loads; a module import chosen
  by a literal condition, a `const` or a function of the repository is
  followed. `@requiresScopes` and `@policy` requirements are compared by which
  implies which, not as written. New fixtures `multi-repo-deploy-values`,
  `nest-followed-tokens` and `graphql-requires-scopes`.
- **The last values deployments share not joined, and tokens and addresses a
  configured module builds (P259).** A parameter file written as YAML is read
  as the JSON one is. A template a sceptre stack configuration names
  (`config/<group>/<stack>.yaml`) is read with its `parameters`, its stack name
  and its region; one a `rain deploy` command in a `package.json` script or a
  Makefile deploys, with its `--params` and `--config`; a resolver, a Jinja
  expression or a shell variable is a value not known, and two stacks or
  commands nothing chose between (`services[].infra.vars`,
  `infra.options.config_env`) are a `parameter-file-ambiguous` row. A rule's
  or a schedule's target of an import is read as each kind it may be and the
  linker keeps the publisher's, as P253 does for a mapping; a subscription's
  endpoint, a bucket notification's target and a dead-letter queue of an import
  are read as the kind their protocol or property says, where each was a
  `subscription-target-unread` row. A Terraform mapping read as alternatives
  draws its failure destination. A string with two imports or more is read
  part by part: an import outside the name is aside, and a name built of
  imports and text is written where every part is joined. NestJS's injection
  reader finds a token a configuring method (`forRoot`, `forRootAsync`,
  `register`) provides where the application calls it, in the repository or a
  workspace package, by the provider index the procedure reader uses (now in
  the core), so `di-token-unknown` goes for such tokens. A link's URL built
  over a parameter (`` `${options.base}/trpc` ``, `base + '/rpc'`) is read
  piece by piece to the setting or URL each piece is handed. New fixtures
  `multi-repo-shared-values` and `nest-configured-clients`.
- **Where a request is forwarded and where a container listens (P257).** A
  server's proxy is read and kept on its repository node (`meta.proxy`):
  Vite's `server.proxy` / `preview.proxy` (a `rewrite` read where it replaces
  the prefix with a literal), the proxy configuration an Angular dev server or
  a workspace tool's webpack dev server is started with (`proxyConfig`,
  `ng serve --proxy-config`, `pathRewrite`), Nitro's and Nuxt's `devProxy` and
  route rules' `proxy`, Next's `rewrites()` to an address outside the
  application (after its own files unless `beforeFiles`), and Create React
  App's `"proxy"`. A browser request with no host, or any request to such a
  server's own port, joins the service at the target's host at the rewritten
  path (`via: proxy`, `heuristic`, `proxiedBy`, `proxiedAs`), and the dev
  server's host is no longer drawn as a third party; a target no service is
  reached at is drawn as a third party with the note `proxied-to-third-party`,
  and a rule not written in literals is the row `proxy-rule-unread`. A
  cluster's manifests are read (plain YAML, several documents to a file, Helm
  templates where literal, a kustomization's namespace and name prefix): a
  `Service` routing `port` to a `targetPort` (named ports resolved through the
  pods it selects) is a host of the service it selects (`orders`,
  `orders.shop.svc.cluster.local`), joined with
  `listensAt: …, behind orders:80 (k8s/orders.yaml)`, the pods' environment
  outranking the code's fallback; a `targetPort` nothing listens on is
  `published-port-unheard`. A request with no port reaches the port its scheme
  defaults to. A request on a container's or a cluster's network to a port the
  service is not reached at there (a published port, or the pods' own port
  behind a `Service`) is the finding `network-port-unreachable` and is not
  joined. `docker run -p` in a `Makefile` or a shell script, the `port` of a
  workspace tool's serve target in `project.json` (Next, Vite, webpack,
  Angular; never `@nx/js:node`'s debugger port), and a NestJS settings object
  handed in by its token (`@Inject(appConfig.KEY) config: ConfigType<typeof
  appConfig>`, `app.get(appConfig.KEY)`) say where a service listens too.
  Coverage probes `dev-proxy` and `cluster-target-port` (family `listens`). New
  fixtures `dev-proxy-joins` and `cluster-port-joins`.
- **The front end's last unread names and query strings (P258).** A
  SvelteKit page goes through every layout up its route tree, root first, as
  ordered `calls` edges: each layout's `+layout.server` and `+layout` `load`
  (every server load, then every universal one, the page's own after its
  layouts'), then each `+layout.svelte`, a `@` reset (`+page@(app).svelte`,
  `+layout@.svelte`) cutting the chain where SvelteKit does; a reset naming no
  directory above is `layout-unresolved`. A component library a Vue plugin
  installs is read by a small table (Vuetify `V*`, PrimeVue's own names,
  Element Plus `El*`, Naive UI `N*`, Quasar `Q*`, Ant Design Vue `A*`): a tag
  of an installed one, or one `app.component` registers from a package, is
  the library's, with no edge and no row; a tag nothing registers says which
  `app.use(...)` of an unknown package may register it.
  `defineAsyncComponent(() => import('./X.vue'))` and `({ loader })`, held in a
  name, in `components: {}` or registered for every template, is the child it
  loads. `addRouteMiddleware('name', fn, { global })` in a plugin - a part's
  `plugins/`, or one a module's `addPlugin` adds - is a route middleware in
  the page's order: global ones after the build's, a named one in place of a
  file's. Nitro's `plugins/` (and a module's `addServerPlugin`) put each
  `nitroApp.hooks.hook('request', fn)` in front of every route, before its
  middleware, and `beforeResponse` / `afterResponse` behind it as
  interceptors; each file of a server's `tasks/` is a way in of the new kind
  `task`, named by its path (`db:migrate`), whose handler is `defineTask`'s
  `run`; `runTask('name')` reaches it by name, and each `scheduledTasks`
  expression is a `cron` way in that reaches the tasks it lists. In a Nuxt
  module's condition `nuxt.options.dev` and `nuxt.options._prepare` are false,
  as the production build is the one read, and a call only development makes
  is a `framework-module-skipped` note saying so. A query built in code is
  read into `meta.queryKeys` as P256 reads one written as an object:
  `new URLSearchParams({...})` and its `append` / `set`, Angular's
  `new HttpParams().set(...)` chains, `params = params.set(...)` and
  `{ fromObject }`, a query built into the address (`?${params}`,
  `meta.queryInAddress`), and a server wrapper's own `query` option beside
  what its caller hands it; a key written as code is `queryUnread`. The
  headers a request writes in place are `meta.headerKeys`, and a detailed
  oRPC input's `headers` is compared with them. New fixtures
  `sveltekit-layouts`, `vue-plugins` and `nuxt-plugins-tasks`; a coverage
  probe `nitro-task-file`.

- **Child components, layouts and route middleware by name, and the last of
  what a Nuxt module adds (P255).** A tag in a Vue or Svelte template, or in
  JSX, that names a component of the repository is a `calls` edge from the
  component that writes it to the one it names (`meta.renders`), so a screen's
  flow reaches what its children request: by an import (`<script setup>`, the
  Options API's `components`), by `app.component('Name', X)` for every
  template, in kebab-case as Vue resolves it, through `<component :is>`,
  `memo`, `forwardRef` and `lazy`, and in Nuxt by the path of a file of every
  part's components directories - `prefix`, `pathPrefix: false`, `Lazy`,
  `.client`/`.server`, the higher layer's where two give a name - and of what
  a module adds (`addComponentsDir`, `addComponent`). A PascalCase tag that
  names nothing is `component-unresolved`. A Nuxt page goes through its route
  middleware - the global ones in Nuxt's order, then those
  `definePageMeta({ middleware })` names, a module's `addRouteMiddleware` among
  them - and its layout (`definePageMeta({ layout })`, `default`,
  `<NuxtLayout name>`), each a `calls` edge with its `meta.order`; a name no
  file gives is `route-middleware-unresolved` or `layout-unresolved`. A module's
  `addServerScanDir` is read as `server/` (routes, middleware, `utils/`); a
  condition of a module's options is decided where its `modules` entry, its
  `configKey` setting and its `defaults` are literals, and a call it rules out
  is not read and is said; a workspace module whose manifest names only
  `dist/` is read from its source map, a `source` condition or the file of
  `src/` in its place. The coverage harness counts a layer `extends` writes as
  `fileURLToPath(new URL(...))` or `resolve(__dirname, ...)`, and a folded row
  keeps every other file its sites are in (`meta.causes[].files`), which the
  read gate reads. New fixtures `nuxt-components` and `vue-components`.

- **Values shared through parameters of the account, an app's own stacks,
  parameter files, and imports whose kind the use does not say (P253).** A
  parameter one deployment writes (`AWS::SSM::Parameter`, CDK
  `StringParameter`, Terraform `aws_ssm_parameter`) is joined by its name to
  every place another reads it (`{{resolve:ssm:...}}`, a template parameter
  typed `AWS::SSM::Parameter::Value`, `${ssm:...}`,
  `StringParameter.valueForStringParameter` / `valueFromLookup` /
  `fromStringParameterName(...).stringValue`, Terraform's
  `data "aws_ssm_parameter"`), under the `parameter:` key Terraform's shared
  roots use; one nobody configured writes is an `export-not-found` row naming
  it. A CDK app's `Fn.importValue` of its own export, `Stack.exportValue` and a
  parameter it writes and reads are the value itself. A template's parameter
  file is read where `services[].infra.vars` or its `samconfig`
  (`parameter_overrides = "file://..."`) names it, or one sits beside it under
  its name; two beside it are a new `parameter-file-ambiguous` row. A mapping
  or a destination whose import does not say what it is is read once per kind
  it may be, and the linker keeps the reading the publisher's value is; an
  address built around an imported name names the imported thing. A value
  published under a generated name is joined to the producer's own channel,
  named by its repository. A Serverless service hangs its routes on a shared
  REST API from `restApiRootResourceId` where it names one. New fixture
  `multi-repo-parameters`.
- **What an RPC or GraphQL caller is compared with, everywhere it calls from
  (P256).** A plain request to an oRPC procedure's REST route is compared both
  ways: its path parameters, the query of a `GET` (from the address and from
  the client's query option - axios `params`, ky/got `searchParams`, ofetch
  `query`, Angular `params`, recorded as `meta.queryKeys` / `meta.queryType`)
  or its body, assembled as the OpenAPI handler assembles the input
  (`compact`, or `{ params, query, body }` for `inputStructure: 'detailed'`),
  against the procedure's input, a key in the address by name alone; and its
  own answer type against the procedure's output (its `body` for
  `outputStructure: 'detailed'`). A query nothing reads is
  `procedure-input-by-name` (query). A tree a workspace package holds is read
  as the ways in of the service that mounts it, not of every service that
  imports its `AppRouter` type, so a client typed from it joins the server and
  is compared through it. Fastify's `fastifyTRPCPlugin` (by the `register`
  call it is handed to, its `prefix`) and Hono's `trpcServer` (`endpoint`) are
  described mounts; a description's mount can say `plugin: { method, at }` and
  a dotted `treeKey`. A client built in a provider of a module's `forRoot` /
  `forRootAsync`, here or in another workspace package, is followed to its
  address through the method's one call and the factory's `inject`, and a
  configuring method nothing calls provides nothing. `doctor`'s desync table
  names an rpc request's procedure and protocol (`procedure`, `protocol` in
  `doctor.json`). The procedure adapters state Vite's `resolve.alias`, so a
  lazy branch under `@lib/...` in a server Vite builds is read. The router's
  checks are not drawn on a step it fetches only for a `@requires`, and a
  field using `@requires` that does not carry its required fields' checks is
  `graphql-requires-auth-not-carried` (a finding, auth). New fixtures
  `rpc-shared-types` and `graphql-requires-auth`.

- **Every way a port is decided, read (P254).** A front end's dev and preview
  server says where it listens: `server.port` / `preview.port` in
  `vite.config.*` (SvelteKit, Remix, React Router, Vue, React), `--port` on a
  `vite`, `vite preview`, `svelte-kit dev`, `remix vite:dev` or
  `react-router dev` script, Astro's `server.port`, Angular's `angular.json`
  `serve` port and `ng serve --port` (the Angular repository node now carries
  `meta.listen`); Vite's 5173 / 4173 only where `strictPort` keeps it there.
  A dev server's port is marked `devServer`, and a request to it that its
  service serves no route for is decided as before (its proxy forwards it). A
  port handed to the function that starts the server (`start(3001)`,
  `bootstrap({ port })`), a property of a literal settings object
  (`config.port`), NestJS's `registerAs` / `load` factories and convict's
  schema defaults are read, and a port read from a setting alone
  (`app.listen(process.env.AUDIT_PORT)`) is kept with the setting and filled
  from the service's example environment file. A compose service's `ports`
  are read with both sides and its environment's ports, a `docker run -p` in
  a `package.json` script is a container of the service, and a mapping is
  reconciled with the code: `localhost:3001` and `orders:3000` join the one
  service, `listensAt` saying `published as 3001 by docker-compose.yml` or
  `in the container orders`; a mapping whose container side the code does not
  listen on is the note `published-port-unheard`. Coverage probe
  `dev-server-port`. New fixture `port-sources-joins`.
- **The router's check on a field no resolver of its own answers, and an
  entity interface nobody can type (P252).** A field the router's
  `@authenticated`, `@requiresScopes` or `@policy` guards and no resolver of
  its own answers (`Book.price`, read off what `Query.book` returns) is
  guarded on the entries that do answer it - the resolvers of the fields that
  return its type, followed up through fields with no resolver either, and the
  reference resolvers of an entity call for it - for that field only:
  `meta.for` on the `guarded_by` edge and on the check in `meta.access`,
  `meta.answers` on the plan edge of a request that asks for it, and `flow`
  shows `@authenticated for Book.price` on that step and on no other. A field
  the router does not serve (`@inaccessible`) has no check drawn and is not
  named by `graphql-auth-not-checked`. An entity interface whose owning
  subgraph writes no `__resolveReference`, no `__resolveType` and no
  `__isTypeOf` on one of its types is `graphql-entity-type-unsaid` (a finding,
  wiring), and the plan edges of an entity call into it say `hop.untyped`; a
  subgraph's endpoint carries the types its code says the type of
  (`meta.graphql.subgraph.typeResolvers`), and a NestJS schema-first
  `@ResolveField() __resolveType` is no longer read as a field.
  `@requires`, `@provides` and `@external` were already planned (P241). New
  fixture `graphql-federation-gaps`.
- **A request to a port on this machine joins the service listening there
  (P250).** The port a server is started on is read for every server the tool
  reads - `<server>.listen(port)` for express, koa, fastify, NestJS and Node's
  own server, Hono's `serve({ fetch, port })`, `Bun.serve`, `Deno.serve` and
  `export default { port, fetch }`, GraphQL's standalone server, Nuxt's
  `devServer.port`, and `--port` / `-p` on a `next`, `nuxi` or `nitro` script -
  and kept on the service's repository node (`meta.listen`). A request to
  `localhost`, `127.0.0.1`, `0.0.0.0` or `[::1]` at that port, from a browser,
  a server, a procedure client or a gateway naming a subgraph, joins it
  `via: host` with `meta.listensAt` on the edge: `static` where the code writes
  the port as a number, `heuristic` where it is a setting's fallback, a
  library's default or a setting file's value. A host the configuration names
  still decides; two services on one port is the new row `local-port-shared`
  naming each and where it listens, and the third-party node a reader drew for
  the host goes. A hook written on one call (`useFetch(url, { onRequest })`,
  `$fetch(url, { onRequest })`, a ky call's `hooks.beforeRequest`) is read for
  that call only (`baseFrom: "call-hook"`), and a ky hook answering
  `new Request(request.url.replace(location.origin, X), request)` or
  `new Request(new URL(url.pathname, X), request)` is read as a new origin in
  front of the old path. The coverage counting rule gains the family `listens`
  (`fixtures/listen-port-joins`).

- **Lambdas declared in a plain CloudFormation template (P248).** A template
  with no SAM transform - any `.yaml`, `.yml`, `.json` or `.template` file
  that says it is one (an `AWSTemplateFormatVersion`, or `Resources` of `AWS::`
  types), wherever the repository keeps it - is read by the SAM reader's code
  as a reader of its own, `cloudformation`: functions with their code in a
  local `Code` directory, mappings from queues and streams, URLs, permissions,
  APIs written as `AWS::ApiGateway` and `AWS::ApiGatewayV2` resources or as an
  OpenAPI `Body` / `BodyS3Location`, rules, schedules, subscriptions, bucket
  notifications and state machines from a `DefinitionS3Location` file. The
  deployment of `terraform-orders` written as two such stacks reads as the
  same graph as the other four formats (`fixtures/cloudformation-orders`).
  Not read as templates of their own: a template another nests, the copy
  `aws cloudformation package` or `sam package` writes of one, a file a
  Serverless service loads into its `resources`, and a `cdk.out` beside the
  `cdk.json` of an app the CDK reader reads. A template is deployed with the
  `samconfig.toml` that names it, else `services[].infra.options`.
- **`Fn::ImportValue` across the stacks of one repository (P248).** An
  output's `Export.Name` in one template, SAM or plain, is what
  `Fn::ImportValue` of that name is in another, settled however the templates
  are ordered; one no template exports, or two do, is the row it was and says
  which (`fixtures/cloudformation-shapes`).
- **An HTTP API made in one resource (P248).** `AWS::ApiGatewayV2::Api` with
  `Target` is a route - `$default`, or its `RouteKey` - onto that function, in
  a SAM template and a plain one. An `AWS::Lambda::Permission` for a principal
  no reader follows is an `invoker-not-read` note, as Terraform's is; a REST
  method's `ApiKeyRequired` and an HTTP route's `AuthorizationType` are guards;
  an API written as resources records the one stage it is deployed to.
- **A procedure call's input and answer are compared with the procedure's
  (P247).** A call through an oRPC or tRPC client, in a browser, an Angular
  application or a server, records the type of the input it hands (the type
  the client declares for the argument, or the argument's own where the client
  is `any`) and, where the call returns the answer, the type it reads back;
  the joined edge carries both as a request's carries its body. `contracts`
  compares them with the procedure's input (the schema's input side) and its
  output or resolver's return, by the rules and at the severities a request
  body and a response are compared by. What cannot be compared is a row:
  `procedure-input-undeclared`, `procedure-input-unread` (the schema's library
  is not installed), `procedure-input-not-at-call` (an input handed later or not
  written), `procedure-output-inferred` (an answer handed to a hook or a query's
  options), `no-type-on-sender` / `no-type-on-receiver` for a client typed
  `any`. oRPC's `mutationOptions(…)` is now read as options, its input handed
  later. tRPC mounts say where they serve the tree - the path of the `use` call
  `createExpressMiddleware` is handed to, `fetchRequestHandler`'s `endpoint`,
  the standalone server's `basePath`, a Next.js handler's file - into
  `meta.mounted` (protocol `trpc`), so a tRPC link sent elsewhere is
  `procedure-link-unserved`; the mount description gains `prefixKey`,
  `prefixDefault`, `handedTo` and `fileRoute`. A class member injected by a
  token (`@Inject(TOKEN)`, Angular's `inject(TOKEN)`) is followed to the client
  the repository's one `{ provide: TOKEN, useFactory | useValue }` builds, and
  the `call-through-token` row at such a call goes. The Angular reader runs the
  shared procedure reader. A server's request rooted at a setting nothing
  places keeps the values it was found with, so `doctor`'s *Probably missing*
  counts the hosts they name. New fixture `rpc-contracts`.
- **Values shared between CloudFormation deployments, and
  `serverless-compose.yml` (P249).** An output a Serverless service, a SAM
  template or a CDK app publishes - by its `Export.Name` / `exportName`, and by
  its stack's name and its own - is joined to every place another repository
  reads it (`Fn::ImportValue`, `!ImportValue`, `Fn.importValue`,
  `${cf:<stack>.<output>}`). Routes on an API another repository creates
  (`provider.apiGateway.restApiId`, `provider.httpApi.id`,
  `RestApi.fromRestApiAttributes`, `HttpApi.fromHttpApiAttributes`, an
  `AWS::ApiGateway::Resource` whose `ParentId` or an `AWS::ApiGatewayV2::Route`
  whose `ApiId` is imported) hang from the point the publisher exports, get its
  full path, and are routes of the publishing service too, so a client of that
  API - by `baseUrlEnv`, by host, or by an imported API address in its
  environment - lands on the handler in the repository that holds it. A queue,
  a topic, a bus or a table's stream an event, a CDK lookup or a value of the
  environment imports is renamed, before the repositories are merged, to what
  the publisher names, so the two are one channel. The framework's own
  `ServiceEndpoint`, `HttpApiId` and `HttpApiUrl` outputs are published. A
  `serverless-compose.yml` is read as one deployment: its services with its
  `params` ahead of their own, a `${<service>.<Output>}` param the import of
  that service's output, and a service it cannot read a
  `compose-service-unread` row. Four new reasons: `export-not-found`,
  `export-ambiguous`, `export-mismatched`, `compose-service-unread`.
  `serverless-shapes`, `sam-shapes` and `cdk-shapes` now draw what they import
  under its stand-in, with an `export-not-found` row where they drew a
  `subscription-source-unread` one (`fixtures/multi-repo-exports`,
  `fixtures/serverless-compose`).
- **What Nuxt and its layers still decide at build time, read (P251).** A
  Nuxt module of the repository - a file of `modules/`, a path a part's
  `modules` lists, a package of the workspace by its name - is read as syntax
  for what it adds when the application builds: `addImportsDir`,
  `addServerImportsDir`, `addImports` and `addServerImports` give names used
  with no import, `addServerHandler` serves a route declared at the call (or
  stands in front of every route), `extendPages` adds a screen,
  `nuxt.options.alias[...]` an alias, `installModule` another module, each
  where its argument is a literal or a path built from the module's own file.
  An addition written as code is the row `framework-module-unread`; which
  modules were read is the note `framework-module-read`; a module installed
  from a registry is named in the note `framework-module-installed`, with what
  a few popular ones add. `dir.pages`, `dir.layouts`, `dir.middleware`,
  `dir.shared` and `dir.modules` are read in the application and in each
  layer. Every configuration is read for the production build, `$production`
  and `$env.production` laid over the rest, and how development and each
  `$env` name differ is the note `framework-environment-differs`. SvelteKit's
  routes and pages are read under `kit.files.routes`. The coverage harness's
  extent counts a layer or module a Nuxt configuration names beside the
  application, read from the configuration as text; the read gate reads every
  site a folded row's samples name; a new probe counts a route a module adds
  (`fixtures/nuxt-modules`, `fixtures/sveltekit-routes-dir`).
- **A function run before every request carries its base into each one
  (P244).** An axios request interceptor (`api.interceptors.request.use`, on an
  instance or on `axios` itself) that writes `config.baseURL`, answers
  `{ ...config, baseURL }`, calls `Object.assign(config, { baseURL })` or
  rewrites `config.url = base + config.url`; an ofetch or `$fetch` `onRequest`
  hook writing `options.baseURL` or `ctx.request`; and a ky
  `hooks.beforeRequest` answering a new `Request` at a prefixed address are
  read where they are written, and every request through that instance is
  recorded under the base, `baseFrom: "interceptor"`. A base set outright wins
  over the call's own option; `??=`, `||=` and `if (!config.baseURL)` set it
  only where none is set. A base chosen by a branch, a rewrite behind any other
  condition, one that cannot be read and two that disagree are
  `api-client-base-unread` at the line, and the requests keep the base the
  instance is made with. axios handed one config object (`api({ url, method,
  data })`, `axios({ ... })`, `request({ ... })`) is read too. A server's
  request with a literal host joins the service the configuration says is
  reached there (its name, an alias, `services[].hosts`, a name only the
  project's network resolves), `static`, `via: host`, and the third-party node
  for that host goes; a host only setting files name joins `heuristic`. The
  coverage counting rule has two new families, `requests` (held to strength 1
  by the read gate) and `bases` (client instances and request interceptors),
  and the condition and prefix readers Angular's interceptor base used moved to
  the core so both front-end readers share them
  (`fixtures/client-interceptor-base`).
- **A server's own oRPC or tRPC client joins the procedure it calls (P242).** A
  NestJS, Express, Hono or plain Node service, or a worker, that builds an oRPC
  client (`createORPCClient(new RPCLink({ url }))`, `OpenAPILink`) or a tRPC
  client (`createTRPCClient`, `createTRPCProxyClient`, the untyped
  `createTRPCUntypedClient` whose path is text) and calls a procedure through
  it gets an `http_out` of kind `rpc`, joined to the procedure of the service
  its link's address names by the address reading every request between
  services gets: a setting's claimant, the values it is given (`heuristic`,
  with `base-url-from-files`), the hosts services are reached at, a third
  party. A client kept on a class member, set in place or in the constructor,
  is read. The browser reader and the server's pass share one description and
  one reader (now in the entry adapters), so tRPC's `links: [...]` chains are
  read in a browser too: the last link sends, `splitLink` sends where its
  branches agree, and a hook proxy handed no link sends where the repository's
  chains all send. New row `procedure-link-socket` for a request sent over a
  `wsLink`; a link whose address cannot be read stays `procedure-link-dynamic`.
- **Nuxt layers read as part of the application (P243).** Each local layer -
  a directory of `layers/`, an `extends` entry written as a path in the
  repository or its workspace (`'../ui-layer'`, `['./theme', { meta }]`), or a
  package of the workspace by its name - and the layers it extends in turn,
  cycle-safe, is read under the application's version: its `pages/` are
  screens, its `server/api` and `server/routes` routes, its `composables/`,
  `utils/`, `stores/`, `imports.dirs` and `shared/` the names the application
  uses unimported, its `alias` entries the application's, and `#layers/<name>`
  a directory of `layers/`. A layer beside the application is part of the
  service, as a workspace package it declares is, so a click in the
  application reaching a layer's composable reaches the route the layer serves.
  A page, route or name two parts give follows Nuxt's order (the application,
  `layers/` from Z to A, then `extends` in order) and the lower one is a note,
  `framework-layer-overridden` or `implicit-import-overridden`; which layers
  were read is the note `framework-layer-read`. An import a layer writes with
  `~` or `@` for a file only the layer has is the row `framework-layer-alias`,
  since Nuxt resolves both against the application. `framework-layer-unread`
  now says why a layer is not read (`meta.why`: `remote`, `dynamic`,
  `installed`, `not-installed`, `missing`, `outside`).
- **Lambdas declared in an AWS SAM template (P246).** A `template.yaml`
  (`.yml`, `.json`) written for the SAM transform is read into the functions,
  routes, subscribers, streams and workflows the Terraform, Serverless
  Framework and CDK readers give - one deployment written all four ways reads
  as one graph (`fixtures/sam-orders`). It is read with what `samconfig.toml`
  gives it (the environment `services[].infra.options.config_env` names; any
  other option is a parameter's value): parameters, conditions, `Fn::If`,
  `Fn::FindInMap`, `Fn::ForEach` and `Globals` are settled before anything is
  read, and what they leave unsettled is a row that names it. Every event type
  a function or a state machine has is read or said; APIs are read from their
  events, their OpenAPI bodies (in place, included, or a file), and
  `AWS::ApiGatewayV2` and `AWS::ApiGateway` resources; state machines from a
  `Definition` or a `DefinitionUri` file with its substitutions; a nested
  application of the repository is read under the parameters it is handed, its
  outputs answering the parent. The CloudFormation the Serverless Framework's
  `resources` is read as now also reads `AWS::Scheduler::Schedule`,
  `AWS::Lambda::EventInvokeConfig`, `AWS::Lambda::Url` and a user pool's
  `LambdaConfig`, and a function URL handed to code (`!GetAtt ...Url.FunctionUrl`)
  names its function in both readers, so a `fetch` of it joins (P54). New rows:
  `nested-deployment-unread`, and `layer-not-followed` (a note). A coverage
  probe counts the functions a template declares (`sam-function-resource`).
  `deployment-unread` now names SST and Architect.

- **Federation's entity interfaces, `@interfaceObject` and the router's own
  directives (P245).** An entity interface and the `@interfaceObject` that adds
  fields to it are composed - from the subgraphs or from a supergraph
  (`isInterfaceObject`, `@join__implements`) - so a field it adds is planned
  into that subgraph as the interface's, after its reference resolver, and a
  fragment on a concrete type it cannot tell is an entity hop to the
  interface's owner. An argument `@fromContext` fills plans the fields it
  needs from the nearest type above that sets the `@context`, and is left out
  of the composed schema; where nothing above sets it, the new
  `graphql-context-not-reached` says so. The router's `@authenticated`,
  `@requiresScopes` and `@policy` are `guard` nodes of the router in front of
  the subgraph entries that resolve the field (`guarded_by`, `meta.access`,
  shown by `flow` on a step through that router only), and an Apollo Gateway
  that composes them unchecked is the new `graphql-auth-not-checked`.
  `@composeDirective` is read, with a conflict for a directive never defined
  or taken from two specifications. A gateway's `http://localhost:4001/graphql`
  joins the service whose server listens on 4001 (`startStandaloneServer`'s
  `listen`, `app.listen(...)`, a setting's fallback), `static`; two services
  on one port is a row. Plan edges now carry `meta.through` (the gateway), and
  subgraph endpoints `meta.graphql.listen`.
- **GraphQL federation, one graph across subgraphs (P241).** A request to a
  federation gateway is planned the way the router plans it, statically: each
  selected field goes to the subgraph that resolves it, and a field of an
  entity another subgraph owns is an entity hop to that subgraph's reference
  resolver (`__resolveReference`, `@ResolveReference()`, now entries). The
  composition is read from a supergraph file (`@join__type`, `@join__field`)
  or composed from the subgraphs `IntrospectAndCompose` or `serviceList`
  names, by their federation directives (`@key`, `@external`, `@requires`,
  `@provides`, `@shareable`, `@override`, `@inaccessible`, federation 1's
  `extend type`). An Apollo Router is declared by its supergraph or rover's
  `supergraph.yaml`, with `router.yaml` read beside it. Subgraph addresses are
  joined to services as requests are, never by name. A shareable field the
  router chooses at run time is drawn to each owner, `heuristic`. `contracts`
  compares a selection through the gateway with the composed schema
  (`graphql-field-unknown`, the new `graphql-field-inaccessible`); new rows
  `graphql-subgraph-not-joined`, `graphql-composition-conflict`,
  `graphql-supergraph-drift`, `graphql-shareable-choice`; and
  `graphql-federation-not-read` now says what could not be read: managed
  federation, a supergraph built at start or not committed, a registry schema,
  a subgraph no gateway names.
- **Lambdas declared with the Serverless Framework or the AWS CDK (P57).** A
  `serverless.yml` (`.yaml`, `.json`, `.ts`, `.js`) and a CDK app in TypeScript
  are read into the functions, routes, subscribers, streams and workflows the
  Terraform reader gives, through the same `DeploymentReader` shape, so the
  linker, `flow`, `impact`, `dead` and the page read them unchanged; one
  deployment written all three ways reads as one graph
  (`scripts/deployments-agree.mjs`). The framework's variables (`self`, `opt`,
  `sls`, `env` with `.env`, `file()`, `param`, `aws:region`) are resolved where
  the files settle them, `resources.Resources` is read as CloudFormation with
  its intrinsic functions, and the step-functions plugin's state machines are
  workflows. The CDK app is followed from the entry `cdk.json` names - its
  constructs, helpers, loops over settled lists and settled conditions -
  without being run or installed, and a chain of states is written out as the
  States Language. A queue or a function the platform names when it is
  deployed is named by its declaration (`generatedName`), so what points at it
  in the same deployment joins. `services[].infra.options` gives what a
  command line would (`stage`, a context value). New rows:
  `deployed-name-generated`, `construct-conditional` and `construct-unreached`
  (notes), `construct-repeated-unread`, `deployment-app-unread` and
  `deployment-plugin-unread`. `deployment-unread` now names only AWS SAM.
- **`flowatlas path <from> <to>` (P229).** How one node reaches another, by
  the shortest ways: directed along the edges `flow` walks, or `--undirected`
  for "are these joined at all". It looks 6, then 12, then 24 steps unless
  `--depth` says, prints every node on a shortest path once as a tree, and
  says when nothing was found how far it looked and whether the other way
  round holds. Exit 1 when there is no path. The search is the page's path
  finder's, moved into core (`shortestWays`), so the page and the command find
  the same paths.
- **`flowatlas explain <name>` (P229).** Everything the graph knows about one
  name, printed as the graph server's `describe_for_prompt` writes it,
  character for character; `--scope`, `--max-steps`, `--max-chars`,
  `--with-spec`, `--format json` for the tool's whole answer.
- **GraphQL, both halves (P232).** A field a resolver answers is an entry of
  the new kind `graphql` (`Query.orders`, `Order.customer`), read from NestJS
  and type-graphql resolvers, code-first and schema-first, from resolver maps
  handed to Apollo Server, graphql-yoga or mercurius, and from the schema. A
  client's operation - Apollo Client, urql, graphql-request, apollo-angular,
  `fetch` - joins the endpoint by its address and then each field it selects,
  nested field resolvers included, with the request's confidence, at the line
  of the selection. `contracts` checks selections against the schema
  (`graphql-field-unknown`, `graphql-arg-unknown`, `graphql-arg-required`),
  `dead` lists root fields nothing selects, and a service can be declared by its
  SDL or an introspection result (`document.kind: "graphql"`). A federated
  subgraph is said, not joined across. The language is read by a parser of the
  tool's own (`@flowatlas/graphql`), so nothing is installed. Schema version 7.
- **oRPC procedures and their callers (P58).** An oRPC router - a plain
  object, `os.router(…)` with the guards and prefix its chain installs, a
  `lazy(() => import(…))` branch, or a contract-first `implement(contract)` -
  is read by the tRPC walk as one `rpc` entry per procedure, keyed by its path,
  with its input and output schemas, its guards, the failures `.errors(…)`
  declares (`meta.errors`) and where it is mounted (`meta.mounted`). Under an
  `OpenAPIHandler` each procedure is also a REST route at the `handle` prefix
  plus its `.route(…)`, which REST callers join. `client.orders.list(input)`,
  `orpc.orders.list.queryOptions(…)`, `createRouterClient(router)` and
  `call(procedure, input)` are requests joined by path in the service the
  link's URL names (`via: link-url`), or by declaration in process. `fails`
  reads `ORPCError`, `errors.X()`, `TRPCError` and an input's 400. New rows
  `procedure-link-dynamic`, `procedure-link-unserved`, `procedure-prefix-unread`,
  `procedure-contract-unread`; a `procedure-handler` coverage probe. The
  description `adapters.entry.procedures` gains `plainTrees`, `implementedBy`,
  `lazyBy`, `outputMethod`, `errorsMethod`, `routeMethod`, `prefixMethod`, and
  mounts `constructed`, `routes`, `prefixFrom`, `protocol`.
- **Vue, Nuxt and Svelte (P233).** The three frameworks `init` used to name
  and leave out are read. A `.vue` or `.svelte` component's scripts are read by
  the checker as TypeScript, every position naming the component file at its
  own line; its markup's event bindings are clicks that reach the script's
  functions, the Options API's methods and Pinia or Vuex actions; Vue Router's
  routes, lazy ones included, and Nuxt's and SvelteKit's pages make components
  screens; `$fetch`, `ofetch` and `useFetch` are requests. Nuxt's Nitro server
  is a row of the file-system routers, its verbs from file names, its request
  read off h3's helpers whether imported or global, `throw createError` a
  failure, and a Nuxt application is both halves of one service. New types
  `vue`, `svelte` and `nuxt`; nothing needs to be installed. Astro and Solid
  are now the frameworks `init` names as unread.
- **Aliases and imports a framework generates, read without its build
  (P240).** A fresh clone has no `.nuxt/` or `.svelte-kit/`, so Nuxt's `~`,
  `@`, `~~`, `@@`, `#shared` and SvelteKit's `$lib` resolved to nothing and
  every call through them was lost. They are now read as each framework
  documents them - Nuxt 3's root and Nuxt 4's `app/`, `srcDir`, `alias`,
  `kit.files.lib` and `kit.alias` where written as literals - and the
  generated tsconfig, where it is there, wins. Names Nuxt imports for a file
  that does not import them (`composables/`, `utils/`, `stores/`,
  `imports.dirs`, `server/utils/`, Nuxt 4's `shared/utils`) are read as
  imports of their files, a template's handler included, and `#imports` is a
  module of them. Nuxt 4's pages are read under `app/pages`. A solution
  tsconfig lends the aliases of the projects it refers to, and Vite's
  `resolve.alias` is read for any alias no tsconfig names. Each is said once
  per repository as a note (`aliases-from-convention`, `aliases-from-config`,
  `implicit-imports-from-convention`); a name two files give, a Nuxt layer and
  a setting written as code are rows.
- **A request through a client instance carries its base (P239).** The base an
  instance is made with - `axios.create({ baseURL })`, `ofetch.create` or
  `$fetch.create`, `ky.create({ prefixUrl })` or `ky.extend`, or
  `api.defaults.baseURL = …` set afterwards - is read where it is written and
  put in front of the address each call writes, so the request joins the
  service at that base `static` instead of by its route alone, in React,
  Next.js client code, Vue, Nuxt and Svelte. The instance is followed through
  imports, default exports, object keys, class fields and factories of your
  own, and is recognised by its import with nothing installed; ky is a client
  now, and ofetch and axios instances are read when called as functions. An
  Angular interceptor writing `req.clone({ url: base + req.url })` puts its
  base in front of every request of the framework's client. A browser request
  whose address names a host a configured service is reached at (its name, an
  alias, `services[].hosts`) joins it `via: "host"`. A base nobody can read is
  the new row `api-client-base-unread`, and the request keeps today's join. On
  `fixtures/vue-spa` the two requests through its instance now join `static`.
- **Does it help an assistant, measured (P238).** `scripts/bench-agent/`
  generates an eight-repository TypeScript project from a seed, with traps and
  an answer key written from the generator's own model, asks Claude Code 30
  fixed questions about it in four arms (one repository or all of them, with
  the graph or without), and marks the answers against the key. A pilot of 32
  sessions estimates a full run, which starts only after it; a run stopped by a
  usage limit resumes. The expectations are committed before any run and the
  report (`docs/benchmark.md`) checks every one, and lists each question where
  the graph did worse. `run.mjs --dry` - the generator, the key, the scorers and
  the graph held to the key, with no assistant - is part of `pnpm check`.
- **What assistants asked, kept on this machine (P235).** With `"log":
  { "questions": true }` or `FLOWATLAS_LOG_QUESTIONS=1`, every MCP tool call and
  every `flow`, `impact`, `channel`, `path` and `explain` adds a line to
  `<output>/questions.jsonl`: the ids asked about, whether they resolved, how
  big the answer was and what cut it, and the gaps on it. Off by default; ids
  and counts, not prompts; nothing is sent anywhere. `flowatlas stats
  --questions [--since 7d]` summarises it by tool, with the names that matched
  nothing and the gaps the most questions ran into, and `doctor --unresolved`
  puts the causes asked about first.
- **The graph in open formats, and JSON Schemas (P237).** `flowatlas export
  dot | graphml | cypher | csv` writes the graph for Graphviz, Gephi and yEd,
  Neo4j and Memgraph, or any loader, at the service, class or node level, from
  every node or only what some ways in reach, walked as deep as `flow` walks
  them (`--depth`, `--max-nodes`) with the nodes either bound left out counted;
  every edge carries how sure the graph is. `schema/` holds JSON Schemas of `project-graph.json`, a service's
  `graph.json`, `diff.json`, `docs.json` and `freshness.json`, generated from
  the readers' own schemas and checked by the gates; `docs/formats.md` lists
  every file the tool writes.
- **Pages and comments that say why (P234).** A page that names a node in
  code is linked to it with no block written: `docs` on `get_flow`,
  `describe_for_prompt` and `impact` lists it (`kind: "mention"`, with the
  heading above), and the page's "Described in" too. A name that is clearly
  the graph's and names nothing - a renamed route, a removed method - is
  counted by `flowatlas docs`, and `--check --mentions` fails on it. A
  comment above a declaration tagged `WHY:`, `NOTE:`, `DECISION:`, `HACK:` or
  `SEE:` is kept on the node and written under **Why** by `explain` and
  `describe_for_prompt`. Exact names only; prose is never read. `docs.json`
  is format 2.
- **One graph for the team (P236).** `flowatlas publish` writes the graph just
  built as one checked bundle, never source; `flowatlas pull` fetches it from a
  CI artifact (`gh:owner/repo/name`), an `https://` address or a file, checks
  every file and the schema, and installs it, a conditional request when
  nothing is new. With a `remote` in the configuration, a repository not
  checked out is allowed, and every question reads the pulled graph and says
  so. `build --on-pulled` reads what is checked out and takes the rest from
  the team's; `diff --pulled` compares a branch with main as CI built it. The
  action's `publish: true` uploads the bundle, and `mcp.pull: on-start` pulls
  when the server starts. A token is never sent to another origin nor down to
  plain http, and `gh:` takes only an artifact from a successful push to the
  default branch, never one a fork's pull request made.
- **A GitHub Action, and `diff --format comment` (P231).** The action in
  `action/` fetches the other repositories a configuration names, caches the
  base graphs under the base commit, and keeps one pull request comment up to
  date: three lines first (what the change reaches, its new breaks and stale
  docs, the verdict), the report under them, found again by a marker that
  names the configuration and written by the action's own token, never a
  comment somebody else pasted the marker into. A fork's pull request gets the
  job summary. It can fail the check on new breaks, and on doc blocks the
  branch makes stale with `fail-on: stale-docs`, and upload SARIF. Its docs
  check reads the branch's graph that `diff --head-db` keeps, and the tokens
  it clones with never reach a clone's `.git/config`. `flowatlas diff --format
  comment` writes the same comment for any workflow, with its figures in
  `diff-comment.json`.
- **`flowatlas report` (P228).** The page a person reads first, from the
  graph: each service and what it is, what crosses between them (drawn as a
  Mermaid flowchart), what most of the project depends on by reach, what is
  worth a second look (a single thread between two services, a store two
  services write, a best guess on a busy path), what was not read by cause,
  the checks with the command for each, and questions to ask. `--output .`
  writes ARCHITECTURE.md. An `overview` doc block keeps a committed one true:
  `docs --check` fails when the structure changed, not when a count moved. The
  graph server serves it as `flowatlas://overview`, and `doctor` notes a store
  two services write (`store-shared`).
- **`flowatlas agents install | status | remove` (P227).** Tells each
  assistant when to ask the graph rather than search the files: a Claude Code
  skill and a Cursor rule by default, a marked block in `AGENTS.md`,
  `CLAUDE.md` and Copilot's instructions with `--instructions`. One list of
  questions behind them all, which the graph server's instructions now name
  too. `--hook` adds a Claude Code hook that, after a search naming a route,
  channel or handler another repository calls, publishes or handles, says
  which and the call that lists them; it never refuses a search and is silent
  otherwise. `build` writes the `names.json` it reads. `init --agents`.
- **Answers say when the code moved since the build (P230).** Every build
  writes `freshness.json`: each service's checkout and every file it read. An
  answer citing a file that changed since says so, `stale` on the graph
  server's answers and the commands' JSON and one line on stderr; a `touch` is
  not a change. `start_here` says `moved` and `doctor` an info row
  (`checkout-moved`) for a checkout on another commit or branch.
- **One build at a time (P230).** A build holds `<output>/build.lock`, put in
  place whole, so of builds started at the same moment only one takes it; a
  second says which one is running and exits 2, or waits with
  `--wait <seconds>`, and a lock a crashed build left is taken over by one
  build only. `build --background` returns at once and coalesces requests into
  one more build.
- **`flowatlas hook install | status | remove` (P230).** Git hooks that rebuild
  in the background after a checkout, a merge or a rebase, written as a marked
  block beside what a hook already holds; a repository whose hooks another tool
  keeps gets the line to add instead. `init --git-hooks` installs them.
- **`mcp.rebuild: "on-change"` (P230).** The graph server starts a background
  build when an answer finds its files changed. Off by default.
- **`get_flow` takes `to` (P229).** The flow cut down to the shortest ways to
  a node, from a way in or from any node, with `searched` and `reverse` when
  there is none. No new tool: the list grew by one clause.

### Changed

- **Less said on every turn, and a guide that saves turns (P366).** The
  graph server's instructions, which a client sends again with every
  request, are about 2,100 characters instead of 6,400: the tool to begin
  with, the id chains, the inputs every tool shares and which tools are
  listed when, with what one tool's answer needs moved into that tool's
  description. The tool list gives the shared inputs (`detail`, `maxNodes`,
  `offset`, `service`) by type alone, their meaning said once in the
  instructions, and drops the `$schema` header on each input schema: about
  10,100 characters of names, descriptions and inputs for all 26
  tools instead of 12,200, every call still checked against the full bounds.
  `flowatlas agents install` writes a shorter block into `AGENTS.md`,
  `CLAUDE.md` and Copilot's file (about 1,100 characters instead of 2,000:
  the services, the questions in a few words and where the full guide is),
  and the block and the guide now say to load the core tools in one
  ToolSearch call (the `select:` line written out under the name the server
  is registered as in `.mcp.json`), to take an answer that says
  `complete: true` as the whole answer, to pass several ids in one call and
  send independent calls together, and to ask `verbose: true` only when a
  field is missing. The search hook's note names the call and no longer the
  terminal command.
- **The graph server's answers are compact by default, and `verbose: true`
  answers as before (P365).** An assistant pays for every character of an
  answer on every later turn, and most of a row said again what its `id`
  already says. Every answer now passes, once, where answers are serialised,
  through one compaction whatever tool wrote it. On a row with an `id` (or a
  gap's `gapId`): `type` goes when the id starts with it (and `method` on a
  symbol whose id ends `Class.member`), `service` when the id names it, `label`
  when it is the id's tail as written or said aloud (`GET /orders` beside its
  way in's id), `kind` when a way in's id says it, the file of `loc` when the id
  holds it (`loc` becomes `line`, or goes when the id holds the line too), and
  any other field that is a part of the id, the tail of an id its `meta` says
  in full (`selectedIn` beside `meta.selectedBy`) or the id of the row it is
  under; a `meta` key goes when it repeats the row's own field, a part of its
  id or a word of its label. Below the answer's own fields, null, `false` and
  empty fields go; `next` keeps at most two calls, or the paging call alone
  when the list was cut. A field it does not know is kept, and `detail` means
  what it did. Every tool takes `verbose` (default `false`) for the whole
  answer; `get_source` and the Markdown of `describe_for_prompt` are never
  compacted, and the page, the exported graph and the reports are unchanged.
  The `outputSchema` each tool lists now requires no field, and a row that may
  say `loc` may say `line`. On seven fixtures' graphs the answers of the tools
  an agent calls most are 0.74 of their whole size in all, from 0.54
  (`list_entries`) to 0.87 (`dead`); what is left is ids, edges and `next`
  (docs/mcp.md, *Answers*).
  `flowatlas explain --format json` prints the compact answer on one line, and
  `--verbose` the whole one as before. The MCP snapshots are asked
  `verbose: true` and did not move; `expected.mcp.compact` beside three
  fixtures holds the compact answers.

- **A route on an application the framework's own maker made is as sure as
  a typed one (P346).** With nothing installed, a call or `new` of a
  dialect's maker imported or required from the package itself
  (`express()`, `Router()`, `new Koa()`, `Fastify()`, `new Hono()`), through
  a chain that answers with the application, held by a `const` or a `let`
  nothing assigns again, is the value rather than an account of it, so its
  routes and the joins on them are no longer `heuristic`. An annotation, a
  destructured member, a class of the repository, a function's answer, a
  parameter and a property stay `heuristic`, and so does a route placed
  through a mount written on one (`express-not-installed` and the fixtures
  whose uninstalled Express services make their applications directly lose
  the ceiling; `express-maker-direct-and-stated` shows both kinds).
- **A plain request to a procedure's REST route is told where its answer's
  type comes from (P252).** `contracts` said every caller of an oRPC or tRPC
  procedure gets an answer "inferred from the server's own tree", which is
  true of a client typed from the router and not of a `fetch`: a plain
  request that types the answer itself keeps `procedure-output-inferred` with
  a message naming its own type, which nothing ties to the tree, and one that
  types nothing is `no-type-on-receiver`, as any request is
  (`orpc-next`, `orpc-contract` snapshots).
- **A lazy oRPC branch the checker cannot resolve is followed by its path
  (P252).** `lazy(() => import('@/routers/reports'))` with no `paths` behind
  the alias is followed into the one file of the service its path names
  (relative, or after `@/`, `~/`, `~~/`, `#`, with a bundler's endings and
  `index`); one that cannot be is `procedure-branch-unread` saying it is a
  lazy branch, and the module it names is no longer read as a root of its
  own, with its procedures at addresses nobody calls.
- **A subgraph whose port is only a setting's fallback joins `heuristic`
  (P250).** P245 joined a gateway's `localhost:<port>` subgraph `static`
  whatever the port was read from; it now follows the rule every request to
  this machine does, so `process.env.PORT ?? 4003` and Apollo's default 4000
  are a guess. A GraphQL endpoint's `meta.graphql.listen` says `default: true`
  for a library's default.

- **SAM templates are found by what they say (P248).** A file naming the SAM
  transform is read wherever it is kept, not only as `template.yaml` or the
  file a `samconfig.toml` names, and a `samconfig.toml` gives its parameters
  only to the template it deploys - the one beside it, or the one its
  `template_file` names from a directory above.
- **A queue, a topic or a bucket Terraform gives no name is named by its
  declaration (P246)**, as the Serverless Framework and CDK readers name one:
  `sqs/${…}@aws_sqs_queue.inbox`, joined by what the configuration points at it
  with, with a `deployed-name-generated` note, where it was a name not read.
- A text built with `Fn::Sub` or `Fn::Join` around a value that is not read
  now says which variable or parameter it waits on.
- **One resolution for names (P229).** The command line's `impact` resolved a
  name its own way, so `impact "POST /orders"` was refused while the
  `impact` tool took it; it now resolves as every tool does, and `--service`
  narrows a name for both. `event:`, `cron:`, `rpc:` and `workflow:` names,
  which only the command line took, are taken by every tool too.
- **`contracts` shows a GraphQL finding with no typed boundary beside it
  (P241).** A project whose only comparisons were GraphQL selections against a
  schema printed "no boundary between services" over its errors; the findings
  table is printed now. A federated subgraph is no longer one
  `graphql-federation-not-read` row each: it is said only when no gateway in
  the project names it.

### Fixed

- **`impact` never walks back along a navigation, from a guard, or across a
  channel into a flood (P372).** A method that navigates to a screen
  (`router.navigate([...])`, `navigateByUrl`, a guard's redirect, a login
  screen sending to the dashboard) is stored as a `calls` edge with
  `meta.navigates`, which the walk read as a call of the screen's component:
  impact on a board's method listed every screen that navigates to the board,
  and on a dashboard's method every screen a guard redirecting to the
  dashboard is listed on. A navigation is never walked back along, however it
  is stored, and what a router or a framework runs before a screen (a guard or
  resolver, `meta.guard`; a route middleware, `meta.middleware`; core's new
  `isRunsBeforeEdge`) is walked back to the screens listing it only when the
  walk reached it through its own code - impact on a method a guard calls
  still lists every screen it guards. A consumer on the way that no screen
  holds (a back end's worker, a bot re-fetching on a relayed event) is no
  longer walked onto its channel to every route publishing there and every
  screen calling those: they call none of the code, so they are counted apart
  in `throughChannels` (`{channel, type?, consumer, ways, sample}`, never
  complete-blocking), and `impact({symbol, channel})` (`flowatlas impact
  --channel <name>`) lists one channel's ways in, each `via: "channel
  <name>"`. Rows' `reach`, `from` and `ways` walk by the same rules, crossing
  a channel only where no way in calls the code, so `ways` no longer counts
  screens reached by navigation or a channel's publishers. On the new
  `impact-guarded-navigation` fixture impact on a list method answers 5 rows
  where it answered 17 (1,437 characters compact from 2,766), the channel's 4
  ways in counted, and on an acknowledge method 3 where it answered 6 (797
  from 1,244); multi-repo's `POST /orders`, reached only through billing's
  `order.created`, moves from `entries` to `throughChannels`, as does
  multi-repo-stepfunctions' `POST /checkouts`, whose event a rule hands to
  the workflow.
- **`impact` lists only the ways in that call the changed code (P371).** A
  screen's subscription to a stream is placed in the screen and no longer
  walked back onto its channel: the routes that publish to it, and every
  screen and bot calling those, were listed as ways in that could break, each
  with the target's route as `via`. A consumer whose handlers run in
  no component a way in shows (a back end's worker, run by the message) is
  still walked onto its channel, with `via: channel <name>`. The hop from a method to its class, and from the class to what
  injects it, is no longer taken from a method whose callers the walk
  follows, so a screen that injects a client for its other methods is not
  listed. A call written at the line a way in is registered at
  (`bot.command('items', (ctx) => this.showItems(ctx))`) is the way in's, not
  the registering method's, which had made a `maybe` row. The same walk gives
  `reach`, `from` and `ways` on rows and `flowatlas impact`'s tree. On the new
  `impact-shared-client` fixture impact on a list method answers 4 rows where
  it answered 13 (959 characters compact, from 2,395), and `complete: true`;
  on an acknowledge method 2 where it answered 10.

- **`flowatlas agents` writes only into the project it was run for (P366).**
  Run in a git repository of its own made below a project's root, `install`
  found that project's configuration and wrote the guide, the blocks and the
  hooks into every one of its repositories. Without `--config`, `install`,
  `status` and `remove` now refuse inside a git repository that is neither
  the project's root, one of its repositories nor one holding them, naming
  the configuration found and how to write into it; from the root or a
  repository of the project, or with `--config`, they run as before.

- **A channel asked for as code writes it answers, and no answer suggests a
  tool the server does not list (P360).** Every MCP tool that takes a channel
  accepts it with or without `channel:` and with a placeholder in any part
  (`tenant:<id>:events`, `{id}`, `${id}`, `${ctx.id}`, `:id`, `[id]`) or a
  value it takes (`tenant:42:events`): the one channel it denotes answers,
  saying which in `channelUsed`, and several are listed with the call that
  takes each. An exact name answers as before. Every answer, prompt and the
  server's instructions leave out a call to a tool the running server hides:
  on a database alone, where `get_source` is not listed, a hint to read a
  step says the file and line to read and that the code is not served from a
  database alone. `start_here`'s `hidden` still says which tools are not
  listed and when they appear.
- **`get_source` and `explain` return a decorated declaration whole.** Where a
  declaration ends is found by counting braces from where it starts, and a
  decorated method's or class's recorded start is its first decorator - one
  that closes the braces of its own options (`@Guard({ roles: ['a'] })`, a
  component's `@Component({ ... })`) on its own lines. The answer stopped
  there, the decorator alone. A decorator's lines are now read as part of the
  declaration rather than the whole of it.
- **A server `Bun.serve` starts reads the files its script makes Bun load,
  and the CDK's version is looked for in the workspace (P348).** Bun's own
  files were taken as development's whatever the script running the server
  said; they are now Bun's order for the mode the command's `BUN_ENV`, else
  `NODE_ENV`, gives - `.env.<mode>.local`, `.env.local` (not for `test`),
  `.env.<mode>`, `.env` - or only the files `--env-file` names (the last
  first, of `a,b` too), none with `--no-env-file`, development's only where
  no script runs it. The CDK's version is looked for up to the outermost
  workspace that declares the repository a member, so a member reads the
  root's lockfile. A `Schedule.cron(...)` naming both a `day` and a
  `weekDay` is left unread, as the CDK refuses it.
- **No look up the directories leaves the repository being read (P334).**
  Looking for an ESLint shareable configuration or plugin under
  `node_modules`, or a Nuxt layer or module by its package name, went on to
  the file system's root as Node does, so a package installed above the
  repository - in the home directory, say - was read into its globals; and a
  configuration's `extends` by a path climbing out was followed. Each now
  stops at the root the service was given, widened to the workspace that
  declares it as a member. A walk given no root - the workspace roots above
  a package, the package a file is in, a relative tsconfig `extends`, a
  workspace application's manifest, a Prisma schema, the top a gRPC
  contract is searched from, the checkout a build is stamped with - stops at
  the top of the checkout it starts in, and none reads in the home
  directory.
- **TypeScript resolves no import from an install above the repository, and
  a walk outside a checkout stops at what the run reads (P340).** The
  compiler looked for `node_modules` and `@types` in every directory up to
  the file system's root, so a package installed above the repository could
  resolve an import and lend its types. An install whose directory is above
  the top of the checkout a service is in - outside any checkout, above the
  directories the build was asked to read, else above the service's root
  widened to its workspace - now does not exist for the compiler; installs
  inside the repository resolve as before. The same applies to the
  programs a CDK app and a `serverless.ts` are read with. A walk in a
  directory of no checkout - the workspace roots above a package, the
  package a file is in, a Prisma schema, the top a gRPC contract is searched
  from - stops at the outermost directory the build was asked to read (the
  configuration's, a service's, each widened to the workspace that declares
  it) instead of the home directory; inside a checkout it still stops at the
  checkout's top, where a shared contract or schema is kept.
- **fastify-cli's port order, checked against its source (P327).** `fastify
  start` loads `.env` with dotenv up to fastify-cli 7 and with Node's
  `process.loadEnvFile()` from 8, neither over a set variable, so a
  `FASTIFY_PORT` its `.env` gives now wins over a `PORT` its command gives
  (it reads `FASTIFY_PORT` first); P321 had it loaded with dotenv,
  true only up to version 7.
- **Fields read through an alias and written by a key, workspace names with
  dots, and a bus grant's unread statement id (P328).** A static field read
  through what stands for its class under `any` - `const R: any = Registry;
  R.queue.add(...)`, `(Registry as any).queue`, a parameter each caller
  hands the class, an alias of any of these - is now read as the field,
  every write to it counted, and a call on it (`R.queue.add`) is the
  library's call by the field's declared class where the library is not
  installed; so is a class held under a typed alias. A
  field written or read by a key, `this['queue']`, `this[KEY]` or
  `Registry[KEY]` where `KEY` is a constant holding the name, counts as the
  field; a write by a key not read (`this[key] = value`) may be to any
  field, so a field a class writes so is no longer read as its declared
  value. A Terraform workspace's name may hold dots (Terraform takes any
  name URL path escaping leaves as it is), so a domain the workspace is
  written into is now the pattern `**.api.example.com`, `**` one label or
  several, and `eu.prod.api.example.com` is joined to it. A bus's
  `grantPutEventsTo` handed a statement id the files do not read
  (`process.env.SID`) is an unread grant saying the bus's policy takes it
  only with an id; `null` is none, and a value another stack exports is one.
- **Fields `Object.assign` writes, a field of either of two classes, and a
  context value no file sets (P332).** `Object.assign(this, options)`,
  `Object.assign(this, { queue })`, `Object.assign(Registry, { ... })` and
  `Object.assign(this, ...)` in a static member now count as writes of each
  field their sources give: a record written out gives its keys (the last
  source that surely writes one hiding those before it), a parameter what
  each caller hands it - each `new` of the class for a constructor's - and a
  source not read (`JSON.parse(raw)`) may write any field, as a write by a
  key not read may; a field so written was read as its declared value. A
  read through a name that may stand for two classes, each declaring its
  own static field of that name (`target.mail` of a function handed
  `Queues` by one caller and `Archive` by another), is read as either
  field, each value a candidate, the producer's `heldIn` naming the class's
  field each channel came from, and the call is the library's where both
  fields state its class; it was not read. A `tryGetContext` value no file
  sets (cdk.json, cdk.context.json, the configured options), handed as an
  argument to a library call - a bus's `grantPutEventsTo` statement id,
  `addEnvironment` - or written in a function's environment, is a value
  chosen when the app is synthesized (`-c key=...`) rather than nothing:
  the bus grant is an unread grant saying it is written where the context
  gives an id and dropped where none is, and the variable an unread setting
  saying the same.
- **A guess no longer shares a port with a firm one (P319).** Where one
  service is firmly at a port of this machine - the code writes the number,
  a loaded file or a setting file gives it, a container publishes it - and
  another is there only by a guess (a default, a merge, an example's offer,
  a written fallback such as `process.env.PORT ?? 3100`), the firm one is
  the port's service outright; a request to it was a `local-port-shared`
  row naming both.
- **An image read wherever the project builds it, compose run with
  `--env-file`, and a cluster's workload under its image (P331).** A
  compose service's `image:` with no `build:` and a `docker run`'s image are
  read with the Dockerfile a build of the project tags that image from - a
  `docker build -t`, another compose service's `build:` under that
  `image:`, a Skaffold artifact (`build.artifacts` and each profile's, with
  its context, Dockerfile, target and build arguments). An image nothing of
  the project builds is pulled as it is and never fetched: where the setting
  the code reads its port from hangs on it, a new info row,
  `container-image-unread`, says the image's environment is not read and
  where the port is taken to be, rather than silence; so does a Dockerfile
  that is not found. A `docker compose --env-file <f>` in a script, Makefile
  or shell script of the project fills the compose file's placeholders from
  those files, in order, in place of the `.env` beside it; where several
  commands run one file only what they all agree on is read, and a file the
  shell names settles nothing. What fills a placeholder is a port, an
  address or a host's name under a name that is no secret's - nothing else
  of a names-only file - and it now fills a port mapping, a container's
  name and aliases, an `env_file:`, a build's context, the image and the
  `environment:` values the graph keeps (`CATALOG_URL:
  http://${CATALOG_HOST}:3000`), not only a port. A cluster workload's
  containers (behind a service object, a node port or a port-forward) are
  read with the Dockerfile of the image they run, where the project builds
  it, under the manifest's `env`, `listensAt` naming the Dockerfile.
- **A file nothing loads offers a fallback port rather than moving it
  (P325).** P319 moved a written fallback, `process.env.API_PORT ?? 3000`,
  firmly to the value any committed environment file of the service gives,
  while P321 said a file nothing loads moves nothing; the two disagreed.
  Now a file the code is read loading (dotenv, `--env-file`, a framework's
  loader, a container's env file or image) places the port firmly, as it
  did; a file nothing is read loading offers its value as a guess beside
  the fallback, which stays a guess too, each asked whether it serves the
  request (`listensAt` says "a file nothing is read loading"), as an
  example file's offer is. A `PORT=` such a file gives no longer places the
  service firmly where its code reads the setting with a fallback
  (`claimants-nested-chain-env-port` snapshot: `localhost:3000/items`
  joins `api` at its fallback, `localhost:4000/items` as an offer).
- **A file nothing loads offers a port whatever the code reads (P331).** The
  rule P325 made for a written fallback now holds for a setting the code
  reads alone (`app.listen(process.env.PORT)`) and for a service whose
  server is not read listening at all: a `PORT=` in a committed
  environment file that is no example (`.env.development`) is offered as a
  guess where nothing the code reader follows loads the file, and firm
  where the code is read loading it (dotenv, `--env-file`, a framework's
  loader). A service the code places at the port firmly is then its
  service outright, where the two used to be a `local-port-shared` row. A
  names-only file such as `.env` still gives no port on the machine.
- **Compose's own variables, `include:` and `extends:`, a script's exported
  variables, and a workload's config maps and secrets (P337).** A compose
  file is interpolated from the files `COMPOSE_ENV_FILES` names - written
  before the command, exported earlier in its script, or set in the `.env`
  beside the file - where the command passes no `--env-file`, and
  `COMPOSE_FILE` names the files a command runs where it passes no `-f`; what
  the command's own shell gives (`export BILLING_PORT=8102` then `docker
  compose up`, in that order, in that script) is written over every file, a
  port, an address or a host name under a name that is no secret's. A
  script's variable also fills `$NAME` in the `docker compose`, `docker
  run` and `docker build` it runs, and `docker run -e PORT` passes it on. A
  file `include:`d by another is read as part of it, interpolated from its
  `env_file` or the `.env` of its project directory under the including
  file's variables, its relative paths its own; a service that `extends:`
  another, in the same file or another of the project, is read with the
  other's environment, ports and environment files under its own, their
  paths rebased. A command that starts a server - `node`, `tsx`, `npm
  start`, `next start` and the like - in a service's directory with a port
  its shell gives a setting (`cd stock; export PORT=4600; npm start`, or
  `PORT=4600 node dist/app.js` in a script) places the setting the code
  reads at that port, firmly, `listensAt` naming the script. A cluster
  workload's config-map settings are each said at their own file, over the
  image's `ENV`; a setting a `Secret` gives (`envFrom.secretRef`,
  `secretKeyRef`) is now read by name only, its value never, so where the
  code reads its port from it nothing is taken from the code's fallback and
  `published-port-unheard` says why; and a workload whose image name a
  template value the chart's values do not settle is a
  `container-image-unread` row, as a pulled image is. A request to a port
  one service writes as a number joined `heuristic` in a fixture whose
  framework was not installed: the route itself was read from what the
  source states (R142), and the edge is no surer than its route; the port
  was firm all along (`unloaded-env-image-environment` now ships the
  framework's stub, as other port fixtures do, and joins `static`).
- **A container's or a script's environment, as far as P337 left it
  (P343).** A compose `environment:` entry written with no value (`- PORT`,
  `PORT:`, a `build.args` entry alike) takes what compose's own variables
  give that name - the shell, the `.env`, the `--env-file`s or
  `COMPOSE_ENV_FILES` - and stays unset where nothing does. An `include:` is
  resolved as compose-go resolves it: its path, `project_directory` and
  `env_file` from the including project's directory, its project directory
  the first path's directory, and its own `env_file` or `.env` giving only
  what the including project's environment does not (the documented
  precedence: the local project's environment wins). A Makefile's own
  `export PORT := 4700`, `PORT = 4700` with `export PORT`, a bare `export`,
  `.EXPORT_ALL_VARIABLES`, `unexport`, `include`d files and a target's
  `ledger: export PORT = 4710` are the environment of its recipes, and make
  fills its own `$(VAR)` into a recipe line before the shell reads it. A
  script's export now reaches a program of the project's own: a `bin` of a
  service's `package.json`, a path such as `./bin/server` (a shell script
  followed into its commands), a `package.json` script the start list does
  not know (`npm run api`), and the file a runtime is handed (`node
  ./scripts/serve.js`), each read as started where the file - or a module
  it imports by a relative path - listens, at the service that holds that
  file; a `bin` pointing at what a build writes, started with a port, is an
  info `server-start-unread` row. A port a `Secret` gives is still never
  read, but `published-port-unheard` now names the Secret, its key and the
  manifest that writes it, and a Secret's values are no longer decoded or
  kept at all (a kustomize `secretGenerator` keeps its keys only).
- **An included Makefile, a script run in another package, Bun's mode
  however it is given, and an application held by a field (P350).** A
  `*.mk` another Makefile `include`s (a wildcard too) is read as part of
  that Makefile, its recipes with the includer's variables and run from the
  includer's directory, and no longer again on its own; a target's variables
  are in effect for its prerequisites, as make documents (`make dev`
  building `serve` with `dev`'s `PORT`), a nearer target's over a farther's,
  a `private` one kept. `pnpm --filter <pkg> <script>` and `-F`, `pnpm -C
  <dir>`, `npm run x -w <pkg>` / `--workspace`, `yarn workspace <pkg>
  <script>` and `bun --filter` are followed to that package's script, so the
  port a script exports before them reaches the server there; `env X=v` and
  `cross-env X=v` before a command are its environment. Bun's mode is read
  from the command's environment however it is given: exported earlier in
  the script (`export NODE_ENV=production && bun ...`), after `cross-env` or
  `env`, handed down by the script that runs another (`NODE_ENV=production
  npm run serve`), or given by the container that runs it - a Dockerfile's
  `ENV` under its `CMD`/`ENTRYPOINT`, a compose service's `environment`,
  `command` and `entrypoint` for one built from the repository; a name set
  with no `export` (`NODE_ENV=production; bun ...`) is the shell's own and
  reaches no program. `bunfig.toml`'s `env = false` drops Bun's own files
  (an `--env-file` still loads). A server several scripts or containers
  start with different files is read once per start, a port each, where it
  was the first script's files merged before. A field holding what the
  framework's own maker made (`private readonly app = express()`) that
  nothing but its own class's constructor writes, and a parameter whose
  default is a maker and that every caller hands nothing, are lifted like a
  `const` (P346): their routes are no longer `heuristic`.
- **A Makefile's goal, conditionals and patterns, compose's interpolation
  for Bun's mode, Bun run as `node`, and a listen through a workspace
  package (P356).** A Makefile is read for each goal a recipe runs for, with
  `$(MAKECMDGOALS)` holding that goal; `ifeq`/`ifneq` (`(a,b)` and quoted
  forms), `ifdef`/`ifndef` and `else if...` are settled where the files
  settle their operands - make's `strip`, `filter`, `filter-out`,
  `findstring`, `firstword`, `lastword`, `words` and `subst` read - and one
  that hangs on a variable only the environment or the command line gives,
  or on `$(shell ...)`, has each branch read, a port read under it an info
  `make-conditional-unsettled` row; a pattern's variables (`%-dev: PORT =
  4000`) apply to every target it matches, a target's own and a shorter
  stem's winning, and pass to prerequisites as a target's do; each target
  of `a b:` runs its recipe. A compose value Bun's mode is read from is
  interpolated as the Compose specification has it (`${VAR}`, `${VAR:-x}`,
  `${VAR-x}`, `${VAR:+x}`, `$$`) from the project's `.env`, a name written
  with no value takes the `.env`'s, and a service's `env_file` gives its
  mode; one only the shell running compose gives is read as Bun's
  development mode and said in an info `run-mode-unsettled` row. A `node`
  that is Bun - under `bun --bun run`, or in an image that links or copies
  Bun to `node` - loads Bun's files; one in an image built on Bun's own,
  which is not read, is read as Node and said in a `run-mode-unsettled` row.
  A program whose listen is reached through a package's name
  (`require('@shop/server')`) is followed to that workspace package's
  entry, its build mapped to its `src` as an uninstalled import is.
- **An application held by a property, handed as a parameter or given by a
  constructor is as sure as the maker's value it holds (P354).** A property,
  whether a field (`this.app`, `server.app`, a static one, a parameter
  property), a member of an object written in place (`const catalog = {
  router: Router() }`) or the property a JavaScript class declares by writing
  `this.app = express()`, is lifted where every write of it the repository
  makes is placed by the checker, made inside its class or its object's
  module, and a direct value, and nothing writes the object whole
  (`Object.assign(this, …)`). A parameter is lifted where every caller of
  its function hands it a direct value or a name holding one, or hands
  nothing to a maker default; callers are found by name, through imports,
  destructuring, aliases and object members, through receivers typed as
  nothing, and through every `import()` or `require()` of the function's
  module - a service's default started by name through a map of lazy
  imports (`const { default: init } = await services[name](); init(app)`)
  included. An application arriving as a parameter is served where every
  value its callers hand it is, and a field declared with no value
  (`app;`, `private app: Application;`) where every value written to it is;
  with nothing installed such a field is recognised from what the
  constructor writes. A write or a caller the reading cannot place keeps
  the application `heuristic`, with every route mounted under it
  (`maker-held-by-property-parameter-constructor`).
- **Fields written through an alias or in a subclass, domains a workspace
  names, and grants of a bus, table or stream by the CDK's version (P322).**
  A static field written through the class under `any` - `const R: any =
  Registry; R.queue = ...`, `(Registry as any).queue`, a parameter handed
  the class, `R['queue']` - now counts as one of its values, so a field
  given another queue that way no longer reads as its declared one; a field
  read in a class is also what each class extending it sets, unless that
  class declares the reading method again without calling `super`. A
  Terraform API mapping whose domain the workspace names is read per
  workspace: each name a map gives (another workspace's said to be its), a
  lookup's fallback as any other workspace's, and a domain the workspace is
  written into (`"${terraform.workspace}.api.example.com"`) as the pattern
  `**.api.example.com` (P328), the default workspace's beside it - taken only for a
  request with a route there - also through the domain resource's own
  `domain_name`. A CDK grant of a table, a stream or a bus to a role that
  takes nothing is read on the resource's own policy where the
  `aws-cdk-lib` the repository pins (installed, locked, or a range every
  version of which agrees) writes it there: a stream from 2.180.0, a table
  from 2.222.0 (2.144.0 with a `resourcePolicy`), a bus's
  `grantPutEventsTo` with a statement id from 2.186.0 under
  `@aws-cdk/aws-events:requireEventBusPolicySid` for a role imported with
  `addGrantsToResources: true`; a version left open is an unread grant
  saying so. Such a role's grants of a queue, topic, bucket or function go
  on the resource in its own account too, and a role imported from another
  account than its stack's written one takes nothing, as the CDK has it.
- **Fields written elsewhere, jobs caught at the queue's call, mapped stages
  and grants on a resource's own policy (P316).** A static field another
  module writes once (`Queues.mail = new Queue('mail')` in a setup file) is
  now the queue it is given wherever it is read, its writes found by every
  reference the checker knows; a field a base class declares, sets in its
  constructor or keeps from `super(new Queue('x'))` is read in a class
  extending it. `queue.add(error.jobName)` written in the catch itself is
  walked into the catch as a value followed out to a caller is, with the
  `channel-dynamic` row where a package's error may be the one caught; a
  package is also named from its installed types where nothing written
  names it. A Terraform API mapping whose stage the workspace names lists
  each workspace's stage under `stages`. A CDK grant of a queue, topic,
  bucket or function to a role imported `mutable: false` from another
  account is read as the grant the CDK writes into the resource's own
  policy.
- **A queue a field is declared with, a path handed in after a host, and a
  Terraform workspace's stage (P308).** A queue kept in a field set where it
  is declared - `private readonly queue = new Queue('emails')`, a field with
  no modifiers, a static one read through the class - was
  `channel-const-unresolved` at `this.queue.add(...)`; it is now the queue
  the field is made with, wherever it is given its one value, and a job a
  layer is handed is walked out to its callers. `'https://host' + path` and
  `` `https://host${path}` `` with `path` a parameter were read as the
  host's root and could join a `/` route; the path is now followed to each
  caller (a `+` chain split as the template it spells, the host kept), and
  where nobody hands a read path it stays unread with an `api-path-dynamic`
  or `dynamic-http-url` row. A stage a Terraform workspace other than the
  default names is said to be that workspace's (`live in the workspace
  production`), only the default's being the stage where none is given, and
  an unmapped API's `stages` list every workspace's.
- **A service's package declared by another service gives it types, not
  ways in (P282).** A front end that declares its API's workspace package to
  import the API's types read the API's resolvers, controllers and consumers
  as ways in of its own: two services answered every one of them, each request
  to them was `ambiguous-route-target`, the front end's own requests joined its
  copy, and the copies stood at addresses the API never serves (read without
  its bootstrap, they lost its global prefix). What is written in another
  configured service's directory, or in a library the declaring service
  reaches only through that service's package, is now that service's way in
  alone; the declaring service still reads the files, for their types and for
  the code it calls. A library a service declares itself is unchanged.
- **An API Gateway address is no queue (P268).** A queue's URL is read by
  its shape - a host and two segments - so an environment value
  `https://<id>.execute-api.<region>.amazonaws.com/<stage>/<path>`, or a
  function URL with two segments, was read as the queue `<path>`: a request
  rooted at it said no service declared its setting. Neither is read as a
  queue now.
- **A queue named in a worker's options object is that queue, and a queue is
  never named by a record (R181).** A repository's own worker decorator over
  BullMQ written `@Processor({ queueName: Queues.cron, scope: Scope.REQUEST })`
  was read as the queue named by its whole argument: where the options could
  be read the channel was `{"queueName":"cron-queue"}`, a node beside the
  `cron-queue` its string form landed on and one no producer can reach, and
  where the scope could not be read every such worker was `channel-dynamic`.
  `queueName` is now read as BullMQ's own `name` is; and a record read where a
  queue is named is refused as `channel-dynamic` rather than drawn, while a
  transport that matches records - `@MessagePattern({ cmd: 'sum' })` - keeps
  them as patterns.
- **A Prisma client generated where the tsconfig's `baseUrl` or `paths` place
  it is read with nothing installed (P270).** `import { PrismaClient } from
  'src/generated/prisma/client'` under `baseUrl: "./"`, with the schema's
  generator writing there, was taken for a package called `src`, so a NestJS
  service whose `PrismaService extends PrismaClient` read none of its queries
  and none of its models. A bare specifier the project's compiler options
  place inside the repository is now asked of the schema before it is taken
  for a package. A value held from a call of the repository's own function
  that writes its return type - `const prisma = sharedPrisma()`, `function
  sharedPrisma(): PrismaService` - is read as that type, awaited `Promise<T>`
  as `T`.
- **The coverage harness's counting rule no longer counts a middleware factory
  under `server/routes` as a Nitro route file (P270).** The `nitro-route-file`
  probe counts a file there that default-exports an event handler (h3's
  factories, or a function written in place that takes the event) rather than
  anything at all, so a Koa server keeping its routes and their middleware
  under that directory is no longer measured against routes it does not have;
  `registered-route-call` counts koa-router's `register(path, [verbs], ...)`.
- **A tRPC root a workspace package holds is read where the service serves
  the trees under it (R179).** Since P256 a root kept in a package beside the
  service was read only where the service mounted that root itself, so an
  application that serves the root a feature at a time - a handler file per
  feature, `createNextApiHandler(ordersRouter)`, and nothing mounting the
  root - lost every procedure as a tree imported only for its type, and every
  call to one read `procedure-not-found`. A service now reads a package's root
  where it mounts the root or any tree the root holds; a client that only
  imports the type still reads none.
- **A verb read out of the options a wrapper is handed is read at each caller
  (R179).** `const method = options?.method || 'POST'` into `fetch(url, {
  method, ...options })` was read as `GET` before P91 and as unread since; the
  browser and server readers now credit each caller with the default where it
  hands no options or options without `method`, and with the verb its options
  write where they write one.
- **`build --watch` hears a change made the moment it says it is watching
  (R178).** On macOS a directory watch is not listening when it starts: every
  watch a process holds is one stream of events, and starting one restarts the
  stream a moment later, so a change made in between reached no watch at all.
  A busy machine made the moment long enough to lose a directory that appeared
  right after `watching ...` was printed, and nothing rebuilt until the next
  save. The watch now waits until the platform reports a write into a
  directory of its own, started after every other watch, before it says it is
  watching, and does the same before a rebuild that started watching a new
  place counts as finished. Elsewhere the first write is heard at once.
- **One edge to nothing no longer costs a whole service, and the React reader
  no longer draws one (R180).** `export const [OrderProvider, useOrder] =
  createRequired()` is two exports of one declaration, and the React reader
  looked each up by that declaration: the second overwrote the first, the
  first's `calls` edge left from an id nothing wrote, and the graph refused the
  service - a large front end was `extract-failed` for a handful of
  such edges. Each name is now found as itself, and a call of either name -
  `useOrder()` - is joined to it. The graph itself no longer refuses a service for an
  edge to a node never written: it leaves the edge out and writes an
  `edge-end-missing` row at `action` naming it, and no fixture may carry one
  (invariant I15). An incremental build still reads the repository whole when
  a splice leaves such an edge.
- **A workspace package whose `exports` name only its build is read from its
  source (R180).** In a fresh clone `./dist/types/index.d.ts` is not there, and
  every import of such a member resolved to nothing; a server whose controllers
  take their prefix from an enum of one read almost none of its routes.
  The member is now read where its build is made from (`src/types/index.ts`),
  as a package mounted from outside already was; a subpath its map does not
  name stays unimportable, and a built member is still read at its build.
- **A GraphQL resolver declared by a decorator of the repository's own is read
  (R180).** `@StaffResolver(() => Order)`, where `StaffResolver` applies
  `Resolver` through `applyDecorators`, declared no resolver, so its fields were
  no ways in; the decorator is followed into its body, three levels deep, and
  the type it was handed is the resolver's.
- **`link` and `init` take an application of a workspace that keeps one
  manifest (R180).** `apps/orders` with a tsconfig that extends the root's and
  no `package.json` was "not a repository". It is taken when the workspace's
  own description names it as an application (`nest-cli.json`, `angular.json`,
  `workspace.json`, a `project.json`) or the root's manifest declares a
  framework, named as the description names it and typed by the root; `init`
  proposes such a workspace's applications rather than its root. `build` reads
  it with the root's manifest and the libraries its code imports through the
  tsconfig's `paths`, as part of the service
  (`fixtures/workspace-one-manifest`).

## [0.6.0][] - 2026-10-25

`@flowatlas/cli` only; `@flowatlas/markers` is unchanged at 0.2.0.

The repository's history was rewritten on 2026-10-25, to take out wording that
fixtures and tests had carried over from another project. The tags `v0.2.0` to
`v0.5.1` were made again on the new commits, with the same code: a clone or a
fork from before that date should be cloned again rather than pulled. The
packages on npm are unchanged.

0.6.0 adds what really ran to what the code says. `flowatlas observe` reads
trace files and exports (OTLP, @nestjs/observe, Zipkin, Jaeger, HAR, AWS X-Ray,
Step Functions histories, API Gateway and Lambda logs) or listens on this
machine, and lays counts, timings, statuses and payload shapes over the map
without ever drawing an edge from a trace. A branch can now be reviewed and
shipped from the map: `diff` draws changed flows as sequence diagrams and gives
a verdict, `rules` checks architecture rules, `check --env` says whether a
change can be deployed against what an environment runs, `spec` writes and
compares OpenAPI and AsyncAPI documents, `export` feeds Backstage and
Structurizr, `docs` keeps Markdown tied to flows, and every finding can go to
code scanning as SARIF. What the reader cannot follow is grouped by cause, can
be accepted, closed with project-written patterns, shape files or package
sources, and points at the repository probably missing. The page was rebuilt
around one Steps view and one search, and the MCP server grew from ten tools to
twenty-six, with prompts, resources and paged, structured answers.

### Migrating from 0.5.1

- **Node 22.12 or later (P86).** `@flowatlas/cli` declares `engines.node
  >=22.12.0`, which is what its dependencies already needed (`commander` 15
  needs 22.12, `better-sqlite3` 13 needs 22). 0.5.1 said `>=20` and failed on
  Node 20 anyway.
- **Rebuild once.** The build cache moved from version 4 to 5 (P83), so the
  first `flowatlas build` after upgrading reads every repository again and says
  `cache-invalid:version`. The graph's `SCHEMA_VERSION` is unchanged at 6, and
  `graph.db` gained an `unresolved.meta` column (P75) and `unresolved.kind` and
  `risk` columns (P208, `db_format_version` 2), each read with or without it,
  so a 0.5.1 database still opens and reads the same.
- **Upgrade a team together.** The configuration schema is strict, and 0.5.1
  refuses a configuration that uses any of the new keys: at the top level
  `shapes`, `packageSources` (P78), `builtInShapes` (P70), `settingFiles`
  (P77), `patterns` (P121), `callShape` (P89), `dead` (P91), `docs` (P120),
  `rules` and `rulesSettings` (P114), `deployed` (P117) and `mcp` (P201); on a service
  `hosts` (P77), `aliases` (P91), `tags` (P114), `apiDocuments` (P195),
  `catalog` (P119), `builtInShapes`, `shapes`, `patterns` and
  `packageSources`; and `adapters.http.clients` (P121). An `accepted.json`
  (format 2, P76) is likewise for 0.6.0 only.
- **Some ids moved.** A function URL's entry is keyed by its function,
  `http:ALL:/*@<function>` (P54), and a route that two APIs, load balancers or
  listeners serve gains `@api:<api>` and, where needed,
  `@listener:<protocol>:<port>` (P59, P61); a route only one API serves keeps
  its plain key. A saved page link, a `flowatlas.baseline.json` key or an
  accepted gap naming an old id stops matching: rewrite the baseline with
  `flowatlas doctor --accept`, and check `flowatlas accept --list` against the
  current gaps. A page link to the removed Walk tab (`#walk/<key>`) opens Steps
  on the same way in (P99).
- **Counts and levels moved.** Every unresolved row is now a gap, a note or a
  finding (P81), and only gaps count as missed: the build line reads `missed: N
  over S sites · notes: N · findings: N`, and `LinkReport.totals` gained
  `missed`, `sites`, `notes` and `findings`. `totals.unresolved` is kept equal
  to `missed` for this version and is deprecated; read `totals.missed`.
  `query-in-loop`, `package-from-repo` and `shape-file-unmatched` moved from
  `nothing` to `info`. Expect far fewer `route-unguarded` rows (P76), joins
  newly made from repository files (P77) and package sources (P78), marked
  `heuristic`, and the Map laid out in call order (P66). A doctor baseline
  keeps counting every actionable row, so no baseline changes verdict on
  upgrade.
- **File formats.** `diff.json` moved from format 1 to 5 (P96, P116, P114,
  P118) and `flowatlas.baseline.json` from 1 to 2 (P114); the older formats are
  still read, and a file from a newer flowatlas is refused by name. New files,
  each with its own version: `observed.json` (`observedFormatVersion: 3`, P65,
  P85, P105), `accepted.json` (2), `rules.json` (`rulesFormatVersion: 1`),
  `docs.json` (`docsFormatVersion: 1`), `check.<env>.json`
  (`checkFormatVersion: 1`), `spec-diff.json`, `spec-against.json`
  (`specAgainstFormatVersion: 1`), `flowatlas.deployed.json`
  (`deployedFormatVersion: 1`) and the build's own `stand-ins.json` (P82).
  `doctor.json` stays at `doctorFormatVersion: 2` and the contracts report at
  format 5; their new fields are optional.
- **A session lists only the tools its project can answer (P201).** A prompt
  or a script that expects a tool the project cannot answer yet (a run-time
  tool before `flowatlas observe`, `check_rules` without rules) finds it
  missing from `tools/list`; `start_here` says when each appears, and
  `flowatlas mcp --all-tools` or `"mcp": { "tools": "all" }` lists every tool
  as 0.5.1 did.
- **Accepted rules use the `shapes` glob grammar (P80):** `?` is one
  character, `**` as a whole segment matches zero segments too, and route
  patterns keep `*` as any run, `/` included.
- **Observed counts are not spread (P85).** A span that fits several joins,
  routes or methods is credited to none and listed under `ambiguous`, so a
  count is never shared between candidates.
- **On the page:** the Walk tab, the Ways in list's own filter box, the Graph
  tab's node search and the *show accepted* checkbox are gone; Steps, the one
  search box and the Not joined tab's *Accepted* section replace them (P99,
  P100, P101).
- **The package no longer declares `types` (P86).** It pointed at a
  `dist/index.d.ts` that never shipped.

### Added

#### Run time: `flowatlas observe`

- **`flowatlas observe <file...>`: traffic laid over the static map (P65,
  P85).** It reads trace files, keeps only the names that place a span in code
  (method, route template, `Class.method`, queue or topic, collection), drops
  every value, and matches spans to entries, handlers, channels, outbound calls
  and cross-service joins. It writes `.flowatlas/observed.json`: per join a
  count and when it was last seen, per entry its hits, and the spans no code
  accounts for. No edge is ever drawn from a trace. The page shows seen counts
  on ways in and steps, thicker Map links and a "seen at run time, not found in
  code" list, and `get_flow` and `who_calls` rows carry `observed: n`
  (`fixtures/multi-repo/traces`). The @nestjs/observe reader reads the batch
  the SDK (0.3.x) posts - `serviceId`, `snapshots` with `ct`, `p`, `op`, `a.m`,
  `a.sc`, `a.ou` and the span tree in `t` (nodes need `o`, `c`, `m`; `n` is
  optional), outgoing `http` nodes as client spans and `mongodb` / `pg` /
  `mysql2` nodes by collection - plain or gzipped, and a bare snapshot array.
  Each reader copies only the fields of its allow-list: no header, body, user
  id, query string, host, statement, tag, error message or log line reaches
  `observed.json`, the page or an MCP answer. Snapshots of another protocol,
  nodes the contract refuses and jobs without a tree are counted in the summary
  (`not read: ...`). A span that fits several joins, routes, calls, methods or
  tables is credited to none and listed under `ambiguous`, which the summary,
  `--format json`, the page (*could be more than one place*) and the graph
  server (`seenAmbiguous: n`) show. The file's name, version, join id and
  reader (`readObserved`) are defined once, in `@flowatlas/core`.
- **How long it took, how it answered, and runs that add up (P105).** Each
  span's duration, HTTP status and error flag are kept: every entry, join,
  method, table and channel credited gains a count, a p50, p95 and max (from
  log buckets about 9% wide, the max exact), the statuses seen and an error
  rate (the error flag or a 5xx; a 4xx is in the status mix only). A join is
  timed on the caller's span when one was read, and says `measuredAt`. Runs add
  to `observed.json` hour by hour instead of overwriting it: `--since <dur>`
  keeps a window of whole hours (`--since all` stops cutting), `--reset` starts
  again, and a file already read, known by the hash of its contents, is skipped
  and said. The file is `observedFormatVersion: 3`, with a `privacy` block (the
  fields kept, the categories dropped, how many attribute keys went unread),
  the `window`, the `sources` read, the hour `buckets`, and per entry the three
  slowest and three latest failing requests as trees of what each span was
  credited to, the only place a trace id is written (`--no-samples` keeps
  none); format 1 and 2 files are carried forward as one hour without timings.
  Every reader ends with one allow-list (`KEPT_FIELDS`, `keepAllowed`), and
  OTLP attributes off it are skipped while they are walked. `observe` also
  reads OTLP protobuf (`.pb`, or any file that is not JSON), gzipped or not,
  with no dependency, and a saved series of @nestjs/observe posts (`{ batches:
  [...] }`); the summary names the five slowest and five most failing entries
  and the window. The MCP server gained `hot_paths`, `slow_steps` and
  `trace_for`, and `get_flow` and `who_calls` rows gained `p95` and
  `errorRate` beside `observed` (`fixtures/multi-repo/traces`).
- **Zipkin, Jaeger and HAR readers (P112).** Zipkin v2 JSON (a list of spans
  or of traces) and Jaeger JSON (the UI's *Download JSON*, `{ data: [...] }`)
  are read into the same spans as OTLP: their tags go through OTLP's key set,
  so an export of the same traffic gives the same observed file; span and
  operation names, annotations, logs, endpoints and process tags are never
  read. A browser's HAR (*Save all as HAR*) becomes client spans of the front
  end (`--service`, else the map's one front end): each call a script made, by
  method, path shape, status (`0` is a failure), time and duration; files are
  skipped and counted. The URL's origin is compared with the front end's base
  URLs (`apiBaseEnv` values, `apiTarget`, `services[].hosts`) and dropped, and
  narrows the call to the `ui_api_call` whose join reaches a route of that
  service; that join is counted. A call to an origin nothing names is a third
  party, new unmatched kind `external`, by host only. Headers, cookies, query
  strings, request bodies and response content are never read, by key; an
  error names the entry and the field and never quotes the file. New span
  fields `peerService` and `thirdParty` in `privacy.kept`, five new
  `privacy.dropped` categories (`fixtures/multi-repo/traces/web.har`,
  `checkout.zipkin.json`, `checkout.jaeger.json`).
- **AWS traffic matched to the map (P107).** What an OpenTelemetry-instrumented
  Lambda function or the AWS Distro's layer writes lands on the nodes the
  Terraform and state machine readers draw: a function's span on its `invoke`
  entry (by `faas.name`, or the ARN in `cloud.resource_id` with its alias cut),
  a workflow's run on its `workflow` entry, a step on its node, a DynamoDB call
  on each table it names (`aws.dynamodb.table_names`, read as a list in JSON
  and protobuf), and SQS, SNS, EventBridge, Kinesis and S3 sends on the channel
  as the readers spell it (`order-placed` on an SQS span is
  `sqs/order-placed`), with the `emits` join from the caller; `Lambda`
  `Invoke` and `SFN` `StartExecution` on the join into the entry they reach, a
  queue's or a stream's delivery on the `consumes` join and the mapping's join
  into the function, and a step on the join into the function its task
  invokes. Which of several joins a call ran is settled by the function or step
  it ran in; a bus with several events and no telling which is counted on none.
  New unmatched kinds `function`, `workflow`, `state` (named `<workflow>/?`,
  never by a step name the map lacks), `table` and `cloud` (an SDK call of a
  service nothing reads, by `<service>/<method>` only); new ambiguity kind
  `channel`. Every ARN and URL is cut to the name inside it before a span
  exists, so no account id or region reaches the file, and no request
  parameter is read. A `calls` edge into an entry (a step, a mapping or a call
  site that invokes a function or starts a workflow) counts as a join, for the
  page and for `slow_steps` too (`fixtures/lambda-traces`).
- **AWS exports read without a collector (P108).** Four files a Lambda team can
  export with the AWS CLI or the console are read, picked by looking at them,
  with no AWS API called: X-Ray `batch-get-traces` output (`xray`: functions,
  workflows, steps, stages and every SDK call, matched as P107 matches their
  OTLP spans), a Step Functions `get-execution-history` (`sfn-history`: the
  run, its steps paired by the chain of events, a step's direct invoke of a
  function), API Gateway JSON access logs (`apigw-access-log`) and Lambda
  `REPORT` lines from a Logs Insights export in JSON or CSV, or plain
  (`lambda-report`). The last two give entries only: no joins and no samples (a
  span has `sampleable: false`, on `privacy.kept`). New flags `--workflow`,
  `--function` and `--access-log-keys`; a history that names no state machine
  or `REPORT` lines no log group names the function of are refused with the
  flag that gives it, and a flag given for a format that does not take it is an
  error. Each reader's never-read list (X-Ray annotations, metadata, `sql` and
  `cause`, a workflow's input, output and parameters, client addresses, request
  ids, memory figures) is tested absent from the file
  (`fixtures/lambda-traces/exports/`).
- **`observe --listen`, a receiver on this machine (P109).** `flowatlas
  observe --listen [port]` takes OTLP/HTTP traces (JSON or protobuf, gzip) on
  `/v1/traces` and the @nestjs/observe agent's batches on
  `/applications/telemetry`, on `127.0.0.1:4318`, so a service run locally
  with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` fills
  `.flowatlas/observed.json` as requests happen. Posts are read by the same
  readers and allow-lists as files; a trace's spans wait in a bounded buffer
  (10,000 spans, 2,000 traces, `--trace-wait`) for the rest of the trace; every
  `--flush` and on exit the matches are merged with the merge a file run uses,
  so the same traffic gives the same file, with one `sources` entry of format
  `listen` a flush. Metrics and logs are answered and dropped unparsed; nothing
  is forwarded. It binds loopback unless `--host` and `--allow-remote` are both
  given, refuses a `Host` that is not its own loopback name (421), any request
  with an `Origin` (403), `OPTIONS` (405, no CORS header ever), `text/plain`
  (415) and a body over `--max-body` before or after inflating (413,
  connection cut), and reads no request header but `Host`, `Content-Type`,
  `Content-Encoding` and `Content-Length`. While it runs it holds
  `.flowatlas/observed.lock`; `observe <files>` waits five seconds for it, then
  says a listener is running, and a lock whose process is gone is taken over.
  The observed file is written to a temporary file and renamed over the old
  one. `scripts/observe-send.mjs` posts the fixtures' traces to it (dev only,
  not packaged).
- **Never seen, blind spots, and best guesses traffic confirmed (P110).** Three
  read-time overlays of `observed.json`; the graph on disk never changes and no
  edge becomes `runtime`. **Never seen**: the MCP tool `never_seen({ since,
  service, kind, confidence, limit })` lists the ways in, channels and methods
  the code runs that traffic never touched, `strong` beside a sibling seen 20
  times over a window the file holds in full, `weak` otherwise, with one note
  per service the window holds nothing of. `flowatlas dead` and the MCP `dead`
  read traffic as evidence (`evidence.seen`, `evidence.neverSeen`): seen is
  `alive` whatever the code says, and an outside way in never seen beside busy
  neighbours is `likely-dead`; the CLI gains a `seen` column and `--since
  <dur>`. **Blind spots**: what `observe` matched to nothing becomes one
  `seen-not-in-code` info row per service and kind in `doctor`, listed under
  that cause by `doctor --unresolved` and the MCP `cant_follow` with the names
  the trace kept and the call that looks for each; the page's "Seen at run
  time, not found in code" list says the same. A send, invoke or start whose
  target the map has, along a join it does not draw, is a new unmatched kind
  `join`. **Best guesses confirmed**: a `heuristic` join traffic went through
  is counted apart (`1 of 4 best guesses confirmed by traffic in 2h`,
  `doctor.json` `traffic`), the row explaining the guess is withdrawn while it
  holds, `get_flow` / `who_calls` rows say `confirmedBy: "traffic"`, the Steps
  mark reads `best guess, seen ×n`, and the Map draws such a link solid. The
  page marks a never-seen way in `not seen in <window>` and the Busiest tab
  lists them. A client span that names the method it ran in (`code.function`)
  singles out that method's call site when two calls of one route fit, and a
  workflow step's task that names no target in an execution history is
  credited to the one target of its kind the step's task reaches (P108's open
  item).
- **Failures seen but not declared (P106).** The statuses each way in answered
  are set beside the failures its code declares, over the file's window: a
  status from 400 up that no failure declares is *undeclared*, with `expected:
  <why>` where the framework answers it anyway (the router's 404 and 405, a 401
  or 403 from a check in front of it, a 400 for a body it cannot read); a
  declared failure no request answered is *declared, never seen*, said only of
  a way in hit at least 20 times. An assumed status traffic answered is
  confirmed, and a failure that names no status is `maybe` beside an
  unexplained status. The page's failure chips say `404 seen ×3`, `409 never
  seen` and `500 ×4 not declared`; `get_flow` and `describe_for_prompt` carry
  `failures` and each `fails` row `seen`; the copied prompt has a *Failures
  seen at run time* section; the MCP server gained `undeclared_failures`, worst
  first; `doctor` gained `failure-seen-undeclared` and
  `failure-declared-unseen` rows at `info`, and `--strict-runtime` to make them
  count. Core's `riskOf` places the first under `wiring`, `PAGE_WORDS` says
  both, and one pure comparison, `compareSeenFailures`, decides them
  (`fixtures/multi-repo/traces`).
- **Run time on the page (P111, P148).** With an observed file beside the
  database, `flowatlas visualise` draws what traffic measured: the Steps
  waterfall in milliseconds by each step's p50 or p95 (a switch, kept per
  browser), its axis saying *typical time per step, not one request*; p95 and
  error-rate chips on steps and ways in; a *heat* switch on the Map (traffic,
  or the p95 of the slowest edge behind each link) with a key; the window in
  the header; and a **Traces** tab drawing each way in's slowest and latest
  failing request on its own time axis, with no trace or span id in the page.
  `visualise --observed-diff <a> <b>` adds a **Run time changes** tab (slower,
  failing more, newly seen, no longer seen, compared only above `--min-count`,
  default 20), and `flowatlas observe --diff <a> <b>` prints the same. The
  copied prompt and `describe_for_prompt` write a step's and a way in's p95 and
  error rate. Sample trees in `observed.json` say when each span began after
  the request did (`start`, ms). A way in that traffic carried bodies to (see
  P113) counts as seen, and so does its handler, for `never_seen`, the page's
  *not seen in* mark and `dead`'s evidence; its hits and joins stay what the
  spans said.
- **Payload shapes from traffic (P113).** `flowatlas observe --shapes` reads
  the JSON bodies a HAR or a @nestjs/observe batch carries for their shape
  only - key names and JSON types, never a value - folding keys that are values
  (ids, emails, tokens, UUIDs) into an index signature, and keeps them per
  route and status under `shapes` in `observed.json` (optional;
  `privacy.bodies` says `not read` or `read for shape only`). Each route's
  shapes are compared with the types its code declares through the contracts
  package and its wire rules: the summary names the routes whose traffic
  differs, `flowatlas contracts` gains a `traffic` section (`seenIn` / `of` per
  field, never an error), `check_contract` carries `traffic` and takes an entry
  id, `get_flow` hints it where traffic differs, the page's Steps header shows
  `traffic differs: n fields` (and the Ways in row beside the way in's p95 and
  error rate), and `flowatlas dead` lists declared optional fields no traffic
  carried. Without `--shapes` no body is read.
- **Run time from an end-to-end test run (P205).** `flowatlas observe
  test-results` reads every HAR a Playwright run left under the directory
  (`*.har`, `*.har.gz`, and the `.zip` a `recordHar` path ending in `.zip`
  writes), leaves everything else alone and says how many files it left; a
  quoted glob is the files it matches. The HAR reader reads Playwright's
  files in each shape (`mode: 'minimal'` or `'full'`; `content: 'omit'`,
  `'embed'`, or `'attach'`, whose body files beside the HAR or in its archive
  `--shapes` reads), counts what was not the page's own call to a server (a
  request the test made through its `request` API, a service worker's, one the
  test answered with `route.fulfill` or stopped with `route.abort`), and reads
  Playwright's status `-1` as a call that failed. `docs/run-time.md` is the
  recipe: `recordHar` in a fixture, the e2e tests, `observe`, then what the
  page and the graph server's `slow_steps` and `never_seen` say.

#### What the map could not read, and how to close it

- **What the reader could not follow, grouped by cause (P75).** A row about a
  step that could not be followed records why, as the code states it, under
  `meta.cause`, and the package it points into under `meta.package`; a folded
  row lists the same per cause under `meta.causes`, with a few places each.
  Causes include `module-not-installed:<package>`, `import-unresolved`,
  `re-export-missing`, `any-typed`, `language-any`, `untyped-parameter`,
  `callback-param`, `dynamic-member`, `interface-type`, `function-field` and
  `data-layer-unnamed`. `flowatlas doctor --unresolved` prints them by cause
  and by package (`--top`, `--samples`, `--cause`, `--package`, `--json`), the
  page's Not joined tab gains a Can't follow sheet, and the graph server gains
  `cant_follow` (`fixtures/cant-follow`).
- **`flowatlas doctor --reason <code>` (P141).** Lists the places of one
  reason, or several (repeatable, or a comma list), under every level the
  reason is at, so a reason with hundreds of places can be read on its own:
  `flowatlas doctor --reason dynamic-http-url --max-nodes 500`. The rows are
  narrowed as `--service` narrows them, the sections default to `unresolved`
  and `desync`, and a reason neither the catalogue nor any row knows exits 2
  with the nearest names. `--unresolved --reason` narrows the breakdown the
  same way, and its JSON says so under `reasons`. `--accept` refuses it.
- **`flowatlas accept` (P72, P76, P80).** Accepts a known gap by reason or by
  gap id (`gap:<service>|<file>|<reason>`), narrowed with `--service` and
  `--file`, with a `--note`, undone with `--remove`; `--list` prints what is
  accepted. It writes `accepted.json` (format 2) beside `graph.db` and refuses
  a target no current gap matches. A rule accepts a route finding on every
  route a `--path` pattern names (`'GET /api/public/*'`), or in every file a
  `--file` glob names, in the glob grammar `shapes` uses (`isGlob`, with
  `isFileGlob` kept for one version under the old name); a rule needs `--note`,
  and `--dry-run` lists what it would take. `doctor` leaves accepted gaps out
  of every count and says how many (`unresolved.accepted` in `doctor.json`).
  Every surface - doctor's report, `doctor --unresolved`, `shapes --suggest`,
  the page and the graph server's `cant_follow` and `search` - goes through one
  split in the linker (`acceptedSplitOf`): rows an annotation answered are
  demoted first, a route rule takes a row read back without its symbol, and the
  rules are compiled once per surface. A file that does not parse (a merge
  conflict, a truncated write), does not match the format, or comes from a
  newer flowatlas is never wiped: adding and `--remove` refuse, exit 2, naming
  the file and the problem; `--list`, `--dry-run`, doctor (a warning line and
  `unresolved.accepted.problem`), `doctor --unresolved`, `shapes --suggest`,
  `visualise`, `cant_follow` and `search` say the problem and accept nothing.
  The file is written through a temporary renamed into place; `readAccepted`
  returns the gaps and the problem, with `loadAccepted` kept for one version.
- **The repository that is probably missing (P122, P144, P146).** `doctor`
  names the repository the project most likely lacks, from evidence the graph
  already holds: a setting no service claims (`PAYMENTS_URL`), a host of the
  project's own network nothing answers, a package under the project's scope
  that is not installed and no read repository is, a channel with one end, and
  a deployment that starts or roots something nobody deploys. Names that agree
  once their separators, generic words and plural are taken off are one group,
  ranked by kinds of evidence, then places; a configured service's name is
  never one. Directories beside the configured repositories (and `--scan
  <dir>`) are matched by manifest name, directory name, a compose service built
  from them and the hosts their own setting files name - manifests and
  root-level setting files only, never source - and the line ends with the
  `flowatlas link` command that adds the one that fits. The report opens its
  unresolved section with "Probably missing"; `doctor --missing` lists every
  group with every place (`--json`, `--top`); `doctor.json` gains the optional
  `unresolved.missingRepos`; `--format github` adds a `::notice` at the
  configuration. It decides no exit code. `flowatlas link --suggested` (with
  `--dry-run`, `--scan`) links the one directory that fits each group, and none
  where two do. Requests rooted at a setting whose values name no service keep
  those values on the call as `meta.baseUrlValues`.
  - **Traffic as a sixth kind of evidence (P144).** With an observed file, a
    blind spot (`seen-not-in-code`, P110) whose service no configured service
    is becomes `traffic` evidence, one place per blind-spot group, each with
    what it reached and the window it was seen in. Alone it is weak (a proxy
    or a collector writes spans under its own name), so `doctor` says it in its
    head only when another kind agrees or a directory fits. `doctor --missing`
    lists the traffic places with their window and `doctor.json`'s places gain
    an optional `seen`. A service's blind spots are a check of their own,
    `gap:<service>||seen-not-in-code`, that `describe_for_prompt` writes and
    the page's *Seen at run time, not found in code* sheet copies (*Copy as
    prompt*, *Copy for agent*).
  - **A call's `peer.service` (P146).** `observe` reads OpenTelemetry's
    `peer.service` on client and producer spans (OTLP, Zipkin and Jaeger) into
    a kept span field, `peerName`: a name only, an address dropped as every
    host is, a value-like name masked as `:value`. A name that is not one of
    the map's services, once normalised as the groups are (`orders-api` is
    `orders`), is counted in `observed.json` as an unmatched row of the new
    kind `peer`, by the calling service; it shows in the summary and among the
    blind spots (*peer services*), and nothing is matched by it. Each name is
    `traffic` evidence, one place per calling service: `doctor --missing` says
    `gateway: called payments-api, 6 spans in 1h (peer.service)`, and
    `doctor.json`'s traffic places gain an optional `seen.called`. A peer
    blind-spot row carries every name under `meta.peers` when it lists only
    five.
  - **A subscription nothing here writes to (P204).** `stream-no-writer` (a
    stream a function reads that nothing configured writes to) and
    `subscription-matches-nothing` (a rule taking events by a pattern nothing
    published matches) stay findings, and are evidence of a kind of their own,
    `subscription`: the stream by its name, as a channel is named, and a
    rule's pattern by each `source` it names, its last dotted word the token
    (`acme.payments` → `payments`; the platform's `aws.*` sources name none).
    Weak alone, like a channel with one end, since another account, a partner
    or the platform feeds as many; a declared stream read and never written is
    said only as a subscription, no longer also as a channel. Both reasons'
    checks now open *How to close it* with the `flowatlas link` line, naming
    the repository when the row is its evidence, on the page and from
    `describe_for_prompt`; `doctor --missing` says `stream kinesis/payments is
    read by jobs and nothing here writes to it` and `events from
    acme.payments* are taken by jobs (1 rule) and nothing here publishes one`.
    `fixtures/missing-repo` gained a configured `jobs` service whose stream and
    rule are both such evidence for "payments".
- **Every gap says how to close it (P122).** A check's prompt - the page's
  *Copy as prompt* and `describe_for_prompt` on a gap id - ends with *How to
  close it*, one line per way that applies to its reason from one table
  (`REMEDIES`, `remediesOf`, `remedyLinesOf` in `@flowatlas/core`): link the
  repository (by name when the gap is its evidence), a setting, an alias,
  `apiTarget`, a pattern, a shape file, the annotation meant for it, or the
  advice on its places, then the `flowatlas accept` line. The page's row menu
  gains *Copy for agent*: the same text as a task, with how to see it gone.
  `describe_for_prompt` also takes a place (`file:line`, `service#file:line`);
  `cant_follow` and `search` gap hits hand on to `describe_for_prompt({id:
  <gap id>})`; `start_here` lists `missingRepos` (at most three, by name, with
  the directories `flowatlas mcp` found for each).
- **Your own extraction patterns (P121).** A project can write a YAML file of
  code patterns - `$BUS.emit({ topic: $CHANNEL, data: $PAYLOAD })` on a
  receiver of type `ShopBus` publishes to `$CHANNEL` - with tests beside each
  rule, and list it under `patterns` (top level or per service). Each rule is
  compiled into the description the readers already read (`broker.custom`,
  `starters`, `db.tables`, and the new `adapters.http.clients`), so a Can't
  follow row for an in-house bus, HTTP client or data kit becomes something the
  project fixes in one file. A pattern is one TypeScript expression: `$NAME`
  holes, `$$$NAME` runs, `_`, object keys in any order, chains, constructions,
  literals that must match. A rule that cannot be said as locators is refused
  with the part named (`pattern-not-expressible`); a file that cannot be read
  is `pattern-file-unread`; a written description on the same call wins
  (`pattern-shadowed`, info); two rules on one call read neither
  (`pattern-ambiguous`); a rule nothing matches is `pattern-unmatched` (info).
  Nodes a rule drew carry `meta.describedBy: "pattern:<id>"`, and a call a
  description now reads loses its `call-dynamic-receiver` row. New commands:
  `flowatlas patterns test [files...]` runs every rule's tests by the reader
  the build runs, in memory (exit 1 on a failing test, 2 on a rule that does
  not compile; `--sample`, `--service`, `--json`), `flowatlas patterns explain
  <place>` shows how far each rule got at a place and the first part that did
  not fit, and `flowatlas patterns suggest` writes starter rules for the
  wrappers the reader could not follow most often (`--min-sites`, `--out`). The
  MCP server gained `test_pattern({ yaml, code?, service? })`, and
  `cant_follow` offers it with a starter. Pattern files join the stand-ins
  fingerprint, so an added, edited or removed file reads the services that list
  it again (`fixtures/house-patterns`).
- **`adapters.http.clients` (P121).** An HTTP client of the project's own,
  described by its receiver type, the function that makes it, or its own name,
  with locators for the address, the body and the verb (or the verb fixed, or
  the method's own name), read by the server reader and both browser readers.
  Every description gained `where` (values the call must write) and
  `describedBy`; a `broker.custom` producer gained `module`.
- **Built-in declaration shapes for uninstalled repositories (P70).** Where
  `rxjs`, `@nestjs/common`, `@nestjs/core`, `@nestjs/microservices` or
  `@nestjs/passport` do not resolve, the server reader reads a few hand-written
  declarations of their public surface in their place, and the Angular reader
  does the same for `rxjs`, `@angular/core` and `@angular/common/http`. They
  are held in memory, never written to disk, and an installed package always
  wins. On a clone with nothing installed, a `ClientsModule.register([{ name
  }])` token resolves for `@Inject(name) ClientProxy`, passport's `AuthGuard`
  keeps its 401, and `Observable<T>` returns unwrap: on `fixtures/multi-repo`
  copied out of the workspace, `module-import-dynamic` went from 1 to 0,
  `di-token-unknown` from 1 to 0 and `type-unresolved` from 12 to 0.
  `builtInShapes: false` turns them off, project-wide or per service.
- **Sources for uninstalled internal packages, and shape files (P78).** An
  import of a package that is not installed resolves to that package's source
  where a configured repository, a workspace member of one, or a directory
  directly under the configuration has a `package.json` whose `name` is the
  package: through its `exports`, `types`, `typings` or `main`, the same under
  `src/` for a build nobody ran, then `src/index.ts`, with its own tsconfig
  `paths`. It is read for its types alone, at the path an install would have,
  so no node of it is minted in the importer. A new top-level and per-service
  `shapes` key lists `.d.ts` files of the project's own holding `declare module
  '<package>' { ... }` blocks, read in memory like a built-in shape. The order
  is fixed: installed, source, shape file, built-in shape; `packageSources:
  false` (or `"services"`) turns the first off (or keeps it to configured
  repositories). An edge drawn through those types is `heuristic`, with
  `because: ["package-from-repo" | "shape-file"]` and `typedBy`, shown as a
  small mark on the page's steps and in `get_flow`. New rows:
  `package-from-repo` and `shape-file-unmatched`, `package-version-differs`
  (info), `package-source-ambiguous`, `shape-file-unread`. `flowatlas shapes
  --suggest` lists the missing packages most places need with the names used
  of each (`--top`, `--service`, `--package`, `--members`, `--json`), and
  `--out <dir>` writes a starter `.d.ts` per package, names only and every type
  `any`, never into a repository and never over a file. `cant_follow` places
  gained `coveredBy` and its `next` names the command; the build cache records
  the source files and shape files read, so editing one re-reads the importer
  (`fixtures/uninstalled-internal-packages`).
- **Base URLs from the repositories' own files (P77).** A request rooted at a
  setting no service claims under `baseUrlEnv` is completed from what the
  setting is given: the environment a function running it is deployed with,
  else `.env.example`, `.env.sample`, `.env.template` or `.env.development`,
  the compose container built from the repository (`environment:`,
  `env_file:`), `serverless.yml` and `wrangler.json` / `wrangler.toml`
  variables, and the code's own fallback (`?? '…'`, `|| '…'`, `config.get(key,
  '…')`, a `registerAs` factory). `.env`, `.env.local` and other environments'
  files are read for names only. Only an address is kept, scheme, host and
  path; secrets by name, credentials, queries and token-like paths are dropped.
  The host is matched to a service by its name, the new `services[].hosts`, its
  compose container names and published ports, and the port its example file
  runs it on; a host outside the project is a third party. Such a join is
  `heuristic`, with `baseUrl` and `baseUrlFrom` on the edge, the request, the
  page and `get_flow`, and a `base-url-from-files` note. A setting nothing
  gives a value and named after exactly one service is taken as it
  (`base-url-from-name`). The same files complete an address waiting on the
  environment where no deployed function sets it (`environment-from-files`).
  `settingFiles.read: false` turns it off and `settingFiles.environment`
  chooses one environment (`fixtures/multi-repo-base-urls`).

#### Reading code

- **What each route can fail with (P68).** A NestJS entry gained `meta.fails:
  [{status, exception, at, file, line, source}]`: the built-in exceptions and
  `new HttpException(..., status)` thrown by its handler, by the services and
  helpers it calls and by the exception classes they extend, a guard's refusal
  (403; 401 for passport's `AuthGuard`, 429 for the throttler), and the
  framework's pipes (400) on the route or on a parameter. Throws caught in the
  same body and rethrows are left out; a non-HTTP entry keeps the exception and
  no status. `get_flow` shows `fails` on each entry, and `describe_for_prompt`
  gained a "Can fail with" section (`fixtures/nest-failures`).
- **Which guard covers a route, and from where (P76).** A NestJS entry gained
  `meta.access`: every guard and middleware in front of it with `where`
  (`global`, `module`, `controller`, `route`) and `via` (`APP_GUARD in
  AuthModule.forRoot`, `useGlobalGuards in src/main.ts`, `@UseGuards on
  OrdersController`). `APP_GUARD` is read through spreads, named arrays, a
  provider held in a const and a module's own `forRoot()`, and an installed
  class (`useClass: ThrottlerGuard`) counts too; a `providers:` list that
  cannot be followed is a `module-providers-unread` row. A `@Public()`-style
  decorator - `SetMetadata(KEY, true)`, through a function of the project's own
  or `applyDecorators`, on the handler or the class - switches off each guard
  that reads the key. `get_flow`, `describe_for_prompt` (an "In front of it"
  section) and the page's details panel show it all
  (`fixtures/nest-route-access`).
- **`/** @flowatlas-public <why> */` (P90).** On a handler or its controller,
  a route open on purpose has no `route-unguarded` row and a
  `route-public-declared` row at `info` naming the reason instead; a marker
  with no reason is taken as public and listed as `marker-reason-missing`.
  Nothing else is read as public: not a verb, a path or a name.
- **Calls run once per item, or side by side (P69).** A call inside a `for`,
  `for…of`, `for…in`, `while` or `do` body, or inside a function handed to
  `map`, `forEach`, `reduce` and the like, gained `meta.inLoop: {kind, line}`;
  one inside the arguments of `Promise.all`, `allSettled`, `race` or `any`
  gained `meta.concurrent` and `meta.together: {by, line}`. A query, cache
  call, request or publish reached once per item, directly or through a
  function the loop calls, is a `query-in-loop` row: a likely N+1
  (`fixtures/nest-query-loop`; see P89 under Changed for which loops count).
- **Log lines on steps, and the zone a schedule fires in (P71).** Methods and
  functions gained `meta.logs: [{level, text, at}]`, one per line written
  through a logger or the console, with the message kept as a template whose
  values are named by what holds them, never by what they hold. A `@Cron` way
  in gained `meta.timeZone` or `meta.utcOffset` from its options
  (`fixtures/nest-jobs-logs`).
- **Tables named where they are set (P88).** Three shapes of a table written
  one step away from the query are read with no configuration. A base,
  abstract or extended, whose queries hand `this.<field>` to the library's own
  table argument (`db.collection(this.collectionName)`) is read as a
  `localBaseClasses` entry with that `tableProperty`: each call through a class
  under it is on the table that class sets, `heuristic` when the field is not
  `readonly`, and a class setting it to something unreadable gets a
  `dynamic-table-name` row naming the class. A helper of the same class that
  returns one expression (`this.coll()`, a getter `this.collection`) is
  followed one level in the chain walk. On TypeORM's `EntityManager` and
  `DataSource`, the entity class handed to `find`, `save`, `createQueryBuilder`
  and the like, or to a builder's `from`, names the table (`meta.source:
  "entity-arg"`). Queries read the first two ways carry `meta.tableFrom:
  "inferred-property"` or `"helper"` (`fixtures/tables-set-elsewhere`).
- **TypeORM's raw SQL read as a statement (P126).** A whole statement handed
  to `query` on a repository, an `EntityManager`, a `DataSource` or a
  `QueryRunner` names the tables and the verb its text writes (`meta.source:
  "sql-parse"`), where it had been a read of the repository's entity or a
  `dynamic-table-name` row; a text not written out whole is read as before. A
  loop of guarded raw `UPDATE`s through it is a `query-in-loop` note and a loop
  of `… = ANY($1)` statements is set aside as a batch, as through a driver; a
  manager's `update(Entity, criteria, …)` is read as conditional by its
  criteria (`fixtures/loops-worth-fixing`).
- **Callers `dead` used to miss (P91).** A service can be named by
  `services[].aliases` (unique across every name and alias, matched exactly)
  wherever a service is named: `@CallsService`, its JSDoc twin `/**
  @flowatlas-calls <service> <METHOD> <path> */` (now read on server methods
  and functions too), `apiTarget`, a base address's host. A worker's
  `env.X.fetch(input, init)` is an `http_out` with `meta.binding`, joined
  `static`, `via: "serviceBinding"`, to the service its `wrangler.*`
  `services` bind `X` to (by name, alias, or the `name` that service's own
  wrangler file deploys it under); a binding to no known worker is a
  `service-binding-unknown` row. A request made to exactly what a setting
  holds (`fetch(process.env.REINDEX_URL)`) whose value is a whole address takes
  the value's path. A wrapper handed the verb (`this.req('PATCH', path)` into
  `fetch(url, { method })`, `http.request(method, url)`) credits each caller
  with the verb it hands in, through further wrappers, by one walk in the core
  (`verbsAtCallers`, `verbAlong`) the server, Angular and React readers share;
  and a caller leaving an argument out hands in its default (`url()` for
  `url(suffix = '')`) (`fixtures/multi-repo-dead-routes`).
- **`likely-dead` (P91).** A route nothing calls that a request read in part
  could still reach - what was read matches, each unread piece standing for
  the rest of its segment and any after it, or only the verb was unread - is
  listed by the build in `routes.nearMissed` and by `dead` as `likely-dead`
  with up to three such requests (under `evidence.couldHit`, P95). No edge is
  drawn.
- **A browser annotation that names its service (P127).** `/**
  @flowatlas-calls catalog GET /items */` above an Angular method or a React
  function is read as `GET /items` at the service it names, by name or alias
  (`meta.service` on the request), ahead of `apiTarget` and every other way a
  browser request's service is decided, and joined `via: "marker"`. A name no
  service answers to is a `marker-service-unknown` row, and a route the named
  service lacks a `marker-route-not-found` row, as for the server's
  annotation. The two-word form (`GET /items`) keeps its meaning, and the React
  reader reads either form for the first time. A tag with no verb in first or
  second place is no longer read as a request (`catalog items` had been the
  verb `CATALOG`), and a tag is read on one line only
  (`fixtures/multi-repo-annotated-browser`).
- **A body handed through a verb wrapper (P128).** A server request whose body
  is a parameter of the wrapper that sends it - `req(method, path, body)` into
  `fetch(url, { method, body: JSON.stringify(body) })`, the settings one
  `const` away, or `init.body = JSON.stringify(body)` set on them afterwards -
  reads its body at each caller, along the same calls its address and verb are
  followed through (the core's `argumentAlong`), so `this.req('POST',
  '/invoices', invoice)` carries `invoice`'s type and keys. The caller's second
  argument stays the body only for a wrapper that does not say where its body
  is (`fixtures/nest-client-wrapper`, `fixtures/nest-forwarded-verb`).
- **A server request's own body (P131).** `fetch(url, { method: 'POST', body:
  JSON.stringify(order) })` carries `order`'s type and keys where it is made;
  the server reader had read no body from a request's own settings at all. A
  body already a string, `body: event.body`, is read as `string`, and
  `contracts` says so (`body-already-serialised`).

#### Reading AWS

- **A table write reaches the function its stream runs (P51).** DynamoDB
  writes - `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`,
  `TransactWriteItems`, the document client's `put`, `update`, `delete`,
  `batchWrite` and `transactWrite`, from `@aws-sdk/client-dynamodb`,
  `@aws-sdk/lib-dynamodb` and version 2 - are publishers onto
  `dynamodb/<table>` wherever some service's Terraform declares that table's
  stream (`stream_enabled`, `stream_view_type`, or a mapping from its
  `stream_arn`), and the mapping from the stream is a consumer of that channel
  triggering its `event` entry. `flow` and `impact` follow Lambda A → table →
  stream → Lambda B, across repositories too. Kinesis `PutRecord` and
  `PutRecords` land on `kinesis/<stream>` the same way. A table named by
  `process.env` is completed from the function's deployed environment, as a
  queue is. A write to a table with no stream, and any read, joins nothing and
  says nothing. A mapping's `filter_criteria` is put on the edge with a
  `stream-filter-not-matched` row, and a stream something reads and nothing
  writes is a `stream-no-writer` row, both at `info`
  (`fixtures/lambda-terraform-table-stream`).
- **A workflow's write reaches the function a stream runs (P55).** A Step
  Functions task that writes to a table - `dynamodb:putItem`, `updateItem`,
  `deleteItem`, and through `aws-sdk:` the batch and transaction writes - is a
  producer onto `dynamodb/<table>` from that state, kept only where the table's
  stream is declared, as a function's write is; `aws-sdk:kinesis:putRecord`
  and `putRecords` land on `kinesis/<stream>`. A table chosen at run time
  (`TableName.$`, JSONata) stays the existing `workflow-target-dynamic` row. A
  batch keyed by a bare word, `RequestItems: { orders: [...] }`, or by a
  shorthand property, is read as the table that word names
  (`fixtures/lambda-terraform-table-stream`).
- **S3 bucket notifications, and the writes that fire them (P52, P56, P60).**
  `aws_s3_bucket_notification` is read from Terraform, in HCL and in JSON, and
  so is `terraform-aws-modules/s3-bucket/aws//modules/notification`: each
  `lambda_function`, `queue` and `topic` block (`lambda_notifications`,
  `sqs_notifications`, `sns_notifications` in the module) is a consumer of
  `s3/<bucket>` taking its `events` and keys by `filter_prefix` and
  `filter_suffix`, and `eventbridge = true` puts the bucket's events on the
  default bus as `aws.s3`, where existing rules take them. `PutObject`,
  `CopyObject`, `CompleteMultipartUpload`, `DeleteObject(s)`, version 2's
  `upload` and `@aws-sdk/lib-storage`'s `Upload` are publishers onto the bucket
  by `Bucket` - written out, from `process.env` completed from the deployment,
  or a constant - recorded as the event they fire with the key they write.
  Each write's edge says which notifications take it (`takenBy`), `static`
  where the key as written says so and `heuristic` with the reason otherwise;
  a URL signed for a `PutObjectCommand` is a `heuristic` write, `because:
  ["presigned"]`. On a bucket that keeps versions (`aws_s3_bucket_versioning`
  Enabled or Suspended, or the bucket module's `versioning` input), a
  `DeleteObject` or `DeleteObjects` naming no `VersionId` is taken as
  `s3:ObjectRemoved:DeleteMarkerCreated` rather than
  `s3:ObjectRemoved:Delete`. New rows `bucket-notification-unread` and
  `s3-write-matches-nothing` (info), and a locator `receiver-constructed-path`
  that reads what a receiver was constructed with
  (`fixtures/lambda-terraform-bucket-notification`,
  `fixtures/lambda-terraform-bucket-module`).
- **Other ways a Lambda function is run, read from Terraform (P53, P56, P60).**
  A function URL and an Application Load Balancer target group of functions
  are `http` entries on the function - `ALL /*` for a URL, each listener rule's
  path and verb for a load balancer, its hosts kept on the entry. A user pool's
  `lambda_config` is an `event` entry `cognito/<pool>/<trigger>` per step, and
  an IoT topic rule an `event` entry `iot/<topic filter>` running its function.
  An IoT rule's other actions are drawn as well: `sqs` and `sns` onto their
  queue or topic, `kinesis` onto `kinesis/<stream>`, `dynamodb` and
  `dynamodbv2` onto `dynamodb/<table>` - so a rule reaches the function that
  table's stream runs - and `step_functions` starting its state machine, as
  `StartExecution` does. An `error_action`'s action is drawn the same way and
  marked `when: "failure"`, a workflow or a function named elsewhere included.
  Any other action (`firehose`, `s3`, `republish`, ...) is an
  `iot-action-not-read` row, and an `aws_lambda_permission` for a principal
  none of these reads an `invoker-not-read` row, both at `info`
  (`fixtures/lambda-terraform-other-ways-in`).
- **Function URL callers and Lambda destinations (P54, P60).** A request
  rooted at a setting no service claims joins the `ALL /*` entry of the
  function URL the running function's environment names
  (`aws_lambda_function_url.x.function_url`, directly or through a module
  output), `via: "functionUrl"`, `static` where the path is read and
  `heuristic` where it is not; `process.env.X + '/path'` is read as an address
  rooted at `X`. `aws_lambda_function_event_invoke_config`
  `destination_config` and an event-source mapping's `on_failure` are
  `triggers` edges from the run to the destination function, or to a publisher
  onto its queue, topic or bus, with `meta.when: "success" | "failure"`; a
  result put on a bus is the platform's `lambda` / `Lambda Function Invocation
  Result - Success|Failure` event. A destination function another service
  deploys is joined the same way, and an invoke configuration of a function
  another service creates is joined from that function's entry instead of
  being a `subscription-source-unread` row
  (`fixtures/lambda-terraform-destinations`).

#### Reviewing a branch, and deploying it

- **A verdict on what a branch changed, and what stopped joining (P96).**
  `what_changed({verdict: true})` answers `safe`, `unsafe` or `unknown` with one
  sentence per reason under `because`: unsafe for a new contract error, a call
  whose target went or a channel left with one end, and a removed way in
  another service still calls; unknown for a service the base ref could not be
  read for, a new gap on a path from a change to a way in, or a `diff.json` too
  old to hold gaps. It lists `newGaps` by gap id with the method each is in,
  `vanishedTargets` (`{ caller, target, now }`), the ways in to `retest` ranked
  by the changed nodes each reaches and then by observed traffic, and
  `newFindings`, which never decide it (`fixtures/multi-repo-diff`). The
  `flowatlas diff` document gained two sections: each request that joined a
  route on the base side and joins nothing now, with what the head side says
  instead, and each channel left with no producer or no consumer; and the gap
  ids and findings the head has and the base does not. `lostJoins(base, head)`
  in the linker computes the first, for any two graphs.
- **Changed flows as sequence diagrams (P116).** After the impact, `flowatlas
  diff` gained a "Changed flows" section: each way in the impact lists, and
  each way in the branch added or removed, walked on both graphs and compared
  step by step, matched on what a step is rather than its line. Each changed
  flow gets a `<details>` with a Mermaid sequence diagram across the services
  (added steps green and prefixed `+`, removed ones red with the cross arrow
  and `−`, a changed body or confidence in a note, a guess said as `(best
  guess)`, a place the walk could not see past as `stops here: <reason>`) and
  the same steps as a `diff` block under it. New flags `--max-diagrams` (5),
  `--context` (3), `--sequence-detail service|class`, `--max-chars` (60,000:
  diagrams are dropped from the last back, then flows, each counted),
  `--no-diagrams` and `--max-flows` (50, the rest counted in a
  `flows-truncated` warning). `flowatlas flow --format sequence` draws the walk
  from one way in as the same diagram, without the marks, 16 hops unless
  `--depth` says (`--sequence-detail class` draws a participant per class).
  `what_changed` says what each changed flow does now: a way in under `entries`
  or `retest` whose flow changed gains `flow: { side, added, removed, changed,
  steps }`, and `counts` gains `flows` (`fixtures/multi-repo-diff`'s sixth
  edit: `orders` publishes `order.gift-wrapped` and `billing` takes it).
- **Architecture rules across services (P114).** `flowatlas.config.json`
  gained `services[].tags` and a top-level `rules` list: each rule a `name`, a
  `severity` (`error` by default), a `note` and one of four shapes - `forbid`
  (`from` must not reach `to`, in one hop or `transitive`ly), `only` (nothing
  outside `from` may reach `to`, a table's `op` too), `tags` (a service tagged
  `source` joins only services carrying one of `mayReach`) and `reachable` (a
  path that `must` exist, or must not) - over selectors by service, tag, way
  in, table, channel, route and node type, along the edges between
  repositories (`hits`, `http_calls`, `emits`, `consumes`, `queries`,
  `triggers`; `calls` when named). New command `flowatlas rules` (`--format
  text|json|markdown|github`, `--rule`, `--service`, `--fail-on`,
  `--max-nodes`, `--out`, `--list`) writes `rules.json` (`rulesFormatVersion:
  1`); each violation carries its path, the crossing hop's `file:line` and the
  weakest confidence, and one along a guessed edge fails a run only with
  `rulesSettings.failOnHeuristic`. A rule naming nothing is listed as not
  checked (`rule-matches-nothing`), never passed; one over a service read in
  part says so (`rule-over-partial-read`); one that fails its schema is refused
  naming it (`rule-invalid`). `doctor` gained a `rules` section (`--no-rules`;
  `--strict` fails on a new violation at `error`), `flowatlas accept
  rule:<name>` excuses violations, `flowatlas diff` gained a "Rules" section
  and `--fail-on-rule-break`, and the MCP server a `check_rules` tool,
  `violates` on `get_flow` steps, a "Rules it breaks" section in
  `describe_for_prompt`, `rules` counts on `start_here`, a `rule` kind in
  `findings` and a verdict that is `unsafe` on a new rule violation
  (`fixtures/multi-repo-rules`).
- **An `only` rule that reaches through (P203).** `only` takes `reach:
  "direct" | "transitive"`, as `forbid` does. Transitive, "only billing may
  reach the payments table, even through other services" is one rule:
  whatever `from` reaches acts for it (a workflow it starts, a route it calls,
  a handler of a channel it publishes onto), and a violation is a path into
  `to` that does not go through `from`, reported where it starts, at the
  nearest node `from` neither selects nor reaches, with its path and its
  weakest confidence; a gateway in front of that node is not reported again.
  A `via` without `emits` and `consumes` leaves channels out of what acts for
  `from`. `fixtures/multi-repo-rules` gained `only-gateway-reaches-billing`:
  `orders` publishing what billing consumes breaks it, which a direct `only`
  cannot see.
- **SARIF output for code scanning (P115).** `contracts`, `dead`, `cycles`,
  `rules`, `doctor` and `diff` gained `--format sarif`: one SARIF 2.1.0 run per
  command, under the category `flowatlas/<command>/`, which GitHub code
  scanning shows on the lines of a pull request, keeps open while the finding
  is there and closes when it is fixed. Every `ruleId` is a code already in use
  (a doctor reason, a marker code, a contract finding kind, `dead-entry`,
  `dead-channel`, `dead-provider`, `dead-field`, `cycle`, `no-way-in`, and
  `rule/<name>` for an architecture rule), described from the hint catalogue.
  One level map: contract and rule severities as they are (`info` → `note`), a
  gap or finding row at `action` a warning and at `info` a note, a call that
  lands nowhere and a wrong annotation errors, a dead row a note, a cycle a
  warning; a note row (P81) and a place with nothing to join are never
  written. Paths are the ones the configuration's directory sees (as `doctor
  --format github` writes them since P191); a contract finding sits at the
  sender's line with the receiver as a related location, a rule violation at
  its crossing hop with its path, and a cycle with its hops, as a code flow; a
  finding with no file sits at the line of `flowatlas.config.json` naming its
  service or rule. `partialFingerprints` (`flowatlas/v1`, and
  `primaryLocationLineHash` from the same key) come from the keys the baseline
  already uses, so moving a line keeps an alert open. A row the baseline holds
  is `unchanged` and one it does not `new`; a row `accepted.json` names, a
  violation it excuses and a contract finding `@ContractIgnore` or
  `contracts.ignoreEdges` excuses are written suppressed with why; `diff`
  writes the new (`new`) and fixed (`absent`) contract findings and rule
  violations. `--output <file>` writes the log there and prints one line about
  it, `--sarif-root <dir>` writes paths relative to one checkout (and leaves a
  result in another out, counted), `--sarif-level` leaves quieter results out,
  and a log holds at most 5,000 results unless `--max-nodes` (`--max` on `dead`
  and `cycles`) says otherwise, saying how many were cut and where the whole
  report is. The format changes no exit code. `docs/ci.md` gained a "Code
  scanning" workflow; `toSarif` and the adapters are exported from
  `@flowatlas/cli`.
- **`flowatlas check --env <name>`: can this be deployed there (P117).** A
  committed `flowatlas.deployed.json` (`deployedFormatVersion: 1`, path
  `deployed.file` in the configuration or `--pins`) says which ref of each
  service runs in each environment; `--pin <service>=<ref>` and
  `FLOWATLAS_PIN_<SERVICE>` lay a pipeline's own versions over it. `check`
  reads every service at its pin (the deployed side), puts the services being
  shipped (`--service`, or every one whose head differs from its pin) at
  `--head` or the working tree, runs what `diff` runs on the two and answers
  `deployable` (exit 0) or `not deployable` (1) for what deploying introduces:
  a new contract error, a new rule violation at `error`, a call a deployed
  service makes to a route the candidate removes (with the caller's file and
  line), a channel left with one end, a new handler of a channel nothing
  deployed publishes, and a new request no deployed route serves. What already
  ran wrong is listed under "already deployed" and never fails it. A pin that
  does not resolve, an unknown environment and a service in a subdirectory of a
  repository exit 2, naming `git fetch --tags` in which repository, and are
  never read as the working tree in their place. `--env` is repeatable (one
  section each, the worst exit); `--format text|markdown|json|sarif`; every
  environment leaves `check.<env>.json` (`checkFormatVersion: 1`) holding the
  whole `diff.json` of its two sides. The graph cache is `diff`'s.
  `flowatlas deployed set <env> <service> <ref>` records a deployment in the
  pins file (`--resolve` records the commit the ref names); `deployed show
  [env]` prints each pin with its commit, kind and age, and warns of a branch
  and of a ref the repository does not have. `what_changed({file:
  "check.prod.json"})` reads a check document like a diff, with `check: {
  environment, verdict, because }`, and `start_here` says each environment's
  verdict in one line and leads `next` with the first one not deployable.
- **A new handler of what nothing publishes is a lost join (P117).**
  `lostJoins` also names a consumer the head side added to a channel nothing on
  the head side publishes (`kind: 'no-producer'`, `now: 'never-produced'`), so
  `diff`'s "Calls that stopped joining" and `what_changed`'s verdict say it
  too. `buildAtRef` gained `refFor` (a ref per repository) and `fallback:
  false`.
- **`flowatlas diff --env <name> [head-ref]` (P193).** The comparison `check`
  makes, without its verdict, for a reviewer who wants the changed flows
  against production in a pull-request comment: the base side is each service
  at its pin, read as `check --env` reads it (`--pin`, `--pins` and
  `FLOWATLAS_PIN_*` as there), and `diff.json`'s `base.ref` is the
  environment's name; every section equals the check document's `diff`. The
  Markdown opens with the pins. A pin that does not resolve exits 2, never
  assumed unchanged; `<base-ref>` and `--env` are exclusive.
- **`flowatlas diff --section <name>` (P226).** Only those parts of the
  Markdown, repeatable: `impact`, `flows`, `docs`, `contracts`, `api`,
  `rules`, `joins`, `gaps`, `types` or `graph`, in the document's order and
  without its heading, side table and footer, so `diff main --section impact`
  answers who would notice in a terminal. The warnings stay, since what could
  not be read qualifies every section; `diff.json` is whole either way, and
  `--section` with `--format json` or `sarif` exits 2.
- **Docs tied to flows (P120).** `flowatlas docs [paths...]` reads Markdown
  blocks that name a flow, a channel or a symbol by its graph id (`<!--
  flowatlas:flow id="POST /orders" view="sequence" -->` … `<!--
  /flowatlas:flow fingerprint="…" -->`, and `<!-- flowatlas:ref id="…" -->`
  before a mention in prose). `--write` regenerates the content between the
  markers, in place and nowhere else, in one of six views: `steps`, `mermaid`,
  `sequence`, `prompt`, `contract` and `tour`, whose notes are kept by step and
  never deleted. `--check` exits 1 when a block is `changed` (the steps it
  covered were added to or removed since it was written, each named), `gone`
  (with the nearest names) or `ambiguous`, and 2 on a marker it cannot read;
  `--format github` writes a `::warning` at each block. The fingerprint is of
  what the block shows, not its text, so a reformat never fails it. Every run
  writes `docs.json` beside the graph (`docsFormatVersion: 1`); the
  configuration gained `docs.files`. `flowatlas diff` gained **Docs this
  branch makes stale**; `get_flow`, `describe_for_prompt` and `impact` gained
  `docs` (the blocks about the node, each checked when asked), `start_here`
  gained `staleDocs`, and the page's details panel lists the docs that
  describe a node (`fixtures/multi-repo/docs`,
  `fixtures/multi-repo-diff/base/docs`).

#### API documents and catalogues

- **`flowatlas spec`: OpenAPI and AsyncAPI documents from the graph (P118).**
  An OpenAPI 3.1 document of each service's routes (one per application) and
  an AsyncAPI 3.0 document of each service's channel ends, written to
  `<output>/spec/` from what the graph read: paths with their parameters'
  names, query and header values, bodies and answers expanded from the type
  registry into JSON Schema 2020-12 through the contract check's wire rules,
  one response per failure status (a helper's choices each under theirs), the
  guards in front, the public mark, and on every operation where it was read,
  how surely and who calls it (`x-flowatlas-*`). A delivery's wrapping is
  `x-flowatlas-envelope`. What could not be read is left out and counted, or
  `{}` with `x-flowatlas-unread`; each document is read back through the
  reader of its format before it is written (the OpenAPI reader takes `2XX` as
  a success answer after every exact 2xx code, so a document flowatlas wrote
  reads back with its answer). `--check` fails when a committed copy is out of
  date; `--inventory` writes one table of every route (guarded, public,
  callers, tables written, channels published, fails). The MCP server gained
  `get_spec` (a service's document, or one route or channel end with the
  schemas it uses, as JSON text bounded by `maxChars`) and
  `describe_for_prompt({withSpec})`, which carries a route's fragment.
- **`flowatlas spec diff <base> [head]` (P118).** Both sides' documents,
  written in memory and compared operation by operation, each change one kind
  of a fixed catalogue modelled on oasdiff's (`endpoint-removed`,
  `request-property-added-required`, `response-property-removed`,
  `channel-removed`, ...) with the callers it breaks on the base side; a
  breaking change no caller in the project reaches, on a route nothing marks
  public, is a warning saying so. `--fail-on`, `--format
  text|markdown|json|sarif` (`spec/<kind>` rules), `spec-diff.json`.
  `flowatlas diff --spec` adds the same table as "API changes".
- **`flowatlas spec --against <service>=<file>`: a committed document against
  the code (P195).** A hand-written OpenAPI or AsyncAPI document, YAML or
  JSON, is read through its reader, written back in the code's normal form and
  compared with the document written from the graph by `spec diff`'s
  catalogue, the document as the base side: a route or channel end the
  document declares and the code no longer answers is an error at the
  document's line, one the code answers and the document leaves out is said,
  and a field the two disagree on is named, with the query and header values
  and failure statuses the document declares compared too. Descriptions,
  guards and formats are not compared. `--format text|markdown|json|sarif`
  (command `spec-against`), `--fail-on`, `spec-against.json`
  (`specAgainstFormatVersion: 1`). The new `services[].apiDocuments` lists a
  repository's committed documents; `contracts` compares each in a section of
  its own and fails on a broken promise at `--fail-on`
  (`fixtures/nest-committed-openapi`).
- **`flowatlas export backstage` and `flowatlas export structurizr` (P119).**
  The map written into the tools that already keep one, from the joins the
  graph made and nothing else. `backstage` writes a `Component` per service
  (`service`, `website` or `function`), an `API` per service and kind pointing
  at the OpenAPI or AsyncAPI document written beside it, `Resource`s for the
  tables queried (one per table, owned by its writer) and the hosts called, and
  one `Location` listing every file; `consumesApis` comes from requests into
  another service's routes and deliveries off channels another service
  publishes, `dependsOn` from queries, outside hosts and functions started by
  name. Owner, lifecycle and system come from the new `services[].catalog`
  (`owner`, `lifecycle`, `system`, `description`, `sourceUrl`) and are
  `unknown` (and listed) when nobody wrote them. `structurizr` writes a DSL
  workspace: a container per service, store and channel prefix, the hosts
  outside, relationships described by what crosses them (collapsed past
  `--max-labels`), the container view, and a dynamic view per flow in call
  order (`--flow`, `--max-flows`). Only `static`, `declared` and `marker` joins
  by default; `--include-heuristic` draws the rest, marked. Files go to
  `<output>/export/<kind>/`, never into a configured repository, the same bytes
  every run; `--check` writes nothing and fails when a committed copy is out of
  date, naming the first relation that differs; `--json` prints the entities
  or the model.

#### The page

- **A Steps tab (P64, P74).** One way in as a list in call order, indented by
  depth: each step with a kind mark and its table, address template or channel
  inline, calls side by side and calls per item marked, a likely N+1 flagged,
  failure paths in red, a red row where a chain breaks (no route, no handler,
  an address not read), and best guesses marked. Its heading lists what the way
  in can fail with, as the ways-in list and the details panel do too, and the
  step that throws is marked; a scheduled way in shows its expression and zone,
  and each step's log lines are folded under it. Hovering a row lights its node
  in the Graph tab.
- **Copy as prompt (P67).** On the Steps tab, a channel and a check row, and
  from the graph server as `describe_for_prompt({id})`: bounded Markdown with
  what is in front of the way in, what it can fail with, its schedule, the
  steps with repo-relative `file:line`, shapes in and out, log lines, open gaps
  with their reasons and the ids to ask next. No source code. Rendered by the
  pure `describeForPrompt`, exported from `@flowatlas/mcp` (see P97 under
  Changed for the one renderer both sides now share).
- **One search box, a Busiest tab and a Changes tab (P73).** The search box
  above the tabs finds a route or other way in, a channel, a table, a type, a
  gap or a class, and under *Fails with* the ways in that can fail with an
  exception or a status; a hit opens where it is (see P101). Busiest ranks
  methods as `flowatlas hotspots` does, with how many ways in reach each, how
  far the nearest is, and its own service's edges against all of them.
  `visualise --diff <ref>` runs `flowatlas diff` and adds a Changes tab: routes
  added and removed, removed routes something still calls and who calls them,
  shapes that moved, new contract findings, and the unresolved count on each
  side.
- **A class, a file or a service as one prompt (P95, P134).**
  `describe_for_prompt` takes `scope`: `class` writes every method of a class
  with the ways in that reach it and its own chain, sharing `maxSteps`; `file`
  every node of a file under the class it belongs to, the gaps in the file and
  the ways in that reach it; `service` its ways in by kind, its crossings to
  and from each other service worst verdict first, its channels, its findings
  ranked as the `findings` tool ranks them and its most common gaps. A scope a
  node does not have is an error naming the ones it has. On the page, the
  Graph tab's details panel has *Copy as prompt* on every node and a `⋯` beside
  it that copies the node's class, its file or its service, and a service's
  box on the Map copies the service: each the text `describe_for_prompt`
  writes, character for character (`steps.js` gathers all three scopes, and the
  parity test compares every service of every built fixture). The pack gained
  `overview`: the project's findings, ranked where the database is, and the
  contract verdict of each crossing that is not unchecked (about 2% of the
  pack over the fixtures).

- **One request read "1 hits".** A route's details on the page and
  `describe_for_prompt` said "1 hits are too few to say a declared failure was
  never seen" and "Run time: 1 hits"; one is a hit now.

#### The graph server (MCP)

- **Every answer hands on the next question (P63, P72, P75).** Every answer
  ends with `next`, the calls that take the ids it returned, and the server
  instructions spell out the chains (entry → flow → source, channel →
  publishers and handlers → flow, symbol → impact). New tools: `start_here`
  (counts per service, the commonest gaps and the entry ids to begin from),
  `describe_for_prompt`, `search` (routes, channels, tables, types, gaps,
  `fails` and classes in one query), `what_changed` (the last `flowatlas diff`,
  read back from `diff.json`) and `cant_follow`. `who_calls`, `impact`,
  `who_emits` and `who_consumes` take the same optional `service` filter
  `list_entries` and `find_symbol` already did.
- **Lists read a page at a time, and structured answers (P93).**
  `list_entries`, `find_symbol`, `search` (every kind from one offset),
  `who_emits`, `who_consumes`, `impact`'s entries, `what_changed`'s lists and
  `cant_follow`'s causes take `offset`, and a cut answer says `total`,
  `nextOffset` and `n more; next page offset k`, with that same call first in
  `next`; an offset past the end is an empty page with the total. `get_source`
  takes `fromLine` and `maxLines` (at most 400) and says `truncated:
  "declaration continues past line N; ask with fromLine N+1"` where it had
  stopped a long declaration at 400 lines with an `endLine` that read as its
  end. Every answer also goes out as `structuredContent`, and `start_here`,
  `list_entries`, `find_symbol`, `who_emits`, `who_consumes`, `get_type`,
  `get_source`, `search` and `cant_follow` declare an `outputSchema`; every
  tool is annotated `readOnlyHint`, `openWorldHint: false` and
  `idempotentHint`, and an answer that is an error carries `isError`.
- **`dead`, `findings` and `type_usage` (P95).** `dead({id})` says whether a
  way in, channel, class, method or function is dead, with a verdict (`dead`,
  `likely-dead`, `unknown` or `alive`) and the evidence that could make it
  wrong: the requests read in part that could reach it (`couldHit`), the
  requests that found no route one segment off it (`oneOff`, `cancel for
  archive`), what is outside the project (`outside: cron`, `probe`, `stream`,
  …), or one caller of an alive node; `dead({service, kind})` lists the rows
  `flowatlas dead` lists, verdict first, paged. The analysis moved from the CLI
  into the linker, so the command and the tool read the same functions (a test
  compares them on three fixtures). `findings()` counts every finding by kind -
  likely N+1 loops, unguarded routes, contract errors and warnings from the
  last `flowatlas contracts`, channels with one end, and every other finding
  reason - with the top three of each, ranked by reach, each row with the call
  that shows it; `findings({kind})` lists one kind, paged, the per-item loops
  counted as `notes`. `type_usage({type})` lists every way in that takes or
  returns a type, each crossing, publish, subscription and call that carries
  it, and the types holding it one level out; a name two types have answers
  `candidates` (`fixtures/multi-repo`, `fixtures/loops-worth-fixing`,
  `fixtures/cant-follow`).
- **`who_calls` and `impact` on a class (P95).** Asked about a class, both
  answer for the methods of it something calls, where they had answered
  nothing, since calls point at methods; each caller names the method it calls
  (`calls`), and `impact` says how many methods it answered for
  (`forMethods`).
- **Prompts and resources (P96).** `before-rename`, `pr-review` and
  `trace-route` write out the calls those reviews take, ids resolved, with the
  same call strings `next` uses; a name answering to several lists each
  candidate. `flowatlas://reasons` lists every reason with its kind, cause and
  `doctor`'s sentence, `flowatlas://services` the services, and
  `flowatlas://services/{name}` one service's summary, crossings and top
  findings.

### Changed

#### The package

- **`engines.node` is `>=22.12.0` (P86)**, what `commander` 15 and
  `better-sqlite3` 13 already needed; 0.5.1 said `>=20` and failed on Node 20
  anyway.
- **No `types` entry (P86).** The manifest pointed `types` at a
  `dist/index.d.ts` that never shipped; the field is gone.

#### Counting and levels

- **Gaps, notes and findings counted apart (P81).** Every unresolved row is
  one of three kinds, derived from its reason (`kindOfRow`, `ROW_KINDS` in
  `@flowatlas/core`, no schema change): a gap (the reader could not follow
  something), a note (how a join or a reading was made: `base-url-from-files`,
  `base-url-from-name`, `environment-from-files`, `package-from-repo`,
  `package-version-differs`, `shape-file-unmatched`, `route-checked-in-body`,
  `route-mount-assumed-empty`, `route-api-guessed`, `workflow-named-by-file`,
  `document-age` and the like) or a finding (something about the code:
  `query-in-loop`, `route-unguarded`, `route-shadowed`, `route-claimed-twice`,
  `s3-write-matches-nothing` and the like). Only gaps count as missed
  (`wasMissed`), and one function counts them all (`countsOf` → `{missed,
  sites, notes, findings, nothing}`), so the build line, `stats`, doctor, the
  page and the graph server say the same numbers for one database. A request
  joined from the value a file gives its setting (P77) is a note, so `missed`
  goes down by the request it joined, and a likely N+1 (P69), once printed as
  "nothing to join" and counted nowhere, is a finding. The build line became
  `missed: N over S sites · notes: N · findings: N` (and the watch line
  `missed: N`); `LinkReport.totals` gained `missed`, `sites`, `notes` and
  `findings`, with `totals.unresolved` kept equal to `missed` for one version
  and deprecated, and readers of a stored report fall back to it. Doctor's
  heading says the three figures, findings get a line of their own (`2
  findings: 1 likely N+1, 1 route with no guard`), a group of notes or findings
  is marked `(note)` or `(finding)`, and `doctor.json` gained
  `unresolved.notes`, `unresolved.findings` and a `kind` on each group;
  `unresolved.info` and `unresolved.nothing` count gaps only. The page's "Left
  unresolved" became "Missed", with "joined from files" and "findings" under
  it. `start_here` gained `counts: {gaps, sites, notes, findings, nothing}` and
  lists only gaps among `topGaps`; `search` gap hits gained `kind`;
  `cant_follow` counts notes and findings apart under `apart`. A doctor
  baseline keeps counting every actionable row, findings included, so no
  baseline changes verdict on upgrade; only its `info` and `nothing` tallies
  were recounted by kind. The read gate fails on a reason doctor knows with no
  kind.
- **A row's kind stored on the row (P208).** `graph.db`'s `unresolved` table
  gained `kind` (gap, note, finding) and `risk` (a finding's auth, performance
  or wiring), written once by `kindOfRow`, which stays the one place a kind is
  decided; the database records `db_format_version` 2
  (`GRAPH_DB_FORMAT_VERSION`). Doctor, the page's pack, `stats`, the SARIF log,
  the diff's gap references and the MCP server's `start_here`, `cant_follow`,
  `search` and prompts read the stored answer (`rowKindOf`, `rowRiskOf` in
  `@flowatlas/core`); a database written before the columns, a graph file's
  rows and a row made at read time are decided as before, so every answer is
  the same. Nothing printed changed. `SCHEMA_VERSION` (6) and the build cache
  (5) are unchanged: the database is written whole on every build.
- **`query-in-loop`, `package-from-repo` and `shape-file-unmatched` at `info`
  (P81).** They had been written at `nothing` only to stay out of the count of
  what was missed; their kind does that now, and `nothing` again means only a
  place with no edge to draw.
- **Fewer `route-unguarded` rows (P76).** A route covered by an app-wide guard,
  or opened by a public-sounding opt-out decorator on the handler or its class,
  no longer has a row; an opt-out that switches one check off makes it
  `route-guard-skipped`; and a route with no guard whose own code throws a 401
  or 403 is `route-checked-in-body` at `info`, naming the throw. The
  `route-unguarded` hint names accepting by rule.
- **`unknown-base-url-env` says more (P77):** which values were found where,
  and which files set the setting without being read.

#### Reading code

- **What a route fails with is what it can answer (P87).** Under a global or
  `@UsePipes` `ValidationPipe`, a route lists the 400 only when its handler
  takes a `@Body`, `@Query` or `@Param` typed as a class; any other pipe in
  front of a route only when the handler takes a value pipes are handed. A
  project's own error class that states its status (`readonly status = 404`, a
  getter, `getStatus()`, or what its constructor stores from `super(...,
  409)`) is answered with that status where an exception filter in front of
  the route (`useGlobalFilters`, `APP_FILTER`, `@UseFilters`, matched by its
  `@Catch`) reads it off the exception; a filter answering a fixed status gives
  that one. A guard written in the project keeps its synthetic 403 only where
  its `canActivate` can answer anything but `true`, and one extending
  passport's `AuthGuard(...)` answers 401. A status written nowhere on the path
  - an unknown error's 500, a declared status nothing maps (kept in
  `declared`), a filter whose answer cannot be read - gains `assumed: true` in
  `meta.fails`, and a filter of that kind is a `fails-filter-unread` row at
  `info`. `meta.fails` stays one row per site; every reader groups it:
  `get_flow`'s `fails` is one entry per (status, exception) with `sources`,
  `sites`, `loc` and, at `detail >= 2`, `places`; `describe_for_prompt` writes
  one line per group (`- **404** \`LoanNotFound\` — throw ×6, first at ...`),
  capped by `maxFails` (12); a `fails` search hit is one per route; the page's
  error card and *Copy as prompt* list the groups with counts, draw an assumed
  status as `500?` and keep the places behind a disclosure
  (`fixtures/nest-fails-accurate`).
- **A check thrown through a helper (P90).** `throw toHttpError(check)`, where
  the helper picks the exception from a table at run time, is read through the
  helper (a function, a method of the class, a member of an object of
  functions, a method of an injected class), a `const` it is held in and an
  `await`: the failure is named after the helper, with `via: 'helper'` and
  `chosenFrom: [{exception, status}]` (an object or `Map` of classes, a table
  of built exceptions, a `switch` or ternary, one more helper down), each
  choice answered through the filters, and `status` only where every choice
  agrees. A helper whose answer cannot be read, under an `if` that tests what a
  check of who is asking answered (`soundsLikeAuthCheck` in the core), is
  `family: 'auth'`. The route audit counts either as `route-checked-in-body`,
  naming the helper and its statuses; a table of 404 and 410 stays
  `route-unguarded`. `get_flow`, `describe_for_prompt` (`toHttpError (401 |
  403 | 423)`), search and the page show the choices
  (`fixtures/nest-check-through-helper`).
- **N+1 that is worth fixing (P89).** `query-in-loop` is one row per loop, at
  the loop's line, naming every query, cache call, request and publish it
  reaches (`meta.reaches: [{id, type, words, via?}]`, nearest first, eight at
  most with `reachesCut` counting the rest), where it had been one row per
  call. A loop bounded on purpose writes no row: chunks (a constant step above
  one, a `slice`/`splice` of a constant size, a list from `chunk`, `batches`
  and the like or a helper named under `callShape.boundedCalls`), pages and
  cursors (`while (hasMore)`, `do … while (token)`, `skip`/`take` or a cursor
  key handed to the query, a `while (true)` that stops on a short page),
  retries (a constant number of tries left on success), literal lists, loops
  around nothing but batch calls, and loops in a migration. Each keeps
  `meta.inLoop.bounded` on its edges and is counted in the repository's
  `stats.loopsBounded`; `flowatlas stats` prints `loops set aside: chunk 1 ·
  page 2 · …`. A loop whose every leaf is a conditional write (a filter naming
  a state besides the id, an SQL `UPDATE … AND col =` or `RETURNING`, a helper
  named under `callShape.conditionalWrites`) or a send to one recipient (a
  producer described with `perItem: true`, a request to a host under
  `callShape.perItemHosts`) is a note (`meta.severity: 'note'`); the rest are
  `likely` findings. Each row carries `meta.waysIn` and `meta.entries`, the
  ways in of its service that reach the loop, and doctor, the MCP `search` and
  `describe_for_prompt`, and the page's Busiest view list the likely loops
  most-reached first; the Steps view says *likely N+1* only for those. Query
  nodes gained `meta.batch` and `meta.conditional`, and producers `meta.batch`
  (the SDK's batch sends and writes) and `meta.perItem`, from the descriptors
  (`fixtures/loops-worth-fixing`; `nest-query-loop`'s rows moved to the loop
  lines).
- **One table, one name (P88).** A TypeORM entity whose `@Entity('orders')` or
  `@Entity({ name: 'orders' })` states its table is drawn on that table through
  `Repository<Order>` too, where it had been the class name `Order`; the class
  name stays the default, and the declared name moved to `meta.entityType`.
  Snapshots of `nest-typeorm`, `nest-query-loop`, `fn-data-layer`,
  `multi-repo`, `multi-repo-contracts`, `nest-route-access` and
  `nest-check-through-helper` moved with it.
- **No row where an edge explains the call (P88).** A call that reads as data
  only by its receiver's name, and that the graph draws as a `static` call into
  a method of the service's own, is no longer a `db-receiver-name-only` row:
  its queries are read where that method writes them. Each is counted as
  `receiversExplainedByEdge` in the repository's stats, and `flowatlas stats`
  prints `receivers explained by a drawn call`. A base named in
  `localBaseClasses` as a bare string has its `tableProperty` read off its own
  queries where they state it (`fixtures/nest-mongo-tables`).
- **A subscription described in configuration is matched on what the source
  states (P121).** A `broker.custom` subscriber on a receiver whose type is not
  installed was read only where the checker resolved it; it is now matched on
  the annotation or the construction that names the class, as a described
  publish already was, and its `consumes` edge is `heuristic`. A described
  table access (`db.tables`) and a described subscription withdraw the
  `call-dynamic-receiver` row at their call, as a described publish did
  (`fixtures/data-kit-tables`: seven fewer places).
- **A verb nobody read is not `GET` (P91).** A request whose verb a caller
  hands in and nothing can read keeps `method: null`, joins nothing and is an
  `api-method-dynamic` row; on the server it had been recorded as `GET`. A
  caller handing in the verb no longer has its second argument read as the
  body. Snapshots of `nest-forwarded-verb`, `nest-client-wrapper`,
  `koa-react-full-stack`, `react-client-base` and `react-local-client` moved
  with it; `ground-truth` and `multi-repo` gained `routes.nearMissed`.
- **Each function URL's entry is keyed by its function (P54)**,
  `http:ALL:/*@<function>`, so two URLs in one repository no longer merge into
  one entry.
- **A write's recorded value that is written and not read is kept as an empty
  list (P56)** rather than left out, so a version named by a variable still
  counts as named.
- **The graph database keeps each unresolved row's meta (P75)**, in a new
  `unresolved.meta` column. An older database without it is still read,
  without causes.

#### Commands and file formats

- **`flowatlas dead` prints a verdict, and tells routes called from outside
  apart (P91, P95).** Every entry row gained `class` (`actionable`, `stream`,
  `infrastructure`, `declared`), `why` (the rule that put it there) and `role`
  for infrastructure (`probe`, `webhook`, `callback`, `discovery`,
  `configured`). Infrastructure takes the probes, webhook and callback
  receivers by path (at any depth), a `@HealthCheck()` handler, a handler or
  controller named for what it answers, and what
  `dead.infrastructure.{paths,decorators,names}` names (`builtIn: false` turns
  the built-in rules off); a route marked `@flowatlas-public` is `declared`,
  like one under `doctor.publicRoutes`. The table lists the actionable rows and
  folds every other class into one line (`4 infrastructure routes: 2 probes, 1
  callback, 1 webhook`); `--class` lists one. The entries table's verdict
  column says `dead`, `likely-dead` or `unknown`, the channel and provider
  tables gained one, and a route a request one segment off named is listed with
  that request beneath it. In JSON every row gained `verdict` and `evidence`
  (the near miss under `evidence.couldHit`). Infrastructure, stream and
  declared routes are `unknown`, with `outside` saying why; a class in a
  service with unresolved injects is `likely-dead`. The Map counts
  infrastructure apart from the routes nothing calls. A NestJS entry gained
  `meta.controllerDecorators`.
- **`diff.json` is format 5 (P96, P116, P114, P118).** Format 2 added
  `unresolved` (the gap ids and findings each side has that the other does
  not) and `joins.lost`; format 3 `flows`, one per way in walked, with its
  participants and its steps, each `same`, `added`, `removed` or `changed`;
  format 4 `rules: { new, fixed, existing, excused }`; format 5 `spec`, the API
  changes with `--spec` and `null` without it. Every older format is still
  read without the sections it predates, and one from a newer flowatlas is
  refused by name. The verdict reads no flows and no spec, so a format-2 file
  is not `unknown` for lacking them; a file without `rules` makes it
  `unknown`.
- **`flowatlas.baseline.json` is format 2 (P114).** It gained `rules`, the
  keys of the rule violations accepted; a version-1 baseline is still read, as
  one that accepted none. `doctor`'s summary line gained `rules: errors=N
  new=M`, and `--section` a sixth value, `rules`.
- **`flowatlas diff`'s documented defaults (P190).** `docs/CLI.md` said
  `--max-entries` 20 and `--max-nodes` 50; the command has always used 150 and
  100, which the reference now says.

#### The page

- **The page opens on the product (P98).** The masthead and the band are one
  strip: the name, then a pill per figure, whose meaning is its title and the
  line under the strip while it is open; a pill whose total is nought is not
  drawn, except *Missed* and how many repositories were read. The build's
  timings fold into *build · <total>ms · <n> services*, slowest first; the
  sentence under the name moved to the foot of the page. Past twelve services
  the rail becomes one *Services* button and a checklist with a search, *All*
  and *None*. The tabs' row sticks to the top while a tab scrolls, and on a
  narrow screen the tabs come before the ways in. Every tab gained an address,
  `#<tab>[/<way in>][/reason=<reason>]` beside the map's and the graph's;
  moving between tabs rewrites it, picking another way in adds to the history,
  and Steps and the table tabs gained *Copy link*. A first visit offers a
  *Start here* card naming the busiest way in, the worst gap and, with
  `--diff`, the latest change, each worked out from the graph and each a link.
- **One Steps view (P99).** The Walk tab is gone: Steps is the page's one view
  of a way in, and everything that opened the Walk - a way in clicked on the
  left, *Open in Steps* in the Graph's details, Start here, an old
  `#walk/<key>` link - opens Steps on the same way in. Steps draws in one
  vocabulary of step kinds, now with `view` (screen), `act` (user action) and
  `cfg` (reads config), in a neutral chip, the service being the colour of the
  row's rule; the legend lists every kind. A crossing into another service is a
  row of its own (*→ orders · requests*, trust only when not read from code),
  and guards are said under the step they stand in front of. A switch on the
  bar, remembered in the browser, draws the steps *compact* (a line each, the
  file by its name, only the marks that change the reading), *detailed* (every
  mark, the full path, logs, and the settings a step reads as leaves) or as a
  *waterfall*: a bar per step in its service's colour, laid out in steps, not
  time, on an axis that says so. The steps above the Graph's drawing and the
  command list follow the switch. The line under a cut list says whether the
  depth or the 300 rows left steps out, and the second has a button for 300
  more. `stepsOf` rows gained `start` and `span` and the result `cut`.
- **Not joined is split by what a row is (P100).** The tab's one table became
  three sections, each with its count and a line on what would appear when
  empty: *Couldn't join* (gaps by reason, with the breakdown by cause and
  package folded under them), *Risks* (findings, grouped *who may ask*,
  *likely N+1 and cost*, then *wired wrong or meeting nothing*) and *Accepted*
  (each rule once, then every accepted row with its note), which replaced the
  *show accepted* checkbox. The split comes from the pack (`dicts.reasonClass`,
  a reason's row kind and risk, and `rowKinds` for a row of another kind than
  its reason's), never from the words of a reason, and a row's tone is its
  risk's. Notes left the tab, with one line saying how many and that `doctor`
  lists them. A reason row opens to every place it stands for, fifty at most,
  and each row and place has one `⋯` menu - *Copy as prompt*, *Copy accept
  command* for that place (a route by its route, another row by its file), and
  *Copy accept command for every row like this* where a rule takes more,
  always ending in `--dry-run`; what was copied is shown in a toast. The
  Graph's details rows gained the same menu. Core gained `riskOf(reason)`
  (`auth`, `performance`, `wiring`), `RISK_NAMES`, `RISKS` and
  `findingsWithoutRisk`, and the reasons gate fails on a finding with no risk.
- **The page speaks in words and has one search (P101).** A check row's
  reason, an edge's type and its trust are said in words - *route not found on
  the target*, *requests*, *best guess* - from one table (`PAGE_WORDS` in
  `frame.js`), the code kept in the tooltip, in the details panel beside the
  row, and in prompts, links and the MCP server. Trust is said only when it is
  not *read from code*: Steps lost its *certain* mark and Crossings shows the
  edge's verb with a chip only for a guess or an annotation. The Map says
  *problems to fix* for *rows to act on*, numbers its call-order columns from
  *step 1*, and counts a front end's screen actions as its ways in. The
  colophon says the page was read from code, and only with a trace that what
  was seen at run time is beside it. The global search is the only one: `/`
  reaches it, it gained the Graph tab's *Nodes*, and a hit goes to where it is
  in the tab open - a way in picked and opened on Steps or the Map, a node
  focused on the Graph, a gap on its Not joined row - marking where it landed,
  else opens the Graph; the Ways in list's filter box and the Graph's node
  search went, the first kept as the search's *Filter the Ways in list to '…'*
  and a chip over the list. The Graph's filters and checks moved into
  *Filters* and *Check* popovers. Crossings, Busiest and Changes hide the Ways
  in list. `?` lists every key from the table the handlers read (`SHORTCUTS`),
  and ⌘K (Ctrl+K) opens a command list of the tabs, the open tab's actions and
  a search.
- **The page on a phone, for the keyboard and a screen reader, and fast
  (P102).** On a narrow screen the tab row is one line that scrolls sideways
  inside itself, faded on the side that has more, the open tab kept in sight;
  under 360px, or when more than two tabs fall past the edge, a *View* select
  stands in for it. Below 640px the Map tab lists its boxes as cards under
  their call-order columns, each with its type, ways in, nodes and problems and
  what it reaches and what reaches it as buttons; *Show the drawing* (or full
  screen) draws the map. Every text colour reads at 4.5:1 or more on every
  ground in both themes (`--faint`, `--muted`, `--good`, `--warn` and the
  service hues adjusted, the fifth service hue an indigo); a service let out by
  the rail is dashed rather than faded. No text is under 12px but inside the
  drawings, whose node and column names are 12px at zoom 1. The tab row is a
  tablist the keyboard moves along (one tab in the Tab order, ← → and Home
  End), each tab tied to its panel; the page says `<html lang="en">`. A
  *Theme* button in the strip turns the colours from the system's to light to
  dark, remembered in the browser. A plain wheel over the Map or the Graph
  scrolls the page, saying once in the corner that Ctrl (⌘) and the wheel
  zoom; a pinch zooms, a drag pans, and in full screen the wheel pans as
  before. Crossings builds its rows a hundred at a time while the browser is
  idle; the Ways in list draws only the rows in sight, so its *N more* cut
  went; the search waits for a pause in the typing.
- **The Map laid out in call order by default (P66).** Services go in columns
  by call depth from the front ends, with queues and topics between the
  columns, stores and outside hosts under the app that uses them (one box per
  outside host, capped with `+n more`), and hovering a box dims what it does
  not touch. The layout by role stays, under *layout*.
- **A lighter page (P84).** The page ships each failure once: a guard's
  refusal, a pipe's 400 or a shared service's throw that stands in front of
  many routes is one record in `dicts.fails`, and each route a list of record
  positions. Log lines' levels and templates (`dicts.logLevels`,
  `dicts.logTexts`) and an unmatched span's service and kind
  (`observed.services`, `observed.kinds`) go through dictionaries too, each
  listing only the words that repeat enough to pay for it. Every view shows the
  same text. On the synthetic `fixtures/nest-shared-failures` (18 routes behind
  one guard, one pipe and one service) the failure data went from 7.6 KB to 0.5
  KB and the page's data from 18.2 KB to 11.1 KB; scaled to 258 routes, the
  whole page shrank by about 16%. The Busiest view works out how many ways in
  reach each row by one backward search per row shown instead of a forward walk
  from every way in; the numbers are the same. `HOTSPOT_EDGES` moved to
  `analysis/hotspots.ts` (still exported from `@flowatlas/cli`).
- **The page's source in modules (P103).** `page.html` keeps only its markup:
  its styles moved to `page.css` and its script to one module per panel under
  `src/visualise/panels/`, each a factory handed the page so far, written in
  through placeholders `PAGE_PARTS` lists in order. The page the command writes
  is still one file and draws the same thing on every fixture; the command
  refuses to write one with a part or a placeholder missing, and the built
  command ships `page.css` and `panels/` beside it. Every panel gained a test
  that mounts the page's markup in a small test document.

#### The graph server (MCP)

- **Twenty-six tools (P93, P95, P105, P106, P114, P118, P121, P122).** 0.5.1
  served ten; 0.6.0 adds `start_here`, `describe_for_prompt`, `search`,
  `what_changed`, `cant_follow`, `dead`, `findings`, `type_usage`, `hot_paths`,
  `slow_steps`, `trace_for`, `undeclared_failures`, `never_seen`,
  `test_pattern`, `check_rules` and `get_spec`. The run-time tools each say one
  short sentence with no output schema, and the server's instructions name
  them as chains. A test holds the list's size: the part a model reads (names,
  descriptions, input schemas) under 13,150 characters and the whole list
  under 32,700 (13,133 and 32,652 measured), each ceiling raised only with the
  tool that needed it.
- **A session is offered the tools its project can answer (P201).** Tools
  follow what the project has, not its frameworks: the five run-time tools are
  listed once an observed file is beside the graph, `check_rules` once the
  configuration has `rules`, `what_changed` once a `diff.json` or a
  `check.<env>.json` is there, `who_emits` / `who_consumes` and `get_type` /
  `type_usage` once the graph holds a channel or a type, `check_contract` once
  something crosses between services (or traffic was observed), `get_spec` once
  there is a route or a channel, `get_source` when the server knows the
  repositories, and `test_pattern` when the readers are there; the other eleven
  always. One table in the server (`tool-needs.ts`) says what each tool needs
  and where that is read, and the server refuses to start with a tool missing
  from it. The list is decided again before every list and call, when a build
  replaces the graph, and every two seconds while a client is connected, and the
  server sends `tools/list_changed` (declaring `listChanged`), so after a first
  `flowatlas observe` the run-time tools appear without a restart. Before any
  graph only the always-listed tools (which say to build one) and
  `test_pattern` are listed. `start_here` says in one line under `hidden` which
  tools are not listed and when each appears, and a call of a tool not listed
  is a failed call saying what it needs (`needs`). The multi-repo fixture,
  with no observed file and no rules, is offered nineteen tools: 10,081
  characters read and 28,543 in all, against 13,133 and 32,652 for the whole
  list. An `mcp` block in `flowatlas.config.json` tunes it (`tools: "auto" |
  "all"`, `include`, `exclude`; a name that is no tool is a configuration error
  naming it and the nearest), and `flowatlas mcp --all-tools` lists every tool.
- **Smaller answers (P93).** Every answer is written as compact JSON, and each
  fact once: a `cant_follow` place is `{ loc, id?, symbol?, service? }`, a
  `check_contract` finding `{ severity, kind, direction, field, expected,
  actual, message, ignored? }` without the edge the answer names at its top, a
  repeat in a tree `{ id, ref: true }`, and a row of `get_flow` or `who_calls`
  leaves `service` to a parent of the same service. `get_type` and
  `what_changed` apply `detail`, which they had taken and ignored: `get_type`
  at 0 names the type and its fields, at 1 (the default) says what each field
  is and names the nested types, at 2 adds the hash, `meta` and the nested
  declarations; `what_changed` at 0 gives ids, at 1 service and label, at 2 the
  changed fields. `detail`, `maxNodes`, `offset` and `service` are described
  once in the server's instructions. The MCP snapshots of `fixtures/multi-repo`
  came to 38% fewer characters, and to half on the trees. `get_type`'s `next`
  names `type_usage` first, a class's hints add the class prompt, and
  `cant_follow` asked about a finding's reason points at `findings({kind})`
  (P95).
- **A `get_flow` that reaches the other end (P92).** The walk expanded a node
  again under every path that reached it, so a repository helper and a logger
  every method calls were written out once per caller, and on a large graph the
  150 rows were gone before the request reached the service it ends in. Each
  node is now expanded once: met again it is `{ id, ref: true, seenAt }`, with
  `seenAt` the row its subtree is under (a cycle stays a bare reference). The
  budget goes to the steps that leave the service first, then stores,
  handlers, calls into a method that leaves the service, other calls, and
  plumbing (a method more than five methods call) last; children are still
  written in call order. `get_flow` defaults to 60 rows and takes `maxChars`
  (about 12,000 characters of answer), whichever comes first. A cut names the
  limit that caused it and the advice that helps (`n more nodes past maxNodes
  60; raise maxNodes or ask get_flow on a child id`, `past depth 8; raise
  depth`, `past about 12000 characters; raise maxChars…`), with `stoppedBy`,
  and `crossingsLeft` lists up to eight crossings it did not follow; `next`
  gained `check_contract` for the first HTTP crossing and `get_flow` on the
  first crossing left. `who_calls` says `past maxNodes` the same way.
  `describe_for_prompt` uses the same walk, writes a repeat as `again —
  followed under …`, and asks for more depth when depth is what cut it. In the
  terminal, `flow` and `channel` write a repeat as `↺` (`(again)` with
  `--ascii`, which said `(cycle)`) with the node's label, and the cut line
  names the one flag that shows more (`fixtures/multi-repo-plumbing`).
- **Walks that say where they stopped (P94).** `who_calls` counts the callers
  it left past its depth (`n more nodes past depth 3; raise depth`,
  `stoppedBy`, and `frontier`, the rows to ask on from at depth 16), writes a
  caller the graph has no node for as a `missing` row instead of dropping it,
  and marks a row that is no way in and that nothing calls `topOfChain` with
  `gapsInFile`, the gaps of its file that may hide the call, with
  `cant_follow` and a gap search in `next`. `impact` with no way in says
  `entriesNone` and where to look, and its walk limit moved from `note` to
  `truncated`. `who_calls`, `impact` and `get_source` take a route said aloud,
  a bot key or an `invoke:` name as `get_flow` does, and `get_source` a name;
  a route with a literal segment resolves to the most specific route, as the
  linker joins it, naming the others under `alsoAnswers` (`GET
  /orders/latest` used to come back as three candidates), in the terminal's
  `flow` and `config` too. After an ambiguous name `next` asks the same tool
  once per candidate. An unknown channel, symbol or entry names up to five
  `suggestions`; every error is `isError`. `check_contract` between two
  service names lists every crossing from one into the other with its status
  and the call that checks it. `cant_follow` for a cause with no gaps says why
  (`route-unguarded is a finding, not a step the reader missed`), and for a
  cause nothing knows is an error with the `known` causes and the `nearest`. A
  `search` gap hit's `id` is the method it is in, its gap id moved to `gapId`,
  and it carries `sites` and every `places` (at most ten), so `next` leads to
  `get_source` and `who_calls`. `start_here` lists `topFindings` beside
  `topGaps` (`fixtures/cant-follow/expected.mcp`).
- **Copy as prompt writes the same text as `describe_for_prompt` (P97).** Both
  gather one subject and hand it to one renderer, core's `renderPrompt`
  (`prompt-text.js`, written into the page as it is), so the same way in,
  channel or check is the same characters from either. One heading scheme for
  every subject: `# Way in:`, `# Channel:`, `# Check:` or `# Symbol:`, the id
  line, *In front of it*, *Can fail with* with its statuses in the heading,
  *Published by · n* and *Consumed by · n* (each consumer with what it goes on
  to do), *Where · n* for a check, *Reached from*, **Steps** in call order,
  **Shapes**, **Gaps** and **Ask next** with each call written out with its
  id. The server's text gained the page's step marks (best guess, on failure,
  side by side, per item, likely N+1, throws, seen ×n) and log lines, a
  schedule and the hits seen at run time; the page's gained the ids and calls,
  and walks the steps `get_flow` walks (`reads_config` included, each node
  once, the crossings first). `describe_for_prompt` takes a gap id
  (`gap:<service>|<file>|<reason>`), as a check row on the page copies it:
  every row of it at its line, with the node it is on. The page ships every
  node's id, less what its type, service and file already say. The shared
  snapshots are `fixtures/multi-repo/expected.prompt/`, and a parity test
  compares both sides on every way in, channel, symbol and gap of every built
  fixture, walked in full and cut short.
- **`what_changed` says `base` and `head` as objects (P96).** Each is `{ ref,
  label }`, `label` `working tree` where no ref was read and the ref with each
  service's commit otherwise: `head: null` had read as "no head". Its `counts`
  are those of the service asked about, types are filtered by the service in
  their id, and `counts` gained `gaps` and `lostJoins`.
- **The demo project's billing service calls orders (P209).** `billing` made
  no outgoing call in code, so its @nestjs/observe batch joined nothing on its
  own. `InvoicesService.create` now reads the order it invoices from `orders`
  (`GET /orders/:param` through `ORDERS_URL`), and `traces/orders.observe.json`
  is orders' answer in the same trace: billing's batch alone joins billing's
  call, and beside orders' it is paired with orders' snapshot by their shared
  `ti`. The demo figures in the README and on the project page are measured
  again: 130 nodes, 114 edges, 12 of them across a repository boundary, 3 of 7
  calls between services joined.
- **The walkthrough is recorded again, and the page is pictured by a
  script.** Every recording in `docs/media` is retaken with 0.6.0. Scene 02
  shows `doctor` grouping by cause, naming the repository probably missing and
  asked by `--reason`; scene 08 the flows a renamed route cuts, step by step;
  scene 09 the tools the demo can answer; and a new scene, 15, lays the demo's
  traces over the map. The page's still (`10-visualise.png`, also the site's
  preview) and its tour (`14-map-tour.gif`) are taken by
  `scripts/demo/page-tour.mjs` in a headless Chrome, of the page
  `scripts/demo/page-project.sh` builds: the demo with its traces.
  `DEMO_DRY=1 scripts/demo/record.sh` runs every scene untyped and keeps what it
  printed, to read before anything is recorded. Every command a scene types is
  one a reader can run as it stands, with no `jq`, `sed`, `grep` or `head`
  between it and what it prints: a scene shows code with `show <file>
  <from>-<to>`, an edit as `git diff`, part of `doctor` by `--section` and
  `--reason`, part of `diff` by `--section`, and `mcp-call` takes
  `key=value` arguments and prints the tools by title and an answer as text. `scripts/demo/page.mjs`, which
  wrote an older `docs/index.html` and would have overwritten the newer one, is
  removed; the page is edited by hand.

### Fixed

#### Build and package

- **A large service file no longer slows the cold build down (P79, P123,
  P124, P129).** The call-shape pass of P69 walked every call in a file once
  for each call edge it looked up there, so its cost grew with calls times
  edges; it, and the pass that marks edges typed by a stand-in (P78), read one
  index of the file's calls by line instead, built once per parsed file. Every
  line and column the readers write is found by a lookup in a list of the
  file's line breaks, kept once per parsed file, rather than by counting
  newlines from the top of the file for each node (P123). The method a call
  names on a class, and a field or getter a reader looks up there, come from
  one walk of the class's members kept per class (P124); whether a node is a
  conditional write is worked out once per node rather than once per search
  that visits it (P129). The graph is unchanged. `scripts/bench-call-shape.mjs`
  measures the pass over a generated service.
- **Package sources cost a build less (P82).** The index of the package
  sources a service may read in place of an install, and every listed shape
  file, are worked out once by `flowatlas build` and written to
  `<output>/stand-ins.json`, which each repository read in a process of its own
  is handed instead of indexing and parsing them again (a watch works them out
  once for every repository it holds open). A path's mount is found by the
  `node_modules/<name>` segment it is under rather than by trying every mount;
  the files a program reads from its mounts are listed once per program; the
  package a file belongs to, a package's own aliases and the shapes a project
  installed are looked up rather than scanned for. A reader handed a
  `stand-ins.json` of another version works them out itself; `flowatlas
  extract` run by hand always does, and comes to the same graph.
  `scripts/bench-package-sources.mjs` measures a cold build with
  `packageSources` on against off over a generated project.
- **A cached graph went stale when what stood in for a package moved (P83).**
  A shape file added under a listed `shapes` glob, a package directory whose
  `name` answered an import nothing had, and one of two directories claiming a
  name going away each left the importer's graph as it was until one of its own
  files changed, under `build --watch` too. Each build now records the expanded
  shape files and what the index answered for every package a reading wanted,
  reads a service again when either moved and says which in the plan
  (`stand-ins changed: ...`); the index is worked out again on every build.
  The build cache is version 5, so the first build after upgrading reads every
  repository once (`cache-invalid:version`).
- **Package sources were not mounted on Windows (P83).** A mount was held at a
  path spelled with backslashes while the compiler asks with forward slashes,
  so nothing matched, silently. Paths are compared with forward slashes, and a
  drive letter in either case, whatever the OS; a file outside the service on
  the same drive is named relative to it, and one on another drive stays
  absolute.
- **A pack after an incremental build shipped stale chunks (P198).** A build
  over an earlier one left the earlier, hash-named bundle chunks in `dist/`,
  and a pack shipped them all; the bundle now starts from an empty `dist/`.
- **A reading on Windows compared two spellings of one path (P199).** The
  compiler names files with forward slashes on Windows too, and a directory
  built with `path.join` has backslashes, so every "is this file under that
  directory" answered no: shape files went unrecognised, a declared workspace
  package's files were not the service's, the NestJS reader found no global
  prefix, the data reader read no query, and `patterns suggest` found no calls.
  Both spellings are now compared as one, and paths recorded or printed are
  POSIX. On Windows a temporary repository is now seen as a git repository, a
  ref build links `node_modules` with a junction, query commands and a
  disconnected MCP server let go of `graph.db`, and `get_source` drops the `\r`
  of a CRLF file. A checkout is LF on every OS (`.gitattributes`). A
  `tsconfig.json` with a syntax error no longer stops the build on Windows (the
  compiler asserted on the path's spelling instead of reporting the error), and
  a watch from a directory that does not exist yet is held in the platform's
  spelling like every other.
- **`build --watch` sees what stands in for a package (P206).** A watch
  looked only inside the repositories, so a package directory appearing beside
  the configuration, a new workspace member there, a shape or pattern file
  added or edited outside a repository, an edit to a package source read from
  outside every repository, and a repository removed and put back rebuilt
  nothing until the next save in a repository. It now watches those places,
  one level deep where a level is all the package index reads, and a change
  there reads again only the services it concerns, with the build's own reason
  (`stand-ins changed: package @acme/flags now at flags-lib`). The line it
  starts with says what it watches. A build also forgets the workspace members
  it found, so a member that appears during a watch is a package the next
  rebuild can mount.
- **`build --watch` follows an edit to its configuration (P219).** Every
  rebuild loaded the configuration again, but the repositories the watch held
  open and listened to were the ones it started with: a service added was
  read in a process of its own with nothing watching it, a dropped one kept
  its watch, and an edit to the file itself rebuilt nothing. The file is now
  watched; an edit rebuilds once from it, every repository opened again, the
  added ones watched and the dropped ones let go. One that does not load says
  why, and the next edit is tried again.
- **What a NestJS route fails with, through its interceptors (P207).** P87
  read failures through exception filters only, so an interceptor that maps
  errors in an RxJS `catchError(...)` left a route listing what its handler
  throws rather than what the caller gets: a `BookNotFound` 404 where every
  error becomes a `BadGatewayException` 502, a failure a fallback `of(...)`
  answers with a value, and no 408 from the framework's documented
  `TimeoutInterceptor`. Interceptors installed globally (`useGlobalInterceptors`,
  `APP_INTERCEPTOR`), on the controller and on the handler are now read in
  the framework's order, inside the filters: each `catchError` branch by
  `instanceof` test gives a new exception (`source: 'interceptor'`), hands the
  error on, or swallows it; `timeout()` raises its error; a guard's refusal
  passes none of them. An interceptor whose handling cannot be read leaves
  the statuses behind it `assumed` and is a `fails-interceptor-unread` row
  (`fixtures/nest-fails-intercepted`).
- **The @nestjs/observe reader against the SDK's own contract (P202).** P85
  wrote the reader from field names alone; it is now checked against the wire
  contract of `@nestjs/observe` 0.3.12, and newer versions are read the same
  way, field by field. A job's time is `c`, not `ct`, and a queue's job is
  now a consumer span of its queue (a `@nestjs/schedule` run is read for its
  tree); a `manual` span, which names the method it was opened in, is no
  longer counted as a second call of it; a node the agent folded
  (`observe.collapsed`) counts as the calls it stands for; a node's `so` places
  it in time; a request no route matched, which the agent names by its folded
  URL, is read by the URL's shape, so no id in it becomes a route; a GraphQL
  operation over HTTP is read for its spans, its document never taken for a
  path; WebSocket and broker messages (Kafka, NATS, Redis, MQTT, RabbitMQ) are
  consumer spans of their event or pattern, and TCP and gRPC requests server
  spans of their RPC pattern, where they were skipped; a failed job, `e: true`
  on any node and a body the agent cut short (`bodyTruncated`) are read as
  such. `ti` is the `x-request-id` the agent adopts and passes on, not a W3C
  trace id, so a server snapshot that names no parent is paired with the one
  client span of its trace in another service with the same method and path,
  and the join between two services read with the agent is counted. The
  fixture batches were rewritten from the contract.
- **A versioned path reached no route (P213).** A path segment such as `v1`
  is masked as `:value` like any segment with a digit, and `:value` fitted
  only a parameter, so every call to `/api/v1/...` read from a HAR, an OTLP
  client span or a URL missed its route. A masked segment now fits a declared
  literal the same rule masks, scored as a parameter.
- **Two services' @nestjs/observe snapshots of one request kept apart
  (P222).** The reader made up a snapshot's span ids from its trace id and its
  place in the batch, so the caller's and the callee's snapshot of one request,
  which share a `ti`, had the same ids: the second took the first's place as
  the parent of its tree and as the span its captured body belonged to, which
  put billing's request body on orders' route. The ids now name the service
  (`<ti>:billing/0`).
- **A step to something a walk already drew lands where it was drawn
  (P223).** A walk writes a node it reached before as a reference with its id
  and label only, so a sequence drew a table read a second time as a new
  `orders (store)` participant, and a call back into a method or a way in
  already drawn as a participant named after its label. It lands where that
  node was first drawn, in `flow --format sequence`, `diff`, doc blocks and
  the Structurizr dynamic views.
- **A channel's doc block put a call back into its own service on the channel
  (P224).** The walk from a channel stood in the service that declared it, and
  each step to that service was rewritten as a step to the channel, so a
  consumer's request back to the publisher read `billing → order.created GET
  /orders/:param`. The walk now starts at the channel itself.
- **An EventBridge event with one end named its bus as the missing repository
  (P225).** `doctor --missing` read an event's first segment after
  `eventbridge/`, which is its bus, so an event nobody here published on the
  default bus pointed at a repository called `default`. It is named by its
  `source` now, as P204 reads a rule's pattern (`com.acme.payments` →
  `payments`), which is how AWS, the schema registry and EventCatalog say who
  sent an event; a custom bus names it only when its source names nobody, and
  the platform's `aws.*` sources and a partner's bus name none.
- **`flowatlas mcp` reports its version (P86).** `initialize` answered every
  client `serverInfo.version: "0.0.0"`; it now answers the command's version.
  The standalone server bin answers its own package's.

#### Reading

- **Routes of two APIs, two listeners or two addresses stay apart (P59,
  P61).** Two API Gateway APIs (REST, HTTP or WebSocket) or two load balancers
  of one deployment serving the same method and path, each in front of its own
  function, were one entry node. Such a route is keyed with its API,
  `GET:/status@api:<api>`, and with the listener where two listeners of one
  load balancer send it to different functions,
  `GET:/health@api:staff-lb@listener:HTTPS:443`; listeners sending it to one
  target stay one route. An API or load balancer whose name is not read is
  keyed by its Terraform address, `GET:/hours@api:aws_apigatewayv2_api.desk_hours`.
  A route no other API serves keeps its plain key, so existing ids do not
  move. Routes are compared across every deployment a repository is read from,
  and a route rooted at another repository's point that lands on a route of
  another API keeps both apart rather than being reported as declared twice. A
  request reaching them through a `baseUrlEnv` setting, and a `@CallsService`
  annotation whose route several APIs serve, join the API whose name shares
  the most words with the setting's (`LOANS_API_URL` → `library-loans-api`),
  `via: "apiName"`, `heuristic`, with a `route-api-guessed` row at `info`;
  where the name settles nothing, an `ambiguous-route-api` row names the APIs
  and nothing is joined. Annotations on methods of plain classes, as a
  function's code writes them, are read
  (`fixtures/lambda-terraform-shared-paths`).
- **Error actions and run-time batch lists (P62).** A function an IoT rule's
  `error_action` names was taken as the code the rule's entry runs
  (`meta.invokes`) when no other action had named one first; it is always a
  reference carrying `when: "failure"`. The edge to a queue, topic, bus or
  stream an `error_action` publishes onto gained `meta.when: "failure"`, as its
  producer already had. A Step Functions batch or transaction whose whole list
  is a path (`RequestItems.$`, `TransactItems.$`) or a JSONata expression is
  one `workflow-target-dynamic` row per state naming that field, instead of a
  state whose `TableName` is missing (`fixtures/lambda-terraform-table-stream`).
- **A transaction's `ConditionCheck` (P55)** names no written table and stopped
  reading as an address nobody could read, in code and in a definition; a
  batch or a transaction writes no single message, so it stopped being a
  `payload-type-unknown` row.
- **`{ method }` was read as no verb at all (P91).** `fetch(url, { method })`
  written with a shorthand property was taken as the protocol's default,
  `GET`; it names a binding, and is read as one. An address joined with `+` to
  a value read at run time (`'https://catalog/items/' + id`) is read as far as
  it goes, where it had been no address.
- **A document's `null` in a list of types was dropped (P196).** OpenAPI 3.1
  and JSON Schema say a value may be null as `type: ['string', 'null']`; the
  document reader took the first type and read the field as never null, so the
  contract check could not see a receiver that did not expect null. It is now
  `string | null`, as `nullable: true` already was.
- **An optional named request value was read as required (P197).**
  `@Query('page') page?: number` (or `page = 1`) put `{page:number}` on the
  route, so the written OpenAPI document required it and a caller leaving it
  out looked like one leaving out a required value. It is now
  `{page?:number}`.

#### doctor and diff

- **`doctor.json` holds every row (P192).** The file `doctor` writes was cut
  like the terminal: six places per reason and 150 rows per section, with
  `truncated` saying how many, although `--max-nodes` promised "the file is
  always complete" and every `… N more rows` line sent the reader to it. The
  check now builds the whole report, writes it, and cuts only what it prints:
  text, `github` and `--format json` are unchanged, and the file has every row
  and no `truncated` field (same `doctorFormatVersion: 2`; the field was always
  optional). `runDoctorComplete` and `boundDoctorReport` are exported beside
  `runDoctor`, which is the two together.
- **`doctor --format github` annotated paths that were not there (P191).** An
  annotation's file was the one inside its repository (`src/x.ts`), and the
  checkout sees it under the directory the configuration gives the repository;
  the mapping existed and was never passed. Annotations now name
  `billing/src/x.ts`.
- **A new gap under a gap id the base already had (P194).** `flowatlas diff`
  compared gaps by gap id (one reason in one file), so a second unjoined
  request in a file that already had one, or any gap id whose rows grew, was
  not new, and one whose rows shrank was not gone. The rows under an id both
  sides hold are now matched one by one on what each says (symbol with
  positions masked, and message), never on the line, and the sites left over
  are listed under the same id at the first new or gone one, with the new
  optional field `kept` (the sites both sides share) on the row in `diff.json`,
  on `what_changed`'s `newGaps`, and in the Markdown (`gap, 1 more beside 1`).
  A site replaced by another is listed under both; a row standing for several
  sites is matched by its count. Same `diff.json` format.

#### The page

- **Four page bugs seen in a browser (P137).** A page opened at `#map` (a
  link, a bookmark, a reload) showed the Map tab selected over an empty panel;
  no tab is open now until the first is shown, and a test boots the page at
  every tab's address, at desktop and phone widths. The Map's kinds of link
  stacked in a column since P101 gave the Graph's Filters popover that class;
  they are a wrapping row of their own again. On a phone, the Ways in list cut
  a failure chip mid-word (`500 ×1 not de…`); the chips now wrap whole, and the
  row's tooltip says them all. The line under a Not joined row names
  `flowatlas doctor --reason <code> --max-nodes <n>` (and `--service` when the
  reason is all in one service), which lists only that reason's places.
- **The Crossings tab drew nothing (P140).** Its table reached for the Not
  joined tab's per-kind sections, which were not in its scope, and stopped on
  the error before drawing a row; it lists every crossing again.
- **Controls' edges at 3:1 (P142).** A search box, a select, a tool button, a
  chip, a tab, a service on the rail, a key and the palette's input were
  outlined in the colour of the page's rules, about 1.4:1 on their ground; they
  are drawn in a token of their own, `--edge`, at 3:1 or more on every ground
  in both themes. A row focused or picked by a fill alone (a search result, a
  menu item, the palette's pick) also carries an accent bar along its start.
  The contrast test holds the edge, the focus rings and the marks at 3:1, and
  no control's edge in `--rule`.
- **Time axes that read cleanly (P145).** On the Steps waterfall in time and on
  the Traces tab the last tick label (`500 ms`) wrapped at the right edge; every
  tick label is now one line, and none runs off the axis. The waterfall's
  caption says what is drawn: what a step calls sits inside its bar, from where
  it starts, one call after another and side-by-side ones together.
- **The ways-in filter matches service names (P73 follow-up)**, not only a way
  in's own label, and **the Map fits a short drawing at the top of its frame on
  first load (P73)**; *Copy link* and *Full screen* keep their icons at phone
  width.

#### The graph server (MCP)

- **A service's prompt counted gaps somebody accepted (P143).**
  `describe_for_prompt({scope: "service"})` listed its most common gaps over
  every row, accepted ones included; it counts the rows nobody accepted now, as
  the page does.
- **`impact` said only one of its notes (P132).** An answer whose walk stopped
  at its limit, asked at `detail: 3`, said only that the level was clamped; it
  now says both: the walk limit under `truncated`, the clamp as `note`.
- **A file's likely N+1 hidden behind its note (P130).** The MCP `search`
  keeps one `query-in-loop` hit per file, and of loops reached alike it kept
  the first; a finding now ranks before a note reached alike.

#### Documentation

- **Command and tool counts in the READMEs.** `packages/cli/README.md` and
  `docs/mcp.md` quoted command and tool counts that had drifted; they now say
  what `flowatlas --help` and the tool-list test hold.
- **The walkthrough, the site and the READMEs say what 0.6.0 prints.** The
  `flow` and `channel` transcripts in `docs/getting-started.md` predated
  billing's call into orders (P209); three spellings of `POST /orders/:param`
  named a route the demo does not have, and now name `POST
  /orders/:param/archive`; the npm README's first-build table said 2 of 6 calls
  and 9 → 11 crossing edges (3 of 7, and 10 → 12) and 167 fixtures (168); the
  README said 99 edges were read from code (104). The project page's scenes
  describe what each recording now shows, its configure table is measured
  again, a scene shows `observe`, and it says what reads traces and what checks
  a merge. The page's tabs are described as they are (Not joined's sections,
  Traces, Run time changes, one search), a session's tools as the ones its
  project can answer (19 on the demo, 26 with `--all-tools`), and `docs/ci.md`
  names the build line `missed · notes · findings`. `docs/CLI.md` lists
  `FLOWATLAS_PIN_<SERVICE>` among the environment variables, in place of
  `FLOWATLAS_DB`, which `flowatlas mcp` never read.
- **`doctor --help` named the wrong baseline.** It gave the default as
  `<output>/baseline.json`; the baseline is `flowatlas.baseline.json` beside the
  configuration, as `docs/CLI.md` says.

## [0.5.1][] - 2026-10-12

`@flowatlas/cli` only; `@flowatlas/markers` is unchanged at 0.2.0. Two things
to do after upgrading:

- **Rebuild once.** The graph's schema version moved to 6, so a database built
  by 0.5.0 is refused with a message to rebuild: run `flowatlas build`.
- **Delete the old per-repository output.** A service's own graph and file
  hashes now go under the configured output, at `<output>/services/<name>/`,
  not into `<repo>/.flowatlas/`; `build` names any `.flowatlas/` an earlier
  version left in a repository, and says it is safe to delete.

Serverless on AWS is read from Terraform and Step Functions definitions; the
`visualise` page opens on a Map of the whole project and gains a Graph tab you
can walk, check with and read types in; and what a request carries is read in
every framework, not only NestJS - SvelteKit, Remix and React Router file
routes included - with each route's failures and the signatures of Angular
components, directives, pipes and tRPC procedures. The npm page (README and keywords) is brought
up to date as well.

### Added

- **Lambda functions and API Gateway routes, read from Terraform.** A service of
  type `lambda` is a repository of handlers whose ways in are declared in
  Terraform rather than in code. Every `aws_lambda_function` is an entry of a
  new kind, `invoke`, under the name it is deployed with, and lands on the
  exported handler its `handler` string names — through a middleware chain such
  as `middy(fn).use(...)`, and through a handler packaged from `dist/`, mapped
  back to its source by the tsconfig. Every REST API method and HTTP API route
  is an ordinary `http` entry onto the same handler, with its authoriser as a
  guard. `init` and `link` propose the type from the manifest, from a manifest
  per function directory, or from the Terraform alone, so a repository of
  nothing but Terraform is a service. `fixtures/lambda-terraform-rest`.
- **A shared API, joined across repositories.** A route that hangs from a point
  of an API another repository publishes — through a parameter or another
  state's output — gets its full path from that repository at link time, and a
  route integrated with a function another repository deploys gets that
  function's handler, joined on the name. `fixtures/multi-repo-lambda`.
- **Terraform modules.** A local module is read with its inputs bound. A module
  from a registry or another repository is described under
  `adapters.infra.modules`, in the module's own language;
  `terraform-aws-modules/lambda/aws` and `terraform-aws-modules/apigateway-v2/aws`
  ship described. A remote module nothing describes is one `doctor` row naming
  it and the inputs it was given. `fixtures/lambda-terraform-modules`.
- **`services[].infra.vars`** chooses the variable files a deployment is read
  with. Without it, a name two `*.tfvars` files set differently is a row naming
  the variable and the files, never a name picked from one of them.
- **`flow invoke:<name>`** starts from a function by its deployed name.
- **A state machine is a way in, and its states are steps.** A definition in
  the Amazon States Language that a repository keeps as a file of its own -
  `*.asl.json`, `*.asl.yaml` - is read in every service a server reader reads,
  with nothing to configure, and drawn as an entry of the new kind `workflow`
  that handles its first state. Every state is a `function` node of kind
  `state`, and every way control moves between two states - `Next`, each
  `Choice` rule and its `Default`, each `Catch`, every `Parallel` branch, a
  `Map`'s processor - is an edge saying which it is. `Retry`, and what a state
  is given and passes on, are kept on the node as written; nothing is
  evaluated. `flow workflow:loan-approval` walks it.
- **A step that starts another workflow is joined to it by name**, across
  services, the way a channel is. A step that reads or writes a table is a query
  on that table; a step that sends to a queue, a topic or a bus is a publisher
  onto that channel; any other integration is a step naming its service and
  action.
- **A name the definition does not state is a row, never a guess**: one chosen
  at run time by a path, an intrinsic or a JSONata expression
  (`workflow-target-dynamic`, nothing to fix), a `${...}` placeholder nothing
  here fills (`workflow-template-unbound`), a field that names nothing
  (`workflow-target-unreadable`). A definition read on its own is named after
  its file and says so (`workflow-named-by-file`), and a join on that name is
  `heuristic`. A task that invokes a function joins to that function's `invoke`
  entry by its deployed name, in whichever service deploys it, and is a
  `reference-not-found` row where no service does
  (`fixtures/stepfunctions-asl-files`).
- **`flow workflow:<name>`** walks a state machine's steps in order and into
  each handler.
- **A state machine declared in Terraform is read from there.**
  `aws_sfn_state_machine` - directly, through a local module, or through
  `terraform-aws-modules/step-functions/aws`, which now ships described - is a
  `workflow` under the name it is deployed with, evaluated, and every join to it
  is `static`. Its definition is read whether it is written with `file()`,
  `templatefile()` with its variables, `jsonencode()`, a heredoc, or
  `jsonencode(yamldecode(file()))`, and each state is placed on the line it is
  written on. A template variable or a value inside the definition that holds a
  reference - `aws_lambda_function.x.arn`, `module.f.lambda_function_arn`,
  `aws_sfn_state_machine.y.arn`, a `data` block looked up by name - is filled
  with the deployed name it addresses, so a task joins the function or the
  workflow it names across repositories; a variable the files do not settle is a
  `workflow-template-unbound` row on the step that uses it. A definition that
  is also a standalone `*.asl.json` is read once, under the deployed name. New
  rows: `workflow-name-unread`, `workflow-definition-not-loaded`.
  `fixtures/stepfunctions-terraform`, `fixtures/multi-repo-stepfunctions`.
- **Publishing through the AWS SDK.** EventBridge `PutEvents`, SQS
  `SendMessage` and `SendMessageBatch`, and SNS `Publish` and `PublishBatch` are
  read as producers, whether the call sends a command (`client.send(new
  PutEventsCommand(input))`, built in the call or in a `const` before it), uses
  version 3's aggregated client, or uses version 2 with `.promise()`. Each entry
  of a `PutEvents` is an event of its own, on
  `eventbridge/<bus>/<source>/<detail type>`, and an entry that names no bus is
  on `default`. Queues and topics are `sqs/<name>` and `sns/<name>`, by the name
  inside the URL or ARN the code holds. The message is `Detail`, `MessageBody`
  or `Message`, read past `JSON.stringify`. The client's package may be declared
  in any manifest of the repository, for one that keeps a manifest per function
  (`fixtures/aws-sdk-publishers`). With nothing installed, a client is
  recognised by its construction and its import, at `heuristic`
  (`fixtures/aws-sdk-not-installed`). Who receives is read from the
  deployment (below).
- **A name read from `process.env` is said to be one.** A channel named by an
  environment variable is a publisher with no channel and a new row,
  `channel-from-environment`, naming the variable, rather than a name the tool
  could not read. A queue's URL is usually written this way, and its value is
  set by the deployment.
- **Two locators and an address in parts, for describing a bus in
  configuration.** `argument-path` reads a path of properties inside an
  argument and `constructed-argument-path` reads one inside what a class is
  constructed with; `*` in a path is every element of a list, one channel each.
  A producer may give `address`, a list of parts joined with `/` - stated words,
  located names, a default for a part nothing writes, and the longer spellings
  a name may be written inside - and `payload`, where its message is written,
  and may be a `function` of the project's own rather than a method on a
  receiver. The AWS SDK is read through exactly these, so a project's own
  helper around it, a class or a function, is described the same way.
- **Subscribers declared in Terraform.** Every channel the AWS SDK publishes
  to now has its subscriber read from the deployment, on the same node:
  `aws_cloudwatch_event_rule` and its targets (a function, a workflow, a queue,
  a topic or another bus), `aws_lambda_event_source_mapping` from a queue,
  `aws_sns_topic_subscription` to a function or a queue, `aws_pipes_pipe`, and
  a queue's redrive policy as a `triggers` edge to its dead-letter queue. A
  rule's `schedule_expression` and `aws_scheduler_schedule` are `cron` entries
  on their target, and a mapping from a DynamoDB or Kinesis stream is an
  `event` entry on its function. A target deployed in another repository is
  joined by its deployed name. `terraform-aws-modules/eventbridge/aws`,
  `.../sqs/aws` and `.../sns/aws` ship described
  (`fixtures/eventbridge-terraform`, `fixtures/sqs-sns-terraform`).
- **An event pattern matched as written.** Exact `source` and `detail-type`
  values join their channels `static`; `prefix`, `anything-but`, `exists`,
  `wildcard` and a field left out are matched against every channel the
  project publishes and join `heuristic`, with the reason on the edge, which
  `flow` and `channel` show in `--format json` (`because`). Filters on
  `detail`, a subscription's filter policy and a mapping's filter criteria are
  recorded (`notMatchedOn`) and not matched on. A pattern that selects nothing
  published here is a way in from outside, one `subscription-matches-nothing`
  row at `info` (`fixtures/multi-repo-events`).
- **A route integrated with a queue, a topic or a bus** - an API Gateway REST
  integration with `sqs:path/<account>/<queue>`, `sqs:action/SendMessage`,
  `sns:action/Publish` or `events:action/PutEvents`, an HTTP API integration of
  subtype `SQS-SendMessage` or `EventBridge-PutEvents` - is the way in and the
  publisher onto that channel, where it was a `route-target-unread` row.
- **A name read from the environment, completed from the deployment.** Each
  function's `environment` block is kept on its `invoke` entry, and the linker
  completes every address the code reaches by a variable from the value each
  function that runs it is deployed with: `process.env.RETURNS_QUEUE_URL` set to
  `aws_sqs_queue.returns.url` is `sqs/library-returns`, and the
  `channel-from-environment` row goes. A function that runs the code and does
  not set the variable is an `environment-not-set` row naming both; a value the
  variable files dispute is an `environment-value-unread` row naming them, and
  `services[].infra.vars` chooses. A settings key a function sets says where its
  value comes from on the `reads_config` edge (`setBy`).
- **Code that starts a workflow or invokes a function, joined to it.** Step
  Functions `StartExecution` and `StartSyncExecution` and Lambda `Invoke`,
  versions 3 and 2, are rows of the SDK's table: the call is a producer
  labelled `start`, `start-sync`, `invoke` or `invoke-async` (`InvocationType:
  'Event'`) that reaches the `workflow` or `invoke` entry deployed under the name
  it reads - a literal, an ARN, or a variable the function's Terraform sets - and
  never a channel. So `flow 'POST /loans'` goes on from the handler into the
  workflow it starts and the functions that workflow invokes.
  `SendTaskSuccess` and `SendTaskFailure` are a leaf on the handler, joined to
  nothing (`fixtures/start-workflow-sdk`).
- **A helper that starts something, read or described.** Where the name is the
  parameter of a method whose source is read, the start is drawn at each call of
  it with the name its caller passes. A helper from a package that is not here
  is described under `adapters.starters` - its `module`, its `function` (or
  `receiverType` and `method`), its `target` (`workflow` or `invoke`), where the
  `name` is written, and an optional `names` table from what the code says to
  the deployed name. A join through `names` is `declared`, never `static`
  (`fixtures/start-workflow-helper`).
- **A start addressed by a record made one call earlier.** A helper that
  records what to start and then starts it by id -
  `const run = await orchestrator.create({ process: Process.LoanApproval });
  await orchestrator.start({ runId: run.id })` - is described with the new
  `origin-call-argument` locator, `{ "kind": "origin-call-argument", "call":
  "create", "path": ["process"] }`, which follows `run.id` back to the call that
  made `run` and reads the name from its argument. Only within one body, only
  through `const` bindings, and only to one call of that name on the same
  receiver or from the same module; anything else is `start-name-unread`
  (`fixtures/start-workflow-by-record`).
- **`doctor` says which helper to describe**, with one `starter-undescribed`
  row per package and function, for a call from a deployed function into a
  package whose source is not read that is shaped like a start: one not
  installed, handed an id the same package made earlier in the body, or one
  installed with its declared types only, whose types reach a Step Functions or
  Lambda client. A call handed a string or an enum member and nothing else is
  not offered a description, so an error builder or a code converter is not
  taken for a starter. The description offered points at the earlier call where
  there is one, and says `"target": "invoke"` where the types reach Lambda.
- **A workflow step that sends is a publisher, joined to its subscriber.** A
  task that sends to a queue, publishes to a topic or puts events on a bus -
  `sqs:sendMessage`, `sns:publish`, `events:putEvents`, their batch forms and
  the `aws-sdk:` spellings - is a producer at the step onto
  `sqs/<queue>`, `sns/<topic>` or `eventbridge/<bus>/<source>/<detail type>`,
  the names a subscriber read from Terraform lands on, so a mapping, a
  subscription or a rule in any repository is joined to the step by name. The
  message the step is given is kept as written on the edge (`meta.payload`).
  The `workflow-channel-not-joined` row is gone
  (`fixtures/multi-repo-stepfunctions`).
- **`contracts` compares a message delivered by AWS through the envelope it
  arrives in.** A queue's, a topic's or a bus's message is compared with what
  the function the deployment delivers it to reads at `Records[].body`,
  `Records[].Sns.Message` or `detail` - the type declared there, or what the
  handler parses the text there into - and a start's `input` or `Payload` with
  the invoked handler's parameter or with what the started workflow's first
  state reads of its input. A rule or a subscription that forwards to another
  queue or topic forwards the envelope, and whatever reads that queue is
  compared with it: `fixtures/multi-repo-events` now reports the digest
  handler reading `borrowerId` off the body of a queue a rule fills with whole
  events, where it is at `detail.borrowerId`, and
  `fixtures/start-workflow-sdk` a renewal starting the approval workflow
  without the `borrowerId` its first state reads. Where nothing can be compared
  the boundary stays `unchecked` with one of seven new reasons:
  `envelope-unread`, `message-unparsed`, `message-undeclared`,
  `handler-unread`, `delivered-onward`, `delivery-target-unread` and
  `sender-forwards`. The table of envelopes is data in `@flowatlas/aws`; an
  `invoke` entry records what its handler reads (`meta.reads`), a consumer a
  deployment declares and a start record how they wrap the message
  (`meta.envelope`), and a `workflow` entry what its first state requires.
- **Terraform written as JSON.** `*.tf.json` is read into the same tree as the
  native syntax, with a line on every block and argument, so a generated
  configuration - and a module written as one - reads like any other. The
  `infra-file-unread` row is gone (`fixtures/lambda-terraform-json`).
- **An API created from an OpenAPI document.** The `body` of
  `aws_api_gateway_rest_api` and `aws_apigatewayv2_api` -
  `templatefile("openapi.yaml", {...})`, `file()`, `jsonencode({...})` or a
  heredoc, in JSON or YAML - is read as routes, each answered by what its
  `x-amazon-apigateway-integration` names: a function by its ARN, with template
  variables that are references kept as references, or SQS, SNS or EventBridge
  integrated directly. Each route is placed on its line in the document, and an
  operation's `security` is a guard. `api-body-unread` is now a row only for a
  body that cannot be read (`fixtures/lambda-terraform-openapi`).
- **WebSocket APIs.** Each route of an API with `protocol_type = "WEBSOCKET"` -
  `$connect`, `$disconnect`, `$default`, `askLibrarian` - is an `event` entry,
  `websocket/<api>/<route key>`, onto what its integration runs; they were
  skipped (`fixtures/lambda-terraform-websocket`).
- **Base paths.** A route of an API a custom domain maps at a base path
  (`aws_api_gateway_base_path_mapping`, `aws_apigatewayv2_api_mapping`) is at
  that base path, so a caller written against the public URL joins:
  `GET /v1/items/:param`. Domains, base path and stages are recorded on the
  route; a stage is not put in front of a path. A mapping whose base path is not
  read is a `route-base-path-unread` row (`fixtures/lambda-terraform-base-paths`).
- **A rule that forwards to another bus by a pattern.** A rule that takes its
  events by a filter and targets another bus carries every channel the filter
  matches onto that bus, where that bus's rules see them, joined at the match's
  confidence. What a function on that bus reads at `detail` is compared with
  what the original publisher put. The `subscription-forward-unread` row remains
  only for a schedule, a queue or a pipe that puts what it takes on a bus
  (`fixtures/lambda-terraform-bus-forward`).
- **A Map tab in `visualise`, and the page opens on it.** One box per service,
  in columns by what it is for - front ends, APIs and ways in, channels,
  workers and workflows, libraries, data, the outside, packages - joined by
  what passes between them: requests, messages, workflow starts, function
  invokes, queries, outside calls and calls, each link counted, weighted by how
  many edges it stands for and dashed when one of them is a guess. A service's
  tables are one data box beside it; a channel is a box of its own, so one with
  no consumer is visible. Services whose names share a prefix (`pay-api-*`,
  `core.jobs.*`) form a family that opens and closes, closed by default on a map
  of more than forty boxes, and a large open family wraps into a block. A box
  opens its details - ways in, busiest classes, what it reaches and what reaches
  it, what it is built from - and a link lists the edges behind it, each end
  opening in the Graph tab. A packages layer draws what the manifests say: a
  service depending on the package another publishes is joined to it, a
  package two services use is a box, development dependencies on request;
  `build` records each service's manifest in the link report for it. The map
  marks rows to act on, channels with one end, routes nothing calls, services
  not read, and services that reach each other; filters by kind of link; draws
  one box and what it touches on a double-click; and keeps its view in a link
  (`#map/…`, by name), with full screen and SVG and PNG export.
- **A Graph tab in `visualise`.** The page draws the neighbourhood of any node:
  what reaches it to the left, what it reaches to the right, one column per hop,
  coloured by service, marked by type, and with every edge styled by how far it
  can be trusted - `static` solid, `heuristic` dashed, `marker` and `declared`
  dotted and labelled. A focus is chosen by searching every node (label, type,
  kind, service, file) or from a *show in graph* link beside every way in and
  every node the other tabs name. At most a chosen number of nodes is drawn, and
  the page says how many more there are; a node with neighbours not drawn
  carries `+N` and expands on a click. Clicking a node opens its details: its
  metadata, its edges in and out grouped by type with the far node's service and
  confidence, and the rows that name it with their reasons and hints. Back and
  forward, the focus kept in the address, arrow keys between neighbours, filters
  by service, edge type and confidence, light and dark, phone width. Inline SVG
  and plain JavaScript; nothing is fetched. The page carries the node metadata
  and the rows the panel shows, packed, and a word the label already says is not
  shipped again, so the page grows by much less than the metadata it carries.
- **A graph you can read.** The Graph tab folds guards, interceptors, pipes and
  middleware into a chip on the way in they wrap (`2 guards · 3 interceptors ·
  1 pipe`), drawn beside it on a click or all at once from a toggle, so a NestJS
  route is one node rather than a node among its guards. More than six
  neighbours of one type on one side of a node are grouped by service and then
  by owning class, each group a stack with its count that opens in place, and
  grouping comes before the cap: a table with two hundred queries draws as eight
  groups instead of hitting the cap at once. Every service is a faint band with
  its name, so an edge into another band is a crossing. A node reads as its
  method, strong, over its class, muted, shortened in the middle with the full
  name on hover; an edge names its type only on hover and around the open node.
  Hovering a node lights the way from the focus to it and dims the rest. Zoomed
  out, nodes are shapes in their service's colour; a minimap shows the whole
  drawing and moves the view. About 38 KB more page, whatever the project.
- **The Graph tab's frame: full screen, a drawer, bookmarks that last, pictures,
  touch.** A *Full screen* button and the `F` key give the drawing the whole
  window, with the details panel laid over it from the right; `Escape` closes
  the panel first and leaves full screen after. The details panel can be widened
  by dragging its edge (or with the arrow keys on it) and folded to a rail that
  still names the open node; both are remembered in the browser. Every node now
  carries a six-character key hashed from its graph id, checked for collisions
  when the page is written, so `#graph/<key>/<hops>` - with any expanded nodes
  after it - opens the same view after the graph is rebuilt; a link from before,
  which names a node by its position, still opens, and says it did; a key the
  page does not hold is said rather than guessed at, and a key two nodes have
  come to share offers both. *Copy link* copies that
  address; *SVG* and *PNG* save the drawing as it stands, at its own size, the
  PNG drawn from the SVG in the page with nothing fetched. Two fingers pan and
  pinch to zoom. The keys add six bytes a node: on the largest fixture the page
  goes from 103 to 134 KB.
- **Checking tools in the Graph tab.** *Problems*: a node with rows naming it, or
  rows at its line, carries the count, the two said apart (`badgesFor(node)` is
  the hook the drawing reads); *problems only* cuts the drawing to them and what
  joins them to the focus; one *Problems* list holds the ways in, crossings and
  calls that did not join or carry rows. *Path*: the shortest path or paths
  between two nodes picked from the panel or the search, one way or either way,
  or "no path" with the steps, direction and filters searched. *Impact*:
  everything upstream of a node to the ways in, drawn, with the entry points
  listed; it agrees with `flowatlas impact` on every node of three fixtures,
  under test. The page grows by about 36 KB of code; the data by a list of
  workflow steps.
- **The three parts of the Graph tab work as one page.** Problem badges are
  drawn on the nodes of every view, a group summing its members'; a path and an
  impact fold plumbing into chips and light the way back on hover like the
  neighbourhood. A link also carries the question asked (`impact`,
  `path.<key>.<steps>`, `only`) and what the filters hide, by name. A picture
  taken zoomed out has every name in it. Escape closes the search's list, then
  the panel, then the answer, then full screen, one at a time. The minimap
  keeps to a small box in its corner whatever the drawing's shape.
- **What a request carries, in every framework.** A route declared by a call -
  Express, Fastify, Koa, Hono - a Next.js route file or `pages/api` handler, a
  Medusa route and a Lambda behind an API Gateway now say what their body, path
  params, query and headers are and what they answer with, as a NestJS route
  has: from the type arguments a route or its request states, a validator's
  output (`schema.parse(req.body)`), the value handed to `res.json` /
  `reply.send` / `c.json` / `NextResponse.json`, the value assigned to
  `ctx.body`, or the body a Lambda returns as text. A cast is recorded as
  claimed (`meta.claimed`), a framework's default is no type, and an answer
  sent with a failure status is kept apart (`meta.failures`). Each framework is
  a description of places, and a framework described under
  `adapters.entry.http` can say the same with `request`.
  `fixtures/request-shapes`.
- **`contracts` compares those routes.** A finding against a type only a cast
  states is at most a warning and says so, and a handler that answers through
  the response it is handed is said to state no type for the answer rather than
  to declare none. `contracts.json` is format 5: a party may carry `claimed`.
- **An answer built by a helper.** `adapters.entry.request` describes the
  project's own helpers once - `return respond(201, order)`, `sendOk(res,
  order)`, `readJson<CreateOrder>(event)` - and they are read beside every
  framework's own places. A helper of a package is matched by the import in the
  calling file, so the package need not be installed.
  `fixtures/lambda-answer-helper`.
- **More of what a request carries.** zod's and valibot's `safeParse`, read
  through the result's `data` / `output`; a status written as a constant or an
  enum member; Koa's `ctx.status` beside `ctx.body`; Hono's `c.req.param()`;
  path params a handler reads that nothing types, named by the path as written;
  and a body a parser in front already turned into a shape, read through the
  cast on `event.body`. An answer whose status the code works out at run time
  is kept apart as `meta.statusUnknown` instead of being dropped, and
  `contracts` says so for a route that answers only that way. A route that may
  answer with a shape or a plain value is compared arm by arm.
- **What a function takes and gives back, in the Graph tab.** The details panel
  shows a method's parameters by name and type and what it returns
  (`create(dto: CreateOrder, note?: string) → Order`), a route's body, path
  params, query and headers and what it responds with, what a call sends and
  expects back, and what a channel's producers put on it. Every named type opens
  underneath to its fields, an enum to its values, a union to its members, as
  deep as asked, or all at once: *expand all* on a row or `E` on a type opens
  everything under it, the section's *Expand all* and *Collapse all* every row,
  a type holding itself is marked `↻ … — see above` rather than opened again,
  and one opening stops at six levels or three hundred rows and says how many
  it left closed. *Copy as TypeScript* copies the face with every type written
  out inline. A node with nothing recorded says so. *Types* above the drawing,
  or `T`, writes the same on one line under every node, remembered in the
  browser and not put in the link. Every reader records each method's and
  function's parameter names on its node as `meta.signature`
  (`{ params: [{ name, type, optional?, rest? }], returns }`) - NestJS and the
  other back ends it reads (methods however written, and the functions it
  draws: helpers, bot and Lambda handlers), Angular (every method of every class
  it indexed) and React (components, hooks and functions) - and writes the bare
  `params` and `returns` on every `calls` edge into them. A route's `handles`
  edge carries them only where what the handler returns is what the request is
  answered with (a controller method), since the contracts read it as that. A
  way in that is not a request - a template event, a bot command, a consumer -
  shows what it hands its handler (`onSave(order: Order) → void`). Every method
  and function of every service now has one, every edge between two functions
  carries its types, and every way in shows its handler's. Eight fixtures whose
  graphs held no types before now hold some, so `contracts` reads them and their
  reports are snapshotted. The page ships only the types those reach.
  Hovering a node, or moving the keys onto it, shows the same in a card beside
  it with one level of each type it names (four types of eight rows at most, the
  rest counted), and hovering a type in the details peeks at its fields without
  opening it; the card replaces the node's browser tooltip and never shows on a
  touch. The pointer can move onto the card, which scrolls, and what it counted opens
  there: *+N more — show* on a type, the rest of a long face, the types it left
  out, up to 200 rows a card. A type's name on it, its title, or a click on its
  node opens the details with what the card showed already open.
- **`visualise --editor-links <vscode|cursor|idea|file>`** makes every
  `file:line` on the page open in that editor. Off by default: it writes each
  repository's absolute local path into the page.

- A host listener's method - `@HostListener` on a method, or a `host` entry like
  `'(focus)': 'onFocus()'` - is a method node the directive names in
  `meta.hostMembers`; the `visualise` details panel lists them as links that
  centre on the method. The hover card of a route that reads no request parts no
  longer says so when it responds or answers otherwise.
- A data kit's client handed in typed by a named interface is followed with no
  `clientType` on the row when the factory resolves and is declared to return that
  type; a `clientType` is matched through a namespace import too (`kit.DataClient`,
  and `ReturnType<typeof kit.createClient>`).
- React Router's `app/routes.ts` follows `flatRoutes()` - as the whole config,
  spread into it, or under `prefix` / `layout` - reading the directory it names by
  Remix's flat convention; a module the config names that is not in the project is
  a `route-module-not-found` row instead of being skipped in silence.
- A SvelteKit page's `load` (and a layout's) and each of its form actions answer
  with what they return, so the page's GET is typed by its data; a layout at `/`
  keeps `rawPath` `/` like every other route.
- In `visualise`, a route's one line marks its other answers - `+2 failures`,
  `status ?` - and a route that answers only under a worked-out status shows that
  answer (`status ? → Station[]`) instead of saying no request parts were read.
- An Angular directive's (or component's) host bindings - its `host` object and
  its `@HostBinding` / `@HostListener` members - are recorded as
  `meta.hostBindings` (`[class.active]=isActive`, `(click)=toggle($event)`), with
  its `exportAs`; a pipe's node says whether it is `pure`. The `visualise` details
  panel shows all three, a pipe that is not pure as `pure no`.
- A data kit's client handed in rather than made in place is followed too: a
  parameter or an injected field declared `ReturnType<typeof createClient>`,
  `typeof db`, or the type named by a row's new `clientType` under
  `adapters.db.tables` is the factory's client, so `this.db.insert('orders', row)`
  is a query of `orders`.
- A Remix `action` that compares `request.method` to string literals answers the
  verbs it names rather than a POST. React Router v7's `app/routes.ts` is read:
  `route()`, `index()`, `layout()` and `prefix()` give each named module its
  address, params named as configured, and its `loader` and `action` are ways in as
  a Remix route module's are; a repository with `@react-router/dev` is typed
  `react-router`. `data(x, { status })` is read as an answer beside `json`.
- A SvelteKit page's server module is read as ways in: the `load` of a
  `+page.server.ts` or `+layout.server.ts` answers the page's GET, and each of a
  page's `actions` a POST - the default at the page's address, a named one at
  `?/name` (keyed `POST:/orders/:param?/note`, with `meta.action`). A form action's
  `request.formData()` is read as its body.
- Angular directives and pipes have nodes and signatures: a directive (a
  `ui_component` of kind `directive`, with its selector) takes its inputs and gives
  back its outputs, read the way a component's are; a pipe (a `provider` of kind
  `pipe`, with its name) says what its `transform(value, ...args)` takes and gives
  back. Both are injected into and imported by standalone components like any
  other declarable.
- A row under `adapters.db.tables` may name a `factory`: `name` is then a method
  of the client that factory returns, so `const db = createClient();
  db.insert('orders', row)` from a data kit nobody installed is a query of
  `orders`. The receiver is followed back to the factory's call through a
  variable, a class field, an `await` or a chain.
- SvelteKit and Remix routes are read as ways in. A SvelteKit `+server.ts` under
  `src/routes` answers at its directories' address (groups drop out, `[id]`,
  `[[id]]` and `[id=matcher]` are params, `[...rest]` the rest), and a Remix flat
  route - `app/routes/api.orders.$id.ts`, or that folder's `route.ts` - answers a
  GET by its `loader` and a POST by its `action`. Both keep the path with its params
  named as `rawPath`, and the repository types `sveltekit` and `remix` are guessed
  from `@sveltejs/kit` and `@remix-run/*`. A handler's params bound in its parameter
  list - `({ params }) => params.id` - now count as read, so they are named by the
  route too.
- `visualise` shows what a route answers besides its own response: the hover
  card and the details panel list its failures by status (`404 → Problem`) and
  mark an answer sent under a status its code works out (`status ? → ...`), and
  a service's details on the Map count the routes with failures and with an
  unknown status.
- A helper that builds its answer from several arguments - `fail(400,
  'bad_input', message)` - is described with `fields` on its `answers` row under
  `adapters.entry.request`: each field of the answer names the argument it comes
  from, and the route records `{ code: string; message: string }` as its failure
  under the status, with nothing of the helper's package installed.
- A route a file-system router serves (Next.js `app/` and `pages/api/`, Medusa
  `src/api/`) keeps the path with its params named by its directories -
  `[id]` is `:id`, `[...slug]` is `:slug`, `[[...slug]]` is `:slug?` - as
  `rawPath`, so a handler that reads params nothing types gets them named by the
  route, as a registered route's already were.
- An Angular component says what it takes and gives back in the Types view: its
  inputs (`@Input()`, `input()`, `input.required()`, under the name a template
  binds) as its parameters, and its outputs (`@Output()` emitters, `output()`)
  as an object it gives back. A tRPC procedure says the input its schema checks
  (a zod-style schema's output, a parser's result, or the object itself) and what
  its resolver answers.
- `adapters.db.tables` names the functions a data access goes through when they
  name their table at the call - `insert('orders', row)` from a data kit nobody
  installed - so each call becomes a query of that table and the Map shows its
  data boxes. Matched by the import in the calling file, like an answer helper;
  a local that shadows the imported name is no longer taken for the helper, for
  answer and request helpers too.

### Changed

- **`flow` takes a workflow's steps in the order control moves**, not the
  order they are written in: what a step does first, then its branches, its
  `Choice` rules and `Default`, its `Next`, and its `Catch` last, even where the
  `Catch` is written above the `Next`.
- **`flow` from a workflow goes as far as the workflow does.** Without
  `--depth`, a walk from an entry that is a chain of steps goes one hop per step
  and then the usual eight, so the last step of a workflow longer than eight is
  reached, and so is the handler it invokes. `get_flow` does the same when it is
  not given a depth.
- **`impact` climbs a workflow without `--depth`.** A walk back up from a
  handler goes the usual eight hops and one more for every workflow step it
  climbs, so a handler a workflow invokes is followed up to whatever starts the
  workflow - a route in another repository, through a rule - where it used to
  stop at eight and say the chain ended before an entry point. The graph
  server's `impact` tool does the same.
- **`visualise` writes `graph.html` next to the configuration** it read, found
  the same way the database is, rather than in the working directory; given only
  `--db`, it still writes to the working directory. The documentation said
  "beside the graph", which neither was.
- **The graph's schema version is 6**, for the `invoke` and `workflow` entry
  kinds. A database built by an earlier version is refused with a message to
  rebuild.
- **A `.tf` or `.tfvars` change re-reads the service.** The build cache stamps
  the files that describe a deployment beside the sources, so changing a
  function's name in Terraform alone is no longer answered with `0 files
  changed`.

### Fixed

- **Expanding a node in the Graph tab keeps to the flow.** The neighbourhood
  reads left to right - the focus looks both ways, a node on the right only
  further right, a node on the left only further left - but expanding a node
  (its `+N`, `+`, or the panel's button) drew its neighbours both ways, so
  expanding a shared helper the flow calls drew every other caller of it. It
  now goes on the way the node looks: a node on the right adds what it reaches,
  a node on the left what reaches it, the focus both. Who else uses a node is a
  separate action - its *used by N others* badge, `O`, or *Who else uses this*
  in the panel, which counts them - drawn faded and dashed as context, labelled
  *also uses …*, grouped by service and class, with a legend entry; `+N`
  counts only the flow. The address carries it as a sixth segment, after the
  filters. **Links made before still open**, and the nodes they expanded are
  expanded in the flow, so such a link now draws less than it did: a route with
  its helpers expanded used to draw mostly other routes' callers, and now draws
  only the flow.
- **A walk goes on to a node whose id is part of another's.** The cycle check of
  every walk - `flow`, `impact`, the graph server's - asked whether a node's id
  appeared anywhere in the path so far, so `Auth.refresh` was never
  reached through `Auth.refreshToken`. It now compares whole ids,
  so `impact` on a busy channel no longer stops short of nodes that do reach it.
- **The `visualise` page draws a label as text.** A label holding markup -
  `requireSecret<Ctx>(...)`, `click="save()"` - was written into the page as
  HTML and broke the row it was in; a title or label holding `$'` or `$&` was
  read as a replacement pattern while the page was assembled; and the walk's
  depth and cap controls stayed on screen under the other tabs.
- **Four names followed through** (R175):
  - A helper written as a module function — `export const startWorkflow =
    (arn, input) => …`, `function notifyFunction(name, event)` — hands its
    caller's value on as a method does. The forwarding every reader shares
    follows it out to each call, by its name, a name it was imported as, or its
    module's namespace, so a start, an invocation or a request is drawn at the
    caller that decides its address rather than inside the helper as
    `start ?` with a `start-name-unread` row. A call through a namespace import,
    `functions.notifyFunction(…)`, is drawn as a call instead of a
    `call-dynamic-receiver` row. A request followed out to a caller whose value
    is not read keeps a hole that fills one segment as a route parameter
    (`fixtures/start-workflow-function-helper`; `fixtures/nest-held-calls` now
    draws GitHub's tarball request on `SkillsService.bundle`, which decides it).
  - A wrapper called by another name — `const traced = tracing.traced`,
    `tracing['withRetry']`, `import { traced as t }` — is read as the wrapper it
    names: `static` where it was `heuristic`, and a factory under another name is
    no longer landed on the function it was handed
    (`fixtures/lambda-wrapper-alias`).
  - A service at the root of its own workspace reads the members it declares
    inside its own directory: functions in `src/` and their client in
    `packages/workflows` were read without the client, and the start it makes
    was missing with no row (`fixtures/lambda-workspace-root`).
  - An address read from the environment with a default beside it,
    `process.env.QUEUE_URL ?? '<url>'`, sends to the default from a function
    deployed without the variable, instead of being an `environment-not-set`
    row; the deployment's value wins where it is set, and the edge's `defaults`
    says which variables the default stood in for
    (`fixtures/sqs-environment-fallback`).
- **Following a value out of a helper is never worse than drawing it in the
  helper.** A request, or the name of what a call starts, is drawn at a caller
  only where the caller's argument reads it at least as surely as the helper
  does; otherwise the helper keeps it, with its own node and the caller's call
  into it. ``fetch(`https://host/bot${token}/${method}`)`` in a function called
  with a token nobody can read was, since the change above, a `heuristic`
  request on the caller with a `dynamic-http-url` row, and the helper's node and
  the call into it were gone; a method of the same shape had always read that
  way. A caller's value filling part of a segment is now the text it is:
  `bot${token}` filled with `'desk-bot'` reads `/botdesk-bot`, where it read
  `/bot/desk-bot` (`fixtures/nest-helper-keeps-request`).
- **A definition loaded through a local or a variable is watched.** The files a
  Terraform configuration loads are stamped by the paths `file()` and
  `templatefile()` were evaluated with, not read off the `.tf` text, so editing
  `file("${local.definitions}/notices.json")` re-reads the service instead of
  answering `0 files changed`.
- **One reading of an ARN or a URL for every reader.** Code publishing through
  the SDK, a state machine definition and Terraform now read a deployed name out
  of an ARN or a queue URL by the same forms: a state machine ARN with a version
  or an alias names the machine in Terraform too, and a partner bus keeps the
  slashes in its name everywhere.
- **A stack the tool cannot read is described as what it is.** Four answers
  that sent a first-time reader the wrong way (R170):
  - `doctor` said a service with no way in at all was a partial read with its
    dependencies missing, and installing them changed nothing. A server that was
    read and that nothing in the graph reaches is now the first line of the
    report and the first sentence of the verdict, with what the repository looks
    like — a deployment tool or framework nothing reads, a readable framework
    under another type, or a library — and is left out of the sentence about
    dependencies. It changes no exit code. `doctor.json` lists such services
    under `unresolved.withoutWaysIn`. The verdict is now an ordered list of
    rules, and `--strict` with no baseline is one of them rather than a patch
    the command applied afterwards; the exit code is unchanged.
  - `init` over many repositories it could not type printed every name.
    Past five, it counts them: the stacks it recognised and has no reader for,
    and what the rest have in common. `--list-unknown` names every one.
  - `init` and `link` wrote a configuration far from its repositories with
    paths like `../../../../../../../Users/…`. A path that climbs to the root of
    the file system is written absolute.
  - A repository with a `src/` was read in `src/` only, so handlers in
    `functions/` beside it were never opened and never stamped: a request they
    made was missing, and an edit to one was answered with `0 files changed`.
    The source roots now come from the tsconfig's `include` and `files`, and
    for a server whose deployment is read, from every directory it packages
    functions from; `src/` is the fallback. The reading and the build's file
    listing ask one function for them, so they cannot disagree.
    `fixtures/lambda-functions-beside-src`.
- **A row sits where the walk goes.** A row about something a deployment
  declares was anchored to its Terraform address, which is no node, so a path
  through it looked complete (R173):
  - Every row the deployment reader writes names the node drawn for what it is
    about: a function's `invoke` entry, a route's entry, the consumer or entry a
    rule, mapping, subscription, schedule or pipe delivers to, a state machine's
    entry. Only a declaration nothing was drawn for keeps its address.
    `subscription-target-unread` on a subscription is counted by `flow` through
    the topic, and `function-name-unread` names the function's entry.
  - A route integrated straight with a function whose handler is not read
    reaches the function's `invoke` entry, in its own repository or, joined by
    the deployed name, in another; `flow` from the route counts that entry's
    rows instead of `unresolved on this path: 0`.
  - A route integrated straight with a queue, a topic or a bus is no longer
    counted by `build` and `doctor` as a way in without a handler: its work is
    the message it sends.
  - A call a broker or `starters` description reads no longer also leaves the
    `call-dynamic-receiver` row the call graph wrote about its untyped receiver.
  - `doctor --format github` annotates a service with no way in as a
    `::warning` on the line of the configuration that names it, and the check
    says nothing about a service declared by a document, by rule.
  Baselines that accepted one of the moved rows see it as new under its node.
  `fixtures/lambda-namespace-handlers`, `sqs-sns-terraform`,
  `eventbridge-terraform`, `start-workflow-helper`, `multi-repo-doctor`.
- **A row about a publish or a start names the producer, so `flow` counts it.**
  A publish whose channel, or a start whose workflow or function, could not be
  read is drawn as a producer its body calls, and its row named
  `OrdersService.publish -> topic` or `producer:<id> -> <text>`, which is no
  node, so a path through it printed `unresolved on this path: 0` (R177). The
  rows the broker, socket and starter readers write about a call -
  `channel-dynamic`, `channel-const-unresolved`, `channel-from-config`,
  `channel-from-environment`, `start-name-unread`, `start-from-environment` -
  now name the producer by its id, as the linker's `environment-not-set` rows
  already did, and say what was not read in their `message`. A route into a
  start whose name was recorded elsewhere, or a publish to an environment
  variable nothing deployed sets, counts 1. A handler whose channel could not be
  read keeps naming the method: it is on no channel and under no entry, so no
  walk passes it. `doctor` still answers such a row from an `@Emits` on the
  method that calls the producer.
  **Baseline keys change for these rows**: a key now names the producer, whose
  id is its place in the file, where it named `method -> expression`. A
  baseline accepted before this lists them under `gone` and their new keys under
  `new`; the total is unchanged, so `--strict` still passes, and
  `doctor --accept` writes the new keys. `fixtures/aws-sdk-publishers`,
  `start-workflow-by-record`, `multi-repo-doctor`.
- **`doctor` prints what a row is about, not the id it is keyed by.** A row
  about a node names it by id, and the text report and `--format github`
  printed that id beside the place: `producer:orders#src/orders/orders.service.ts:71:5`
  where a reader used to see `OrdersService.tally -> this.config.get('SWEEP_CHANNEL')`.
  Where a row's symbol is a node id, the report prints the row's message in its
  place - the body and the expression of a publish or a start, the rule or the
  subscription a deployment declares, the step of a workflow, the request the
  linker could not join. `doctor.json` and the baseline keys still carry the id;
  only what is printed changed.

- **A property of a parameter is no longer reported as a constant nobody could
  read.** `event.detail.type` read off a parameter is decided by each caller,
  and its row now says the channel is built at run time, as the parameter's own
  row does.

- **`build` no longer writes into the repositories it reads.** Each service's
  own graph and file hashes went to `<repo>/.flowatlas/`, which the
  documentation never said: it named three files in the output directory. Pointed
  at somebody else's checkouts for a read-only look, a build left an untracked
  `.flowatlas/` in every one of them, and two projects whose configurations name
  the same repository shared one set of those files and overwrote each other's,
  so each made the other's next build read everything again. Both now live under
  the configured output, at `<output>/services/<name>/`, and follow `--out`. A
  service name is written as one directory whatever it holds — `@shop/orders` is
  `%40shop%2Forders` — and two names never share one, even on a disk that ignores
  case. `flowatlas extract` on its own is unchanged and still writes where
  `--out` says.
- **The `.flowatlas/` an earlier version left in a repository is named, not
  deleted.** `build` says once which of them nothing reads any more and that they
  are safe to delete; `--json` carries the same sentence in `notes`. An output
  directory configured inside a repository is not one of them.
- **A watch no longer rebuilds for ever when its output is inside a repository
  it reads.** The output was left alone because its default name starts with a
  dot. Named anything else, every build's own writes came back as a change; it is
  now left alone by where it is.
- **The build cache is version 3.** The first build after upgrading reads every
  repository once, says `cache-invalid:version`, and is incremental from the
  next.
- **A handler wrapped with the function second lands on the function.** A
  tracing, retry or metrics helper that takes a name or options first —
  `traced('createLoan', createLoan)`, `withRetry({ attempts: 3 }, fn)` — or the
  function first and options after, left a Lambda function with an entry and no
  body, and an Express, Fastify, Koa or Hono route with none either. A call
  handed exactly one function is now a wrapper of it wherever it sits, inline,
  through a `const`, and inside a middleware chain (`middy(traced('x', fn))`).
  The edge is `static` where the wrapper's source or its package's declarations
  were read, and `heuristic` with the reason in `wrapperUnread` where its package
  is not installed. A call handed two functions is still a row naming the call.
  `fixtures/lambda-wrapped-handlers`, `fixtures/express-traced-handlers`.
- **A handler re-exported through a namespace lands on the function.**
  `export const processReturns = operations.processReturns` with
  `import * as operations`, the same in brackets, and a `const` bound to another
  such name were read as an export that names no function, so a Lambda function
  written that way had an entry and no body. They now land where the function is
  declared, as `export { x } from` and `export *` already did, and the edge is
  `static`. The reading is the core's, so a name in brackets with its key
  written out (`TOPICS['opened']`) is also read as the constant it names, by
  every reader. `fixtures/lambda-namespace-handlers`.
- **`flow` counts the function a path ends at when its handler could not be
  read.** A route through a queue to a function with no body printed
  `unresolved on this path: 0`: the row was recorded against the function's
  Terraform address rather than its `invoke` entry, which the walk arrives at.
  The rows a function's handler leaves are now recorded against its entry, and
  `doctor` names the entry; the count also takes in the nodes a walk reaches past
  the `maxNodes` it shows. The CLI and the MCP `get_flow` give the same number.
- **SvelteKit route files at one address are no longer dropped in silence.** A
  `+layout.server.ts` load was the address's GET and hid the `load` of the page
  at the same address; it is now an entry of its own (`meta.contributes:
  "layout"`, key suffix `#layout:<file>`) that no request is joined to. A
  `+server.ts` GET beside a `+page.server.ts` load keeps the address, and the
  page's load is kept too (`meta.contributes: "page"`, key suffix `#page`). Two
  files claiming one verb and address otherwise keep the first and say the
  second in a new `route-claimed-twice` row.
- **File-system route segments.** Remix's `users.$userId_.edit` is
  `/users/:userId/edit` (what is left of a segment after its trailing
  underscore is read as usual, not as a literal), `sitemap[.]xml` is
  `/sitemap.xml`, and `(en)` is an optional literal segment. SvelteKit's
  `foo-[id]` is keyed `/foo-:param` with the param named in its path as written
  (`rawPath: "/foo-:id"`), so `foo-[id]` and `bar-[id]` beside each other are two
  routes, either wins over a bare `[id]`, and it is joined to `/foo-42` and not
  to `/bar`; `[x+2e]` / `[u+00e9]` are the characters they escape, an escape for
  `?`, `:` or `/` stays encoded (`%3F`, `%3A`, `%2F`), and one past the last
  code point is read as the text it is. A request that leaves an optional segment out (`[[lang]]`,
  `($lang)`, `(en)`) is joined to the route.
- **A build re-reads a browser repository whose installed declarations were
  edited.** The Angular and React readers recorded no installed files, so an
  edited stub left their graphs cached; every reader now records them, and
  `.d.mts` / `.d.cts` declarations and the TypeScript of a linked workspace
  package under `node_modules` are recorded too.
- **A build re-reads a browser repository whose template or script was edited.**
  The cache an Angular or React read writes listed only its `.ts` and `.tsx`
  files, so an edited `templateUrl` file, or a `.js` / `.jsx` file a React
  tsconfig lets the checker resolve, answered "0 files changed" and kept a stale
  graph. Both readers now list those files beside their sources, and the cache
  and the build's survey list a browser repository's files the same way.
- **A repository factory is found again in a repository held open across
  rebuilds.** The declarations found for `adapters.db.tables` rows were kept for
  the life of the parsed project, so a warm rebuild after the factory's file was
  saved failed on a node that was gone; they are now found once per read.
- **Answer and request helpers** of a package are matched through a default
  import called itself when the row names `"default"`, and through a barrel of
  the repository's that re-exports them from the package, including a default
  import exported again by name (`import respond from 'pkg'; export { respond }`
  is the package's `default`). A name two `export *` pass on from two places is
  ambiguous to the compiler and matches neither.
- **Angular host listeners** link to a function-valued property
  (`onClick = () => …`) and to a method a base class declares, and a
  `@HostBinding` on a set-only accessor is read.

## [0.5.0][] - 2026-09-28

`@flowatlas/cli` only; `@flowatlas/markers` is unchanged at 0.2.0. The graph's
schema version moved, so a database built by 0.4 is refused with a message to
rebuild: run `flowatlas build` once after upgrading.

The tool read NestJS and Angular deeply and almost nothing else. It now reads
the shapes most TypeScript is actually written in — a route registered by a
call, a route that is the path of a file, a procedure in a tree, a component
that is a function, a query outside a class, a monorepo whose handlers live in
its packages, a repository nobody has installed, a service whose source you do
not have — and it says so about each one it cannot read rather than producing a
graph that is smaller than the project without mentioning it.

Every shape below is held by a fixture under `fixtures/`, named beside it, whose
README says what it exists to prove.

### Added

- **Express, Fastify and Koa**, where a route is registered by a call rather
  than declared by a decorator. One reader over all four call-registered
  frameworks, parameterised by a description of each; Hono became the first row
  of that table rather than the only implementation. The routers a route is
  mounted through and the middleware in front of it — including middleware
  installed on an application above the mount and inherited through it — are
  read, which is what lets the route audit answer on these repositories rather
  than defer to a person (`express-service`, `fastify-service`, `koa-service`).
- **The shapes a registration is really written in.** An application declared by
  a chain, `express().disable('x-powered-by')`, is that application
  (`express-chained-app`). A list of paths is one way in per path, written in
  place or named elsewhere (`express-path-array`). A mount through a published
  helper — `app.use(mount('/api', api))` from `koa-mount` — places the routes
  under its prefix, with the helper described once by the package it is imported
  from; a helper the repository wrote itself is a row naming the call the path is
  inside (`koa-mount-helper`). One mount over a collection of applications that
  plugins add themselves to is followed back to the calls that fill the
  collection, and a collection a package publishes is one row naming it
  (`koa-plugin-registry`). A named handler handed to a wrapper the repository
  declares, `asyncMiddleware(getVideo)`, is `getVideo`, and a factory called with
  values is read as having built the handler; a factory handed a function keeps
  no handler, because it cannot be told from one more wrapper
  (`express-wrapped-handler`).
- **An application recognised from what the source states.** In a repository
  whose framework is not installed the application's type resolves to nothing,
  and a reader that knows an application by its type read no route at all.
  `import express from 'express'` and `const app = express()` say what `app` is
  with or without types, so that is read where the checker commits to nothing —
  a call or `new` of a described export, an annotation, a class extending one, a
  function returning one — for all four call-registered frameworks from one
  description. Every route read off such an application carries `heuristic`
  confidence (`express-not-installed`).
- **A file-system router is four values.** The root directory, which file names
  declare a route, the prefix in front, and which segment spellings the router
  honours: that is all that differs between one and another, so the walk, the
  verb reading and the rows for a verb with nothing behind it are shared, and
  each router is a row of data. Next.js is three rows and Medusa is a fourth,
  with its declarative middleware list read and a matcher written as a regular
  expression reported rather than guessed (`medusa-fs-router`). A file under a
  directory the router does not serve is an `info` row, `route-file-not-served`,
  rather than silence. A file-system router nobody has described is still a row
  saying the reader cannot tell it from a library (`express-fs-router`).
- **React and Next.js.** A request is found wherever it is written and walked
  back to the component or hook that decided the address. A Next.js route is a
  directory path and a file name, with no call and no decorator registering it;
  a server action is a boundary with no address at all, crossed by an import,
  and one built by `next-safe-action` or `zsa` is read as the function it was
  handed (`react-next`, `next-actions`). A repository that is a browser and a
  server at once is read once, by the reader that reads both halves, into one
  graph (`koa-react-full-stack`).
- **A client class a project wrote itself.** A class is read as an HTTP client
  when one of its own verb-named members can be followed to `fetch` or `axios`,
  directly or through another member; that is evidence rather than a name, so a
  store with `get` and `delete` is not one. Where the chain leaves the class,
  `adapters.frontend.localClientClasses` names it. A base the class holds —
  `this.baseUrl = options.baseUrl || '/api'` — is folded into every address it
  writes, and a base a single call overrides with `{ baseUrl }` wins for that
  call. A verb called on a class of the repository that could not be read as a
  client, with an address written in the call, is an `api-client-unread` row
  (`react-local-client`, `react-client-base`).
- **A procedure is a boundary too.** A framework whose ways in are the *keys* of
  a tree of object literals — tRPC, and the family around it — is read, and each
  procedure is an entry point of kind `rpc` whose address is every key from the
  root of the tree down to it, which is the same string its caller writes.
  Guards inherited through a procedure definition in another file are read with
  it, and the file that mounts a tree either says which ways in it serves or
  produces a row naming itself (`trpc-router`). `adapters.entry.procedures`
  exposes the same description the shipped reader is written as.
- **Callers of a procedure are requests, joined by path.** `trpc.orders.list
  .useQuery(…)` and `client.orders.create.mutate(…)` are requests of kind `rpc`
  carrying the path and whether the server must have declared a query or a
  mutation. The linker joins them in the caller's own service, then in the
  services its `apiTarget` names, and nowhere else, because a procedure path is
  short and common; a call of the wrong kind joins and says so in
  `procedure-call-mismatch`. What a caller sends is not compared with what the
  procedure takes, and `contracts` lists every procedure boundary as unchecked
  with that reason (`trpc-join`).
- **An address is an address within one application.** A service that creates
  two applications — a NestJS API and a worker started by path, or a second
  Next.js application under `examples/` — serves the same path twice, and the
  second used to land on the first's id and vanish without a row. An entry's id
  now carries the application where a service has more than one,
  `entry:api@WorkerModule:http:GET:/health`, and nothing where it has one, so an
  ordinary service's ids do not move. NestJS applications are found by walking
  the repository for `NestFactory`; a file-system router's application is the
  directory in front of its root, and the one at the service root is `.`. A
  request records the application its file is written in, so a relative
  `fetch('/api/orders')` inside one application reaches that application's
  route. A request from outside every application is answered by deployment,
  which no source says, so it names both in an `ambiguous-route-application` row
  and chooses neither. A module whose controllers are spread from an array built
  elsewhere is a `module-controllers-unread` row, because membership now decides
  an address (`nest-two-applications`, `next-nested-apps`,
  `next-caller-application`).
- **A mount read from a setting every environment file leaves empty.** A route
  whose address begins with a part read from settings is never joined, because a
  hole may stand for anything. Where every committed `.env` file of the service
  leaves those settings empty or absent, the part is now taken as empty, as a
  browser's base read from a setting already is: the join is `heuristic`,
  carries `mountAssumedEmpty` on the edge, and writes an `info` row,
  `route-mount-assumed-empty`, naming the settings. One file that sets them, a
  service with no environment file, or a hole in the middle of an address keeps
  the old refusal (`nest-mount-empty`, `nest-mount-set`). A request that reaches
  no route only because of such a hole now names the route behind it rather
  than saying nothing serves it (`nest-context-path`).
- **Where a channel's name is written**, said as a list of locators rather than
  as an argument index. A description can now name a channel that is a property
  of an options object (`jobs.queue({ name, data })`, `@OnJob({ name })`) or that
  is the receiver itself, stated once in the `super(...)` of the class behind it.
  The vocabulary is the one the data layer already used to find a table name, and
  it is now literally the same type in the core rather than a second list that
  agreed with it. `channel` is available on a `producers`, `subscribers` or
  `consumers` entry of `adapters.broker.custom`, documented in `docs/CLI.md`;
  `channelArg` remains as the shorthand for argument 0 (`object-channels`).
- **Where a message sits inside what a call is handed.** `payloadPath` on a
  publishing call, and `payloadArg` and `payloadPath` on a described handler,
  locate the message inside an envelope. Without it the two ends of one channel
  were compared as they stood, and a correct handler was reported as requiring a
  field nobody sends.
- **A handler registered by a call has a way in.** A consumer found by pairing a
  `subscribe(channel)` with its listener, and a decorated handler no entry reader
  knows (`@Process`, a described bus's `@OnJob`), now get an entry and a
  `handles` edge like any decorated one, so what they receive is compared rather
  than reported as a receiver whose shape cannot be read (`fn-broker`).
- **socket.io, read from both ends.** `@SubscribeMessage` in a gateway and
  `socket.emit` in a browser are two ends of one channel, under the namespace
  the gateway declares. A namespace a server opens with `io.of('/live-videos')`
  is read too: both ends ask one function which endpoint the value a call is made
  on carries, through variables, fields, the transport's own chained calls and
  the connection a listener is handed (`socket-channels`, `socket-namespaces`).
  A stream is still not a channel: a browser holding one open never names what
  it is waiting for.
- **Every spelling of a Redis subscription.** The `redis` client spells the
  verbs `subscribe`, `pSubscribe` and `sSubscribe`; the description held two
  lower-case spellings matched exactly, so pattern and sharded subscriptions on
  that client were read by nothing. A subscriber's `method` may now be one name
  or several (`nest-redis-v4`).
- **Kysely**, where the connection is the whole database and every query begins
  by naming its table: `selectFrom('asset')` and the three calls beside it. The
  schema is in the connection's type argument and is not a table, so the
  descriptor says so rather than letting the fallback name one (`nest-kysely`).
- **The decorated form of a Sequelize model**, which is how a TypeScript project
  declares one: the table is in `@Table({ tableName })`, the model class is
  declared in the repository while the base it extends comes from
  `sequelize-typescript`, and `Model.scope('withOwner')` retypes the receiver to
  a name no reader could parse. All three are records now — an alias saying the
  two package names are one library, a decorator to read the table out of, and
  the list of calls that narrow a model and hand back the same model
  (`nest-sequelize-typescript`).
- **Drizzle, Mongoose, Sequelize and Knex**, where the table is named in the
  call rather than in a type — `from(users)`, `knex('orders')`,
  `Model.init(…, { tableName })`. A table assembled at run time is reported
  rather than guessed at (`nest-drizzle`, `nest-knex`).
- **A data layer read from what the source states.** Without `node_modules` the
  checker will not say what a receiver is, and every data layer read as nothing.
  An annotation still names the type and the import beside it names the package,
  and a model class of the repository names its base the same way, so those are
  read where a resolved type produced nothing, for a library something here
  describes. Every query read that way is `heuristic`; the same repository
  installed reads the same tables at `static` (`db-not-installed`).
- **A query builder an ORM hands over.** `manager.getKnex()` on a MikroORM
  manager returns knex, and every query after that call is knex's own. The step
  is a record beside the knex descriptor — this method, on something these
  modules declare, yields that library — so a project that reaches knex only
  through its ORM is read without naming knex in its manifest. Where the manager
  does not resolve, its type is read from the type argument, cast or annotation
  that states it, at `heuristic`. An alias written as an object,
  `knex({ il: 'inventory_level' })`, names its table
  (`nest-mikro-orm-knex`, `nest-mikro-orm-knex-not-installed`).
- **A service whose source you do not have.** A service entry may name a
  document instead of a repository, `document: { kind, path }`, and its routes,
  channels and shapes join and compare like any other end. `kind` is `openapi`
  or `asyncapi`, versions 2 and 3 of the second, including the fact that version
  2's `publish` means the service *receives*; the older `openapi: <path>`
  spelling still works. Every edge that exists because a document said so is
  marked `declared`, every party names the document, and every finding's
  sentence says the end was declared and not read. Nothing here checks a
  document against the service it describes, and the tool says so rather than
  implying otherwise (`multi-repo-declared`, `multi-repo-asyncapi`).
- **An HTTP framework described in configuration.** `adapters.entry.http`
  exposes the same description the four shipped readers are written as, so a
  framework nobody here has heard of can be read without a pull request. All
  four were rewritten as descriptions through that schema, which is what proves
  it rather than asserting it (`custom-http`).
- **A reading that placed some routes says how many.** `entry-http-routes-unplaced`
  says how many of the routes a reader read it could place at an address, so a
  service where three routes were placed and hundreds were not no longer looks
  like a service with three routes.
- **A file the parser cannot read says so.** It used to produce no node, no
  edge, no row and no mention — the count of files read was the only place it
  appeared, and it argued the opposite of the truth (`unreadable-file`).
- **A read without dependencies says so, once.** After the `unresolved` line of
  `extract` and `build`, and at the head of `doctor`, one sentence says that a
  repository's dependencies are not installed and that the read was partial,
  and what an install recovers: what a package declares, never what a package
  generates. It is printed only where there is no `node_modules` and something
  went unresolved.
- **`build` names a framework a service has only through a member**, on a
  `found at arm's length` line naming the member, because that is right when the
  member's code runs in the service and wrong when it only imports the
  framework's types, and the rule cannot tell the two apart
  (`next-sibling-nest-types`).
- **A harness that measures the tool against repositories nobody here wrote**,
  listed in a local, gitignored `scripts/coverage/targets.local.json` (shape in
  `targets.example.json`) and pinned at a commit, read fresh and with
  dependencies installed, counted by one rule written once, with a report per
  target and state written to be compared as a diff. The list, each target's
  exemptions and the reports stay on the machine that measures: they name other
  people's repositories, which this project does not.
  Its read gate — a file with a route, a screen, a click or a query in it must
  yield a node or a row naming the file — also runs over every fixture as the
  last step of `pnpm fixtures:check`. `docs/coverage.md` describes it.
- Four gates: **I2**, no raw control character in any file; **I12**, no
  extractor reachable from a sibling extractor; **I13**, every reason a row
  carries is a reason `doctor` knows; **I14**, the coverage harness and the tool
  agree about what a service is. Each was watched failing before it was trusted.
- **A fixture's run is held whole.** An output a fixture's run writes that no
  snapshot holds is a failure rather than a silence, every project fixture's
  contracts report is a compared snapshot, and a fixture whose build is not yet
  trusted as an expectation is named in `UNHELD` with the disagreement, printed
  on every run.
- **A Prisma call with no generated client.** A fresh clone has no
  `prisma generate` output, so `prisma.booking.findMany()` had no type and was
  not a query. The client is now followed through the import that binds it,
  including into an unlinked workspace package, and a module that does not exist
  counts as the Prisma client only where a `schema.prisma` names it as a
  client generator's output. The model maps to its table by `@@map` when the
  schema is readable. The context object tRPC hands a handler, a destructured
  client, a narrowed type (`Pick<PrismaClient, 'order'>`) and a client loaded by
  `await import()` in any of its three spellings are read. Every edge is
  `heuristic`, and a local value merely named `prisma` is never read
  (`prisma-not-generated`).
- **The SQL handed to `knex.raw`** is read with the reader a driver's query
  text is read with. A `raw` handed to another call of the same builder is part
  of that query, not a second one (`nest-knex-raw`).
- **A request-reply message compares its reply**, the way an HTTP call's
  response is compared: `client.send<OrderDto>(…)` and an acknowledgement
  callback's parameter are the receiver's side, the handler's return the
  sender's, through the same comparison (`multi-repo-contracts`, and the
  Angular socket reader in `socket-channels`).
- **A workspace package imported by its name, with nothing installed.** The
  package's manifest `exports` (exact subpaths, then `*` patterns) or its
  `types`/`module`/`main` is followed into its source, after an installed copy,
  the service's own aliases and the package's own. Only packages the service
  declares resolve (`workspace-package-by-name`).
- **A handler built by a factory of the repository.** `export const GET =
  handlerBuilder` and a route registered with `makeHandler(config)` point at the
  factory, followed through up to four re-bindings, instead of raising a
  `route-handler-unread` row (`next-hollow`).
- **`readTestDirectories`** on a service entry: directories named like tests
  that hold code the application runs, read after all (`nest-test-directories`).
- **A repository base says where its classes name their table.** An entry of
  `adapters.db.localBaseClasses` may be `{ "name": "BaseRepository",
  "tableProperty": "collectionName" }`, and every call through a class extending
  it then reads the table that class sets the property to, as a literal or a
  constant, ahead of its type argument. Inside such a class, a query made through
  `this` (`const c = await this.coll(); c.find(…)`) is on the class's own table.
  A query written inside the base runs for every subclass and is an `info` row
  saying so (`nest-mongo-tables`).
- **The project site says what the tool reads, and lists every fixture.** The
  landing page names every framework, data layer and broker it reads, grouped
  by area, and a new page, `fixtures.html`, lists each fixture with the sentence
  from its README saying what it proves. That page is generated from the
  fixtures, and `pnpm check` fails when it is out of date.

### Changed

- **What stands in front of a way in is an edge.** Middleware read off a
  registration was `meta.middleware`, a list on the entry, while a NestJS guard
  was a node and a `guarded_by` edge, so everything that reads the graph as a
  graph — the route audit, `impact`, `flow`, the settings walk — saw
  call-registered routes as having nothing in front of them. Every reader now
  draws a `middleware` node and a `guarded_by` edge with `meta.order`, tRPC
  procedures and Medusa routes included; a Medusa chain is ordered the way that
  framework runs its list. `meta.middleware` is gone; `meta.middlewareRead`
  stays, and stays `false` on Medusa routes, whose framework authenticates
  `/admin` and `/store` in code this does not read.
- **`SCHEMA_VERSION` is 5.** A graph written by an earlier version is refused
  with a message saying to rebuild, rather than half read. Nothing needs doing
  beyond a rebuild.
- **A word out of a configuration file no longer indexes a plain object.** The
  tables that say which reader reads a repository of a given `type`, which one
  reads a document of a given `kind`, and which arguments a marker gives as
  names are `Map`s. A misspelled type or kind was answered with whatever the
  language puts on every object — `constructor` had a reader — and is now
  answered with nothing, which is what a misspelling deserves. `DOCUMENT_READERS`
  is exported as a `ReadonlyMap` rather than an object. A service may no longer
  be named after a property every object has.
- **The control-character gate reads every file in the repository**, in any
  language, rather than `.ts` and `.tsx` under one directory. The file that
  carried two raw NUL bytes — and so went invisible to `grep` — was a script,
  which the gate written for exactly that failure did not cover. What it covers
  and what is exempt are two lists in `scripts/invariants.sh` with a reason
  beside each.
- The `doctor` reason for how old a declared service's document is, was
  `openapi-document-age` and is now **`document-age`**, with the kind of document
  named in the row. There are two kinds of document now and the reason named one
  of them. A reason is configuration surface — it is spelled by hand in
  `doctor.ignoreReasons` — so the old spelling goes on being recognised there and
  nothing has to be edited; write `document-age` in new configuration.
- **A route under a mount whose path could not be read has a reason of its
  own, `route-mount-unread`,** rather than `route-path-dynamic`. The route's own
  path was read; what was not is the path its application is mounted under,
  which is fixed somewhere else and usually by someone else. `route-path-dynamic`
  now means only that the route's own path is computed. A row moves from one
  reason to the other, so a configuration that silenced these rows with
  `route-path-dynamic` in `doctor.ignoreReasons` shows them again: add
  `route-mount-unread` to keep them silent. The old spelling is deliberately not
  treated as covering the new one, because the two are different facts and
  silencing one says nothing about the other. `route-path-dynamic`'s own hint is
  rewritten for what the reader now folds — a `+` or template of constants, and
  a list of paths — and says that such a route is missing, not merely unmatched.
- **`doctor` refuses a graph nobody could report on, with exit 2 and without
  `--strict`.** Four graphs: one holding no node at all, one whose build
  recorded that a repository could not be read, one a service was read into and
  contributed nothing to, and one where most of a service's ways in have no
  handler that was read. This is a change to what a CI job fails on, and it is
  deliberate: 2 has always meant "the check could not be run", which is exactly
  what these are, and every one of them used to answer `unresolved: total=0 …
  none`, exit 0. The last is decided per service and past half, because the
  growth check sees a change only when it adds a row, and a change inside a body
  nobody read never does; below half, the unread handlers are ordinary rows and
  `doctor` prints the two numbers above them. It does not wait for `--strict`
  because a run without the flag still answers a question, and "healthy" is not
  an answer anybody asked of an unread graph. `--accept` refuses the same four
  (`next-hollow`).
- **A build that failed leaves the graph the last good build wrote.** It used to
  write its own answer — the project minus whatever could not be read — over the
  top, which is indistinguishable from a project that really is that small, and
  is how a crash in one dependency's type declarations came to be reported as a
  clean bill of health. The failure is on stderr and in the exit code; where
  there is no graph to keep, the partial one is written with the failure recorded
  against the service beside it, and `doctor` refuses that.
- **`build` counts ways in apart from ways in whose body was read**, in a line of
  its own, because only the second number is coverage of what happens after a
  request arrives. `doctor` reads the same count, from the same function.
- **A receiver named `store` is no longer read as a data layer.** It was the last
  of the name hints, used only where the types say nothing, and across the
  repositories the coverage harness reads it produced rows of which none was a
  data layer: arrays, maps, mutex and plugin registries, a browser object store,
  a framework's cookie store, and the state stores front ends keep their screens
  in. Where it went it took one invented table with it, named after a state
  type. A *type* called `OrderStore` is still read as a data layer, which is the
  half of the hint with a class behind it.
- **A service is an application together with the workspace packages it
  declares**, rather than a directory with a manifest. Pointed at a Next.js
  application in `apps/web`, the tool used to find every route it answers and not
  one of the functions those routes call, because the handler bodies are in
  `packages/features` and `packages/lib` and those were opened only so that types
  would resolve; pointed at the monorepo root it found the bodies and no way in,
  because the root has no application in it. There was no configuration that gave
  both. The extent is now read from `workspaces` or `pnpm-workspace.yaml` and
  needs nothing written down: the application's directory stays its identity and
  the directory every path is measured from, and a file of a package it reads is
  named as one — `../../packages/lib/orders.ts`, where the absolute path of
  whoever ran the tool used to be (`next-monorepo`).
- **The extent stops where the package manager stops.** A member's
  devDependencies are installed only when that member is the one being worked
  on, never for whoever depends on it, so a member is followed through
  `dependencies`, `peerDependencies` and `optionalDependencies` only; the
  service's own manifest is still read in all four sections, since its build and
  its tests live there. A browser tool a library keeps as a devDependency no
  longer switches React on for the server that uses the library
  (`nest-dev-sibling`).
- **`init` derives the service list from the workspace.** A repository that
  declares one is read as the several services it holds: one per member that
  looks like an application, and none for the packages those applications import.
  A member that declares nothing of its own takes the workspace root's manifest
  for the question of what it is, which is the ordinary shape of a server whose
  dependencies are kept at the root, so `init --dir .` over a repository holding
  a server and its browser writes both halves. A repository that declares no
  workspace, and a workspace with no application in it, are one service exactly
  as before.
- **`confidence` has a fifth level, `declared`**, ranking below `marker` and
  above `heuristic`. An annotation is written by somebody who can see the code;
  a document is written by somebody who cannot see yours. Before this, a third
  party's self-description wore the same word as an annotation in your own
  source.
- **A join is no stronger than the route it reaches.** It takes the weaker of
  what it found and what the route is: `declared` where a document declared the
  route, `heuristic` where the route was read off an application recognised only
  from its source, and `heuristic` where a mount was taken as empty.
- The rebuild plan hashes a graph's body rather than the file, so the clock
  inside it no longer makes every reading of an unchanged tree look like a
  change. A graph reprinted with different whitespace now plans `skip`.
- A repository node reports files opened, files read, and the difference,
  instead of one number that counted what it could not read.
- `contracts.json` is at format version 4: a party can name the document that
  declared it, and a reader that did not know would present a declared end
  exactly as it presents a read one.
- Two rows' sentences describe the case that produces them:
  `unknown-db-operation` names a query text that does not open with a verb the
  reader knows, rather than asking for a change to a descriptor that already has
  it, and `route-handler-anonymous` names both shapes that reach it — a handler a
  package's call hands back, and one a factory of the repository builds from a
  function it is handed. Neither reason string changed.
- **A test directory is reported rather than silent.** A directory named like
  tests (`test`, `tests`, `e2e`, `fixtures`, `cypress`, `playwright`,
  `__tests__`, `__mocks__`, `__snapshots__`, `__fixtures__`) is still not read,
  and each one now carries a `test-directory-skipped` row at level `info` with
  the number of source files it held. An `info` row that counts its own sites is
  no longer folded into one row per reason (`nest-test-directories`).
- **The coverage read gate counts an edge or a row only for its own family.**
  A file with query sites no longer passes because one of its functions calls
  another: `queries` answers for data, `handles` from an entry for routes, and
  so on, from one table. An edge's file is placed by the service that drew it.
  The gate also runs over fixtures that keep only a project graph, with
  services declared only by a document set aside by a stated rule.
- **The browser reader reads a file only where the framework is supplied to the
  package that holds it**: by the service, by the member's own dependencies, or
  as a peer by whoever depends on it. A Node API that renders e-mail with React
  no longer has its own server code read as a browser's
  (`nest-rendered-mail`, `nest-member-dev-react`, and `nest-member-angular` for
  the Angular reader).

### Fixed

- **A fixture snapshot nobody compares now fails the gate.** The snapshot check
  decided a fixture had sources by looking for a `src/` directory and pointed the
  comparison at a path that does not exist when it found none, so a Next.js
  fixture laid out with `app/` was validated for shape on every run and compared
  never. A fixture is now found by what it declares, in one table shared with the
  script that runs them, and every snapshot in the gap between the two counts the
  gate prints must be a fixture named with the reason it is validate-only, which
  the gate prints. One is; an entry that no longer applies fails too.
- **Adapter detection follows the members a service declares.** A service's
  extent is its own directory plus every workspace member it declares,
  transitively, and the sources of those members are walked exactly like its own
  — but the manifest an adapter is offered was widened only upwards and
  downwards, never sideways. So a monorepo where the application declares a
  library and the library declares the framework switched the adapter off while
  the framework's code was in the graph. The chain now asks the same question the
  extent does.
- **Adapter detection reads the workspace a repository belongs to.** It asked
  the service directory's own `package.json`, and in a workspace that manifest
  is usually a name, a version and an exports map with no dependencies in it at
  all: every adapter switched off and the repository was reported with no
  routes, no channels and no data layer, which is indistinguishable from a
  repository that has none. The question is now answered off the whole workspace
  chain — the directory's own manifest, any manifest above it that lists it as a
  member through `workspaces` or `pnpm-workspace.yaml`, and, where the directory
  is itself a workspace root, the packages inside it whose sources are read as
  part of it — and `adapters.force` is no longer the only way to read such a
  repository. A service's *type* is still guessed from its own manifest first,
  so a package that declares Express is not read as React because the monorepo
  around it has React in its tooling (`workspace-leaf`).
- **A workspace package's own path aliases resolve its own imports.** A service
  compiles the packages it declares with its own `tsconfig.json`, so a package
  importing its own code through an alias only its own configuration defines
  resolved nothing, and the class behind it was never reached. An import written
  in such a package is now resolved with that package's `paths` first
  (`workspace-package-paths`).
- **A NestJS bootstrap is asked of the package itself.** A Next.js application
  that imports a package of Nest DTOs was told to set `services[].bootstrap` for
  a Nest application it will never have, because the question "is this a Nest
  application" was asked of the manifest widened along the workspace.
- A reader that runs out of memory says so, and is given a heap it can finish in.
  A large monorepo with its dependencies installed exhausted the default heap and
  the build reported three addresses inside a dynamic library, because the words
  "JavaScript heap out of memory" are forty frames above the tail that was
  quoted. A repository read now gets a share of the machine, divided by how many
  repositories are read at once and never less than the runtime would have
  given, and `--heap` or an existing `NODE_OPTIONS` limit wins over that. A read
  that still does not fit names the repository, the limit that did not hold and
  the flag that raises it, and leaves exit code 2 — the code this command line
  uses for a check it could not run.
- Installing dependencies invalidates the build cache. The plan keyed on source
  hashes, the configuration and the tool's own version, so clone, build, install,
  build printed `cached (0 files changed)` and served the graph read without any
  types resolved. What is installed for a service, over the same extent the
  reading uses, is now part of what the plan compares, so the second build
  re-reads and says `dependencies installed in .` for why. The lockfile is hashed
  and the modification time of `node_modules` is deliberately not read: a clock
  inside something the plan compares is a defect this project has closed once
  already.
- A type reference whose object key is not a name round-trips. The writer emitted
  keys as they were written and the reader refused them, so a dependency
  declaring JsonLogic operators — `{ '<=': number }` — stopped every command that
  parses a reference, and a build of a repository depending on it read nothing.
  Keys that are not names are quoted, quoted text carries a backslash escape, and
  a property test generates references from the grammar and holds the reader to
  reading back exactly what the writer wrote.
- A Next.js verb that is exported and whose body could not be followed is a row.
  Only a file exporting *no* verb raised one, so a verb assembled by a helper —
  `export const GET = restHandler(config)`, the dominant spelling in the
  ecosystem's largest repositories — produced a way in, sometimes a `handles` edge
  onto a node with nothing in it, and no mention anywhere (`next-hollow`).
- A service that was read and contributed no node is named by `build`, with why,
  and is a row `doctor` reports. The project already argued that knowing the name
  of a stack it cannot read is worth as much as knowing one it can; that argument
  was applied to a repository with no reader and not to this case, which is the
  one that looks like success — a reader that opens the repository, a registry
  that recognises none of it, and an empty graph nobody is told about.
- **No node is minted from a value the same reader called unreadable.** A table
  is no longer taken from the type argument of a package nobody has described, or
  from a type argument the repository does not declare — a library's own generic
  helper once put nearly every query of a server on one table node — and a
  receiver recognised only by its name no longer produces a query, only the row
  saying what to write to make it one. A channel is no longer named after a
  record that carries a payload. Nothing that stopped minting stopped reporting
  (`nest-unknown-orm`).
- An alias over a library's type no longer hides the library. An intersection
  with a name of its own answers for itself, which is right when a framework
  declares the name — its read-only cookie store is written that way — and wrong
  when the repository being read declares it, as in `type AuthedSocket = Socket &
  { user: User }`, where every listener registered on it went unmatched. The
  alias is now preferred only where the alias itself comes from a package; both
  halves have a test.
- A write through a connection parameterised by the whole schema no longer
  registers the schema as the shape of the row it wrote. The same fabrication as
  reading a schema type as a table, one field further along.
- A query written in a module-level function is read. The leaf walk read the
  methods of the indexed classes and nothing else, so a `pool.query(…)` or a
  `db.select(…)` in a module of exported functions — the shape most TypeScript
  that is not Nest is written in — produced no node, no unresolved row and no
  report: nothing at all. Functions declared at the top of a module, arrows
  assigned to a const, functions nested in either, and handlers written in the
  registration are now read exactly as methods are, and a body is read whether
  or not anything calls it. A query at the top level of a module, which belongs
  to no function, is a `db-call-at-module-level` row (`fn-data-layer`,
  `fn-broker`).
- A call into a function that holds a request, a query or a setting is drawn.
  Such a function was a node with nothing calling it and nothing it called:
  the call walk runs before the leaf readers and follows a function by name only
  from an entry point's handler. A call to a function of the service is now
  drawn when that function leads to something the graph holds, from a method, a
  function or a handler alike, and a helper that reaches nothing held stays out
  (`nest-held-calls`).
- A function written in place in a module's own statements is a body like any
  other: `export const bookingsProcedure = authedProcedure.use(async ({ ctx }) =>
  …)` holds the queries in it, under a node named for where it is
  (`bookingsProcedure.use@20`), which is also the node the way in's `guarded_by`
  edge points at. A tRPC handler's or guard's `ctx` is read from the type the
  root was created with, `initTRPC.context<…>()`, and a transaction's `tx` as the
  client it was handed by, both with nothing installed
  (`trpc-inferred-context`).
- A test is not read, and what a test is is one definition the coverage
  harness counts by too: a name with a `test`, `spec` or `e2e` part
  (`*.integration-test.ts` and `*.e2e.ts` included), or a directory only tests
  live in (`__tests__`, `playwright`, `e2e` and a few more). The tool read
  A scheduling app's whole `playwright/` directory before (`trpc-inferred-context`,
  `nest-rendered-mail`).
- A write records the document it stores whether or not the entity's name had a
  wrapper suffix to strip. `Repository<OrderEntity>` recorded it and
  `Repository<Order>` did not, so `stripImpact` answered `unknown` — the answer
  meaning "I could not tell" — for every field a validation pipe strips in a
  project that does not suffix its entities.
- A chain carrying two operations — `knex.select('id').from('users').first()` —
  is one query and is counted once. Every link of a chain is written at the same
  position and so lands on one node, which is right, but the internal count of
  queries counted the emissions; that count is what decides whether to report a
  repository whose data layer nobody could read.
- A relative request reaches its own service's route. `fetch('/api/thing')`
  names no service and is rooted at no settings key; it means the server the page
  came from, and that was the one service struck out of the search. It is now
  resolved against the routes of the service it was written in, after a target
  named outright and a settings key a service claims, and before any guess, with
  `via: "same-service"` on the edge.
- A NestJS address is the one the framework prints at start-up.
  `setGlobalPrefix` and `enableVersioning` are looked for anywhere in the
  repository once the entry file has not made them, and adopted only where no two
  files disagree; under URI versioning the version is part of the path, a route
  naming none takes the application's `defaultVersion`, and `VERSION_NEUTRAL` has
  no version segment. Two controllers for one resource at two versions used to
  land on one entry and be reported as a route claimed by two handlers
  (`nest-addressing`).
- A decorator imported from a subpath of its package, `@nestjs/common/decorators`,
  or under an alias, `import { Get as HttpGet }`, is read; a decorator spelled
  like Nest's that arrives through a barrel of the repository's own is a row
  naming the class rather than a controller with no routes (`nest-subpath-imports`).
- An address written with a `+` is read, and so is one a static field holds.
  Two string literals added together were unresolvable, and a field read off the
  class name rather than off `this` was not read at all
  (`angular-static-base`).
- The route audit no longer tells a reader that middleware installed for a whole
  prefix went unread when it was read. The caution was raised for any route
  registered by calling an application, which was fair while the only such
  reader was the one that does not read installs, and stopped being fair when
  three that do arrived. A route now says whether its reader read them, and the
  audit asks that: an Express, Fastify or Koa route with nothing in front of it
  is an ordinary finding again, at the level it deserves.
- Middleware a Hono worker installs for a whole prefix is read, as it already
  was for the other three. `app.use('*', requestLogger)` reaches every route
  below it, through a mount and through an application handed back by
  `basePath`, which answers through the one it came from.
- A route declared as `app.route('/books').get(handler)` is read. The path is
  written on Express's `IRoute` rather than on the application, so those routes
  produced no node and no row: they were simply absent, which is the worst way
  for a reader to fail.
- A repository that is not a NestJS one is no longer told to set
  `services[].bootstrap`. The same reader opens Express, Fastify and Koa
  repositories, and `bootstrap` names a NestJS file; the row was a finding
  nobody could act on, in a list whose worth is that everything in it can be.
- The build stamp the graph cache is keyed on covers every reader package,
  derived from the dispatch table and this command's own dependencies rather
  than written out by hand. The hand-written list had missed a reader, so a tool
  rebuilt with it answered from the cache written before that reader existed —
  a real change read as no change.
- A receiver whose type is an intersection has an origin. Every modern database
  driver hands out its client as one, so a whole data layer resolved to no
  package and no table, every query a guess made on the name.
- An exported const built by a call is a function. A server action or a route
  handler written `export const GET = withWorkspace(…)` had no node, so every
  caller of it reached nothing and nothing it called was on the graph at all.
- A verb aliased to another verb, a built value re-exported under two names,
  and a destructured built export are each read as the handler they name.
- A route file that forwards a verb from a package names one position. Its entry
  carried the route file with the line of the module that declared the verb, a
  pair that often names a line the file does not have; the entry now records the
  file it was reached through and the line that forwards it, and the declaration
  separately (`next-reexport`).
- A build that fails stops its readers before it returns. It settled on the
  first failure and left the others running, so an abandoned extraction went on
  writing into a repository — invisible in the command, which exits, and not
  invisible to a watch, an embedder or a second build.
- A whitelisting pipe on an array body produces the findings it produces on an
  object body. The check that exists to notice a stripped field said nothing at
  all for a `Dto[]`, and a nested field path is now walked rather than answered
  `unknown` without having been compared.
- A hint no longer says a type was declared in this repository when the same row
  says it came from a package, and a row about a receiver whose type a workspace
  package of the project declares names that package (`nest-workspace-wrapper`).
- **A name every object has no longer breaks a reader.** `this.bot.toString()` on
  a Telegraf receiver was looked up in a table of registrations and found the
  language's own function, and the whole repository was skipped as
  `extract-failed`. The same class of lookup crashed the NestJS bootstrap reader
  on `process.env.hasOwnProperty('PORT')` in an entry file, and recorded
  `cache.hasOwnProperty('status')` as a cache operation. Every table asked about
  a word from source is a `Map` or asked through `Object.hasOwn` (`bot-registry`,
  `fn-data-layer`).
- **An Angular route configuration is recognised by its shape, and a lazy one is
  opened.** A route array was taken only from a declaration annotated `Routes` or
  from an argument to `forRoot`, `forChild` or `provideRouter`, and `loadChildren`
  was deliberately not followed, so a router written as bare `export default [ … ]`
  files mounted through `loadChildren` was mostly unread, what was read sat at the
  wrong prefix, and no `routerLink` reached a screen. An array is now identified
  by what is in it, `loadChildren` is followed to the module's default export or
  to the `forChild` in the `NgModule` it names, a `path` arriving through an
  object spread is read, and an array spread into a list of children is spliced
  in where it stands. What is left is almost entirely a link written relative to
  the route the component is mounted at, which is a different question and is
  still reported (`angular-lazy-routes`).
- **A template local is no longer reported as a method the component forgot to
  declare.** `<ng-template let-hide="close">` binds `hide`, and looking for it on
  the component found nothing and said so. Every name the template itself binds —
  a `let-` context field, a `#ref`, a `@for` item, an `@if` alias, an `@let` — is
  now read as a local, and a binding on one is the nothing-to-point-at case it
  is, naming the local. A binding that genuinely names a missing method is still
  a row.
- `fetch` in an Angular service is a request. The platform's client is described
  once, in the core, and the Angular and React readers both read it through that
  description (`multi-repo-analytics`).
- A constant typed `: string` sends the value it was written with; the type
  widens the type, not the value. A parameter or a `let` is a run-time value and
  says so, rather than being reported as a constant nobody could read
  (`nest-kafka`).
- `@Transform(fn)`, and `@Expose` or `@Type` with an argument nobody can read, is
  a `decorator-arg-dynamic` row at the decorator (`nest-types`).
- **A token a configured module provides is provided.** `ClientsModule.register(
  [{ name: 'KAFKA_CLIENT', … }])` registers its client under that name; the
  token was reported as provided by nothing. It now resolves to the installed
  `ClientProxy`, and calls through it are counted as calls into the package
  (`nest-kafka`, `nest-rabbitmq`, `multi-repo`).
- **A parameter forwarded through an interface method reaches only the callers
  of that implementation.** One calendar's URL was forwarded to every other
  calendar's `this.deleteEvent(…)` call through the interface they share, which
  lost the real request and put wrong ones in its place
  (`nest-interface-dispatch`).
- **A forwarded request keeps its own verb and host.** `fetch(url, { method:
  'PUT' })` credited to its caller read as `GET`, and a whole-URL template lost
  its host to a path starting `/https:/`. A request's settings object is no
  longer recorded as its body type (`nest-forwarded-verb`).
- **A statement that names no table is not a failure.** `SELECT 1`, `BEGIN` and
  `COMMIT` wrote `sql-parse-failed`; they are counted and write nothing
  (`pg-no-table`).
- **A described handover on a value whose type was erased is said.**
  `(context.manager as any).getKnex()` is not read, because `any` may be
  anything with a method of that name, and it used to be silent; it now writes
  one `db-handover-unstated` row per query (`nest-mikro-orm-knex-not-installed`).
- **A MongoDB collection is read where the driver names it.**
  `db.collection('orders').find()`, and a `const` bound to
  `db.collection('orders')`, name `orders`. The driver's type argument is the
  shape of a document, and reading it made a table called `Document` of every
  untyped collection; it is no longer asked (`nest-mongo-tables`).
- **A query with no table says what would read it.** Through a repository base
  named without `tableProperty`, the row names that key rather than asking for
  the call to be rewritten.

## [0.4.1][] - 2026-09-22

`@flowatlas/cli` only; `@flowatlas/markers` is unchanged at 0.2.0.

Three readers that were written when a producer had one channel, found by
exercising 0.4.0's folding as a project rather than as a unit test.

### Fixed

- A producer that reaches several channels is now read as such everywhere, not
  only in the graph. `doctor` reports **every** annotation that restates a
  channel the code already yields, where it used to report the first and leave
  the rest of them unmentioned; and a producer is labelled with the channels it
  reaches rather than with the wildcard pattern they share, which is how an
  annotated producer has been labelled since 0.4.0.
- A receiver whose type is a named union of string literals — `state: OrderState`
  where `OrderState` is `'A' | 'B'` — no longer produces a row saying the
  receiver could not be followed and suggesting a class be injected. It is the
  language's own `string`, whether or not the set was given a name. Naming the
  set in the type is what 0.4.0 recommends instead of an annotation, so it had
  better not be the spelling that produces rows.

### Added

- `fixtures/folded-channels`, which exercises the folded template across two
  repositories: one publishes `` `order:${id}:${verb}` `` with `verb` derived
  from a union-typed parameter, the other handles the three names that reaches.
  Deleting the three `@Emits` from it leaves the channels unchanged, which is
  the claim 0.4.0 makes, now checked rather than asserted.
- `docs/media/12-folded.gif`, the same story recorded.

## [0.4.0][] - 2026-09-21

`@flowatlas/cli` 0.4.0 and `@flowatlas/markers` 0.2.0, which moves for the
first time since it was published: the channel and call annotations take a list,
and that is a change to their signatures.

0.3.0 stopped the tool claiming things it had not checked. This does the same
one level down: the lists it produces are now short enough to read by hand, and
reading them by hand showed that the last few rows were wrong. A row saying a
front end asks for something the back end does not serve can now be gone
because the routes joined; a false contract error is gone; findings to act on
and contract warnings went down; and a route that read as having no guard can
now say that somebody took the guard off on purpose. A channel that never
existed — a template wildcard standing for several real events — is gone too.

### Added

- A path segment written as a closed set of strings — a parameter typed
  `'ship' | 'refund'` — is matched as each value as well as as a hole. Where
  every value reaches a route, the call joins to each of them; where some do and
  some do not, the finding names the value nothing serves, which is what a
  renamed handler looks like from the other side. A union of more than twelve
  values, and a segment typed `string`, are read as a hole exactly as before.
- `/** @flowatlas-auth <how> */` on a NestJS handler says that the handler
  checks the request in its own body — a signed header resolved inside the
  method, a service token checked by hand — and the route audit then says
  nothing about it. Unverifiable, like every marker, and documented beside
  `@flowatlas-calls`.
- `route-guard-skipped`, for a route whose guard a decorator named under
  `doctor.skipGuardDecorators` switches off. Reported at `info`, and it does not
  ask for the same decision to be written a second time under
  `doctor.publicRoutes`.
- A `whitelist-strip` finding carries an `impact`: `none` when the receiving
  handler reaches no write and therefore cannot lose data, `stored` when it
  writes a document that declares the field, `unknown` otherwise. The `none`
  rows are counted on one line rather than listed, and every one is still in
  `--format json`.
- `@Emits`, `@Consumes` and the routes of `@CallsService` take a name, several
  names, or a list of them, and every form means what a stack of single
  annotations means. **This is a signature change in `@flowatlas/markers`**, so
  the list forms need 0.2.0 of that package to compile and 0.4.0 of the command
  to be read; every existing annotation keeps compiling and keeps meaning what
  it meant. A project that keeps its channel names in one catalogue can
  reference it whole; the array has to be written down rather than assembled,
  and one assembled at run time is reported rather than read as nothing.
- `marker-arg-not-a-name`, for an annotation argument that resolved to
  something that is not a name, and `marker-names-nothing`, for one given
  arguments and left naming nothing. Both were silent: `@Emits('a', 'b')` kept
  `a`, `@Emits(['a', 'b'])` kept neither, and on a method that really does
  publish — the only place anyone writes the annotation — nothing was said at
  all. An annotation that fails quietly is worse than no annotation, because
  whoever wrote it believes the tool agreed with them.
- A template hole whose values can be worked out is no longer a hole. A channel
  addressed as `` `ticket:${id}:${verb}` `` where `verb` derives from a literal
  union through plain string work — `slice`, `toLowerCase`, `replace` and the
  rest of a closed set, plus `+` — is folded to one channel per value. The id
  stays `*`, because it is genuinely unknowable. Nothing is folded half way: a
  step that cannot be applied exactly makes the whole hole a hole again, since
  inventing a channel nobody publishes to would be worse than saying `*`.
- A hole whose value is typed as a union of string literals is read from that
  type, wherever the value is written: a local, a function's return, or the call
  written straight into the template. Typing the value is better than annotating
  it — the compiler checks it, renaming a member updates it, and it cannot drift
  from the code because it is the code.
- An `as const` array declared in a shared package is read. A string const from
  such a package already resolved — a declaration file carries the value in its
  type — and an array is a tuple of literal types, which was one branch short.
  A member that is not a string or a number makes the whole array unresolved
  rather than partly read.
- A method written as a field is followed in four more places, which 0.3.0
  scoped itself out of: a lifecycle hook written as `ngOnInit = () => {}` is
  read as the hook the framework will call, a request forwarded through a
  wrapper written that way is followed to its callers, and a registration that
  delegates to `this.handle()` finds a field holding an arrow — which is how a
  handler keeps its `this` when a library holds it. The one place still asking
  narrowly says why in its own source: a route, a message pattern and a cron are
  registered by a decorator on a *method*, and a decorator on a property
  registers nothing at all.
- A contract party carries `writes`: the top-level keys an object written in the
  source actually puts on the wire, where there is one to read, and
  `writesEvery`, false when those keys are one object per caller rather than
  one object. Three callers writing `{ role }`, `{ isActive }` and
  `{ permissions }` put all three keys on the wire between them and none of
  them on every request, so a message about those says "sent by some of the
  calls" rather than "always sent".

### Changed

- A producer named by annotation carries every channel it publishes in its
  label, rather than whichever channel was read first. A stack of annotations
  always shared one producer node; now the node says so.
- A request-direction finding about a key a call's declared type permits but
  nothing writes is no longer reported. A declared parameter type says what a
  call may send; an object written at the call site, in a `const` a line above
  it, or by the one caller of the method that makes the request says what it
  does send — and where several callers each write one, their keys together. A
  spread of a wider object into a literal still puts its keys on the wire and
  is still reported. The rows this removes were a client echoing back a key the
  server owns.
- A message about a shape read from a declared type says "permits" rather than
  "sends", and never "always sent". Response and payload wording is unchanged.
- A finding on one arm of a handler that answers with a choice of shapes names
  that arm, and a missing field counts the arms that carry it: "it is on 1 of
  the 2 shapes this may answer with, and not on `{order,payment}`".
- A row an annotation has already answered is `info` rather than something to
  act on, in the count, the grouping, the fold and the baseline alike. Acting on
  every row a run reports now takes the number to zero. What counts as answered
  is the shape the graph takes once the annotation worked, and the shapes
  differ: `@CallsService` draws one edge out of the method it is written on, and
  `@Emits` draws two — the method reaches a producer, and the producer reaches
  the channel — so a channel row an annotation had plainly answered used to keep
  asking for the annotation. An annotation that names nothing answers nothing,
  which is this and the marker reading agreeing. A browser request is the third
  shape: `@flowatlas-calls` does not repair the request it sits above, it adds
  one that joins, so the row is answered only where the annotations on that
  method are at least as many as its unreadable requests — two unreadable
  requests and one annotation keep both rows, and the hint says why rather than
  asking again for an annotation that is already there.
- A group of unresolved rows is headed by a sentence true of every member — the
  members' own where they agree, and otherwise the kind's — instead of whichever
  member's sentence the most rows happened to share. A member's own sentence is
  marked so it belongs to the place above it, and a group is keyed by reason and
  level, so a group's level is every member's.
- `contracts` output is ordered worst first, as its own documentation has always
  said it was, with the strips that can lose data above those that cannot.
- `contracts --format json` is at format version 2: a party may carry `writes`,
  a finding may carry `impact`.

## [0.3.0][] - 2026-09-20

`@flowatlas/cli` only. `@flowatlas/markers` is unchanged at 0.1.1.

Everything here was found by reading the tool's own output on a real project,
and most of it is about saying true things rather than reading new ones. More
browser requests are matched to a route, more routes are reached, and the
routes nothing appears to call say why each is there. The lists a person
actually reads got shorter without anything being hidden: the unresolved sites
are split into those that say something was not read and those that say
nothing joins there, and the field rows shrink to the ones the receiving side
really throws away.

### Added

- A repository built on a framework there is no reader for is named, by `init`
  when it writes the configuration and by `build` on every run: Express,
  Fastify, Koa, Next.js, Nuxt, Remix, React, Vue and Svelte. It stays in the
  configuration and contributes nothing to the graph, which is now said rather
  than abbreviated to `no-extractor`.
- A third level for an unresolved row, `nothing`, for a place where no edge
  exists to draw — a template binding that assigns to a field has no method
  behind it. Counted apart from the places it could not read, in `build`, in
  `doctor` and in the baseline, so places that were being counted as gaps no
  longer are.
- `dead` gives a route nothing calls the reason it is in the list: declared
  public under `doctor.publicRoutes`, a health or status probe, an event stream,
  or nothing of the sort, and orders them so that the rows nothing explains come
  first and `--max` cuts from the other end.
- A request made through a wrapper that remembers what it was given —
  `this.params = { url, key }`, opened later from `this.params` — is followed to
  the caller that wrote the address. A field two places write is refused rather
  than guessed at, so stream subscriptions opened that way are read and the
  routes they reach stop reading as never called.
- A call on a module of functions is followed from a method body, not only from
  a function's, and a brace-less arrow body is walked for the calls in it.
- `dead` says when a channel with no consumer belongs to a service that serves
  event streams, rather than reporting a publisher whose consumers are browsers
  as having none.
- A method written as a field — `handle = () => {}` — is read as the method it
  is: calls to it are edges, its body is walked, its annotations are read — the
  annotation being what the hints tell you to write when an address cannot be
  read, which is exactly the case a field wrapper is — and a request or a query
  written inside it is recorded. A helper written as a brace-less arrow answers
  with the expression it is, which is where most of them are written. A wrapper
  written that way is followed to the caller that decided the address, like any
  other. A field assigned a function from elsewhere is still reported.
- `dead --kind fields` lists the fields something happens to — the ones a
  receiver's whitelisting pipe removes on arrival, read from that receiver's own
  validation — and counts the rest on one line. Every row is still in
  `--format json`, with its direction and whether it is dropped.

### Changed

- A repository whose `type` names no reader but whose manifest declares one the
  tool can read is told which type to set, rather than that there is no reader.
- `flowatlas diff` and `flowatlas stats` count unresolved rows the way `build`
  and `doctor` now do, so the four agree on what the word means.
- `dead --format json` is at format version 2: a `fields` row carries
  `direction` and `dropped`.
- `doctor --format json` is at format version 2: `level` has three values, and
  `unresolved` carries `nothing` beside `info`. `rows` and `sites` no longer
  include the places where nothing joins.

## [0.2.0][] - 2026-09-15

`@flowatlas/cli` only. `@flowatlas/markers` is unchanged at 0.1.1.

Far fewer routes are reported as never called, more browser requests are
matched to a route, and more edges cross a repository boundary. The routes 0.1.1
called unused were being called through wrappers it could not read.

### Added

- Requests made through a wrapper are followed to where their address was
  decided: Angular pass-through clients, a `BaseService` whose resource a
  subclass decides, finite `Record` tables of paths, and `fetch` variants
  (`x ?? fetch`, `new Request`, a getter returning the URL). A trailing query
  string is read as a hole rather than stopping the read.
- Inline handler arrows in Hono, Telegraf and callback registries become
  function nodes, so a flow continues past the line that registered them.
- Four `doctor` checks about the gate in front of a route: `route-unguarded`
  (no guard or middleware in front of a route that reaches stored data),
  `route-shadowed` (a worker answers before the application whose guards would
  have run), `route-wildcard-only` (only a catch-all serves the request) and
  `whitelist-strip` (a field the receiver's whitelisting `ValidationPipe`
  removes on arrival).
- Configuration keys `doctor.publicRoutes`, `doctor.publicDecorators`,
  `doctor.nonGateWrappers` and `doctor.skipGuardDecorators`, documented in
  `docs/CLI.md`.
- More than one `@CallsService` annotation on a method.
- When a name given to `flowatlas flow` matches nothing, the suggestions include
  clicks in a template, not only routes.

### Changed

- A composite decorator that returns `applyDecorators(UseGuards(...))` is read
  one level, and a guard or pipe built with `new` keeps its constructor
  options.
- A request from a method nothing references is a contract warning rather than
  an error, because nothing proves it runs.
- An annotation's path is retried under the service's global prefix.

### Fixed

- Contract errors that were not disagreements: an object literal with a spread
  and extra properties, a literal returned rather than assigned, a union of
  shapes on either side, `| null` in a project without `strictNullChecks`,
  `@IsOptional` meeting null, and `Partial<T>`.
- The page `flowatlas visualise` writes declares its doctype and UTF-8 charset.
- `flowatlas diff` ends its summary line, so it no longer runs into the next
  prompt.

## [0.1.1][] - 2026-09-12

The first published version of both `@flowatlas/cli` and `@flowatlas/markers`.

[unreleased]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Panevschi-Ruslan/flowatlas/tree/v0.2.0
[0.1.1]: https://www.npmjs.com/package/@flowatlas/cli/v/0.1.1
