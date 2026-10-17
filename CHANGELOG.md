# Changelog

All notable changes to the published packages. `@flowatlas/cli` and
`@flowatlas/markers` are versioned separately; an entry names the package when
only one of them moved.

## [Unreleased][unreleased]

### Added

- **A class, a file and a service copied as a prompt from the page (P134).**
  The Graph tab's details panel has *Copy as prompt* on every node, and a
  `⋯` beside it that copies the node's class, its file or its service; a
  service's box on the Map copies the service. Each is the text
  `describe_for_prompt({id, scope})` writes, character for character: the
  page now gathers the service scope too (its ways in by kind, its crossings
  to and from each other service worst verdict first, its channels, its
  findings ranked as the `findings` tool ranks them, its most common gaps),
  and the parity test compares every service of every built fixture. The pack
  gained `overview`: the project's findings, ranked where the database is, and
  the contract verdict of each crossing that is not unchecked (about 2% of the
  pack over the fixtures).

- **`flowatlas doctor --reason <code>` (P141).** Lists the places of one
  reason, or several (repeatable, or a comma list), under every level the
  reason is at, so a reason with hundreds of places can be read on its own:
  `flowatlas doctor --reason dynamic-http-url --max-nodes 500`. The rows are
  narrowed as `--service` narrows them, the sections default to `unresolved`
  and `desync`, and a reason neither the catalogue nor any row knows exits 2
  with the nearest names. `--unresolved --reason` narrows the breakdown the
  same way, and its JSON says so under `reasons`. `--accept` refuses it.

- **Zipkin, Jaeger and HAR readers (P112).** `flowatlas observe` reads Zipkin
  v2 JSON (a list of spans or of traces) and Jaeger JSON (the UI's *Download
  JSON*, `{ data: [...] }`) into the same spans as OTLP: their tags go through
  OTLP's key set, so an export of the same traffic gives the same observed
  file; span and operation names, annotations, logs, endpoints and process
  tags are never read. It reads a browser's HAR (*Save all as HAR*) into
  client spans of the front end (`--service`, else the map's one front end):
  each call a script made, by method, path shape, status (`0` is a failure),
  time and duration; files are skipped and counted. The URL's origin is
  compared with the front end's base URLs (`apiBaseEnv` values, `apiTarget`,
  `services[].hosts`) and dropped, and narrows the call to the `ui_api_call`
  whose join reaches a route of that service; that join is counted. A call to
  an origin nothing names is a third party, new unmatched kind `external`, by
  host only. Headers, cookies, query strings, request bodies and response
  content are never read, by key; an error names the entry and the field and
  never quotes the file. New span fields `peerService` and `thirdParty` in
  `privacy.kept`, five new `privacy.dropped` categories; same format-3 file.
  The fixture's `gateway` and `orders` name the hosts the front end reaches
  them at (`fixtures/multi-repo/traces/web.har`, `checkout.zipkin.json`,
  `checkout.jaeger.json`).
- **Never seen, blind spots, and best guesses traffic confirmed (P110).** Three
  read-time overlays of `.flowatlas/observed.json` on the static graph; the
  graph on disk never changes and no edge becomes `runtime`. **Never seen**:
  the MCP tool `never_seen({ since, service, kind, confidence, limit })` lists
  the ways in, channels and methods the code runs that traffic never touched,
  `strong` beside a sibling seen 20 times over a window the file holds in
  full, `weak` otherwise, with one note per service the window holds nothing
  of; `since` cuts the file's hours at read time. `flowatlas dead` and the MCP
  `dead` read traffic as evidence (`evidence.seen`, `evidence.neverSeen`):
  seen is `alive` whatever the code says, and an outside way in never seen
  beside busy neighbours is `likely-dead`; the CLI gains a `seen` column and
  `--since <dur>`. **Blind spots**: what `observe` matched to nothing becomes
  one `seen-not-in-code` info row per service and kind in `doctor`, listed
  under that cause by `doctor --unresolved` and the MCP `cant_follow` with the
  names the trace kept and the call that looks for each (`seen` groups); the
  page's "Seen at run time, not found in code" list says the same call and the
  window. A send, invoke or start whose target the map has, along a join it
  does not draw, is a new unmatched kind `join`. **Best guesses confirmed**: a
  `heuristic` join traffic went through is counted apart (`1 of 4 best guesses
  confirmed by traffic in 2h`, `doctor.json` `traffic`), the row explaining
  the guess is withdrawn while it holds, MCP `get_flow` / `who_calls` rows say
  `confirmedBy: "traffic"`, the Steps mark reads `best guess, seen ×n` (in the
  copied prompt too), and the map draws such a link solid. The page marks a
  never-seen way in `not seen in <window>` (strong in the warn tone) and the
  Busiest tab lists them. Two matcher changes came with it: a client span that
  names the method it ran in (`code.function`) singles out that method's call
  site when two calls of one route fit, and a workflow step's task that names
  no target in an execution history is credited to the one target of its kind
  the step's task reaches on the map (P108's open item).

- **`observe --listen`, a receiver on this machine (P109).** `flowatlas
  observe --listen [port]` takes OTLP/HTTP traces (JSON or protobuf, gzip) on
  `/v1/traces` and the @nestjs/observe agent's batches on
  `/applications/telemetry`, on `127.0.0.1:4318`, so a service run locally
  with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` fills
  `.flowatlas/observed.json` as requests happen. Posts are read by the same
  readers and allow-lists as files, inside the request; a trace's spans wait
  in a bounded buffer (10,000 spans, 2,000 traces, `--trace-wait`) for the
  rest of the trace; every `--flush` and on exit the matches are merged with
  the merge a file run uses, so the same traffic gives the same file, with one
  `sources` entry of format `listen` a flush. Metrics and logs are answered
  and dropped unparsed; nothing is forwarded. It binds loopback unless
  `--host` and `--allow-remote` are both given, refuses a `Host` that is not
  its own loopback name (421), any request with an `Origin` (403), `OPTIONS`
  (405, no CORS header ever), `text/plain` (415) and a body over `--max-body`
  before or after inflating (413, connection cut), and reads no request
  header but `Host`, `Content-Type`, `Content-Encoding` and `Content-Length`.
  While it runs it holds `.flowatlas/observed.lock`; `observe <files>` waits
  five seconds for it, then says a listener is running, and a lock whose
  process is gone is taken over. The observed file is now written to a
  temporary file and renamed over the old one. `scripts/observe-send.mjs`
  posts the fixtures' traces to it (dev only, not packaged).

- **AWS exports read without a collector (P108).** `flowatlas observe` reads
  four files a Lambda team can export with the AWS CLI or the console, picked
  by looking at them, and calls no AWS API: X-Ray `batch-get-traces` output
  (`xray`: functions, workflows, steps, stages and every SDK call, matched as
  P107 matches their OTLP spans), a Step Functions `get-execution-history`
  (`sfn-history`: the run, its steps paired by the chain of events, a step's
  direct invoke of a function), API Gateway JSON access logs
  (`apigw-access-log`) and Lambda `REPORT` lines from a Logs Insights export
  in JSON or CSV, or plain (`lambda-report`). The last two give entries only:
  no joins and no samples (a span has `sampleable: false`, now on
  `privacy.kept`). New flags `--workflow`, `--function` and
  `--access-log-keys`; a history that names no state machine or `REPORT`
  lines no log group names the function of are refused with the flag that
  gives it, and a flag given for a format that does not take it is an error.
  Each reader's never-read list (X-Ray annotations, metadata, `sql` and
  `cause`, a workflow's input, output and parameters, client addresses,
  request ids, memory figures) is tested absent from the file.
  `fixtures/lambda-traces/exports/` holds the checkout of P107 as each export,
  with new `observe.*` snapshots.

- **AWS traffic matched to the map (P107).** `flowatlas observe` reads what an
  OpenTelemetry-instrumented Lambda function or the AWS Distro's layer writes,
  and lands it on the nodes the Terraform and state machine readers draw: a
  function's span on its `invoke` entry (by `faas.name`, or the ARN in
  `cloud.resource_id` with its alias cut), a workflow's run on its `workflow`
  entry, a step on its node, a DynamoDB call on each table it names
  (`aws.dynamodb.table_names`, now read as a list in JSON and protobuf), and
  SQS, SNS, EventBridge, Kinesis and S3 sends on the channel as the readers
  spell it (`order-placed` on an SQS span is `sqs/order-placed`), with the
  `emits` join from the caller; `Lambda` `Invoke` and `SFN` `StartExecution`
  on the join into the entry they reach, a queue's or a stream's delivery on
  the `consumes` join and the mapping's join into the function, and a step on
  the join into the function its task invokes. Which of several joins a call
  ran is settled by the function or step it ran in; a bus with several events
  and no telling which is counted on none. New unmatched kinds `function`,
  `workflow`, `state` (named `<workflow>/?`, never by a step name the map
  lacks), `table` and `cloud` (an SDK call of a service nothing reads, by `<service>/<method>`
  only); new ambiguity kind `channel`. Every ARN and URL is cut to the name
  inside it before a span exists, so no account id or region reaches the file,
  and no request parameter is read; `privacy.kept` and `privacy.dropped` say
  so. A `calls` edge into an entry (a step, a mapping or a call site that
  invokes a function or starts a workflow) counts as a join, for the page and
  for `slow_steps` too (`fixtures/lambda-traces`).

- **Failures seen but not declared (P106).** With an observed file beside the
  graph, the statuses each way in answered are set beside the failures its
  code declares, over the file's window: a status from 400 up that no failure
  declares is *undeclared* (an unhandled throw, a constraint nobody mapped),
  with `expected: <why>` where the framework answers it anyway (the router's
  404 and 405, a 401 or 403 from a check in front of it, a 400 for a body it
  cannot read); a declared failure no request answered is *declared, never
  seen*, said only of a way in hit at least 20 times. An assumed status that
  traffic answered is confirmed, one it never answered is not reported, and a
  failure that names no status is `maybe` beside an unexplained status, never
  folded into it. The page's failure chips say `404 seen ×3`, `409 never seen`
  and `500 ×4 not declared`; `get_flow` and `describe_for_prompt` carry
  `failures` and each `fails` row `seen`; the copied prompt has a *Failures
  seen at run time* section; the MCP server gained `undeclared_failures`, worst
  first; `flowatlas doctor` gained `failure-seen-undeclared` and
  `failure-declared-unseen` rows at `info`, and `--strict-runtime` to make them
  count; core's `riskOf` places the first under `wiring`, and `PAGE_WORDS`
  says both (*status seen but not declared*, *declared failure never seen*).
  One pure comparison in core, `compareSeenFailures`
  (`fixtures/multi-repo/traces`).

- **How long it took, how it answered, and runs that add up (P105).**
  `flowatlas observe` kept each span's duration, HTTP status and error flag:
  every entry, join, method, table and channel it credits gained a count, a
  p50, p95 and max (from log buckets about 9% wide, the max exact), the
  statuses seen and an error rate (the error flag or a 5xx; a 4xx is in the
  status mix only). A join is timed on the caller's span when one was read,
  and says `measuredAt`. Runs add to `observed.json` hour by hour instead of
  overwriting it: `--since <dur>` keeps a window of whole hours (kept for later
  runs; `--since all` stops cutting), `--reset` starts again, and a file
  already read, known by the hash of its contents, is skipped and said. The
  file went to `observedFormatVersion: 3`, with a `privacy` block (the fields
  kept, the categories dropped, how many attribute keys went unread), the
  `window`, the `sources` read, the hour `buckets`, and per entry the three
  slowest and three latest failing requests as trees of what each span was
  credited to, the only place a trace id is written (`--no-samples` keeps
  none). Format 1 and 2 files are read and carried forward as one hour without
  timings. Every reader ends with one allow-list (`KEPT_FIELDS`,
  `keepAllowed`), and OTLP attributes off it are skipped while they are
  walked. `observe` also reads OTLP protobuf (`.pb`, or any file that is not
  JSON), gzipped or not, with no dependency, and a saved series of
  @nestjs/observe posts (`{ batches: [...] }`); the summary names the five
  slowest and five most failing entries and the window. The MCP server gained
  `hot_paths`, `slow_steps` and `trace_for`, and `get_flow` and `who_calls`
  rows gained `p95` and `errorRate` beside `observed`; the page data carries
  the figures and the window for the page to draw later
  (`fixtures/multi-repo/traces`).

- **What each route can fail with (P68).** A NestJS entry gained
  `meta.fails: [{status, exception, at, file, line, source}]`: the built-in
  exceptions and `new HttpException(..., status)` thrown by its handler, by the
  services and helpers it calls and by the exception classes they extend, a
  guard's refusal (403; 401 for passport's `AuthGuard`, 429 for the throttler),
  and the framework's pipes (400) on the route or on a parameter. Throws caught
  in the same body and rethrows were left out; a non-HTTP entry kept the
  exception and no status. `get_flow` showed `fails` on each entry, and
  `describe_for_prompt` gained a "Can fail with" section
  (`fixtures/nest-failures`).
- **Calls run once per item, or side by side (P69).** A call inside a `for`,
  `for…of`, `for…in`, `while` or `do` body, or inside a function handed to
  `map`, `forEach`, `reduce` and the like, gained `meta.inLoop: {kind, line}`;
  one inside the arguments of `Promise.all`, `allSettled`, `race` or `any`
  gained `meta.concurrent` and `meta.together: {by, line}`. A query, cache
  call, request or publish reached once per item, directly or through a
  function the loop calls, became a `query-in-loop` row: a likely N+1
  (`fixtures/nest-query-loop`).
- **Log lines on steps, and the zone a schedule fires in (P71).** Methods and
  functions gained `meta.logs: [{level, text, at}]`, one per line written
  through a logger or the console, with the message kept as a template whose
  values are named by what holds them, never by what they hold. A `@Cron` way
  in gained `meta.timeZone` or `meta.utcOffset` from its options
  (`fixtures/nest-jobs-logs`).
- **Built-in declaration shapes for uninstalled repositories (P70).** Where
  `rxjs`, `@nestjs/common`, `@nestjs/core`, `@nestjs/microservices` or
  `@nestjs/passport` did not resolve, the server reader read a few hand-written
  declarations of their public surface in their place, and the Angular reader
  did the same for `rxjs`, `@angular/core` and `@angular/common/http`. They
  were held in memory, never written to disk, and an installed package always
  won. On a clone with nothing installed, a `ClientsModule.register([{ name }])`
  token resolved for `@Inject(name) ClientProxy`, passport's `AuthGuard` kept
  its 401, and `Observable<T>` returns unwrapped: on `fixtures/multi-repo`
  copied out of the workspace, `module-import-dynamic` went from 1 to 0,
  `di-token-unknown` from 1 to 0 and `type-unresolved` from 12 to 0.
  `builtInShapes: false` turned them off, project-wide or per service.
- **Which guard covers a route, and from where (P76).** A NestJS entry gained
  `meta.access`: every guard and middleware in front of it with `where`
  (`global`, `module`, `controller`, `route`) and `via` (`APP_GUARD in
  AuthModule.forRoot`, `useGlobalGuards in src/main.ts`, `@UseGuards on
  OrdersController`). `APP_GUARD` was read through spreads, named arrays, a
  provider held in a const and a module's own `forRoot()`, and an installed
  class (`useClass: ThrottlerGuard`) counted too; a `providers:` list that
  could not be followed became a `module-providers-unread` row. A
  `@Public()`-style decorator - `SetMetadata(KEY, true)`, through a function of
  the project's own or `applyDecorators`, on the handler or the class -
  switched off each guard that reads the key. `get_flow`, `describe_for_prompt`
  (an "In front of it" section) and the page's details panel showed it all
  (`fixtures/nest-route-access`).
- **Base URLs from the repositories' own files (P77).** A request rooted at a
  setting no service claims under `baseUrlEnv` was completed from what the
  setting is given: the environment a function running it is deployed with,
  else `.env.example`, `.env.sample`, `.env.template` or `.env.development`, the
  compose container built from the repository (`environment:`, `env_file:`),
  `serverless.yml` and `wrangler.json` / `wrangler.toml` variables, and the
  code's own fallback (`?? '…'`, `|| '…'`, `config.get(key, '…')`, a
  `registerAs` factory). `.env`, `.env.local` and other environments' files
  were read for names only. Only an address was kept, scheme, host and path;
  secrets by name, credentials, queries and token-like paths were dropped. The
  host was matched to a service by its name, the new `services[].hosts`, its
  compose container names and published ports, and the port its example file
  runs it on; a host outside the project was a third party. Such a join was
  `heuristic`, with `baseUrl` and `baseUrlFrom` on the edge, the request, the
  page and `get_flow`, and a `base-url-from-files` row at `info`. A setting
  nothing gives a value and named after exactly one service was taken as it
  (`base-url-from-name`). The same files completed an address waiting on the
  environment where no deployed function sets it (`environment-from-files`).
  `settingFiles.read: false` turned it off and `settingFiles.environment`
  chose one environment (`fixtures/multi-repo-base-urls`).
- **Sources for uninstalled internal packages, and shape files (P78).** An
  import of a package that was not installed resolved to that package's source
  where a configured repository, a workspace member of one, or a directory
  directly under the configuration had a `package.json` whose `name` was the
  package: through its `exports`, `types`, `typings` or `main`, the same under
  `src/` for a build nobody ran, then `src/index.ts`, with its own tsconfig
  `paths`. It was read for its types alone, at the path an install would have,
  so no node of it was minted in the importer. A new top-level and per-service
  `shapes` key listed `.d.ts` files of the project's own holding
  `declare module '<package>' { ... }` blocks, read in memory like a built-in
  shape. The order was fixed: installed, source, shape file, built-in shape;
  `packageSources: false` (or `"services"`) turned the first off (or kept it to
  configured repositories). An edge drawn through those types was `heuristic`,
  with `because: ["package-from-repo" | "shape-file"]` and `typedBy`, shown as a
  small mark on the page's steps and in `get_flow`. New rows:
  `package-from-repo` and `shape-file-unmatched` (at `nothing`),
  `package-version-differs` (info), `package-source-ambiguous`,
  `shape-file-unread`. `flowatlas shapes --suggest` listed the missing packages
  most places needed with the names used of each (`--top`, `--service`,
  `--package`, `--members`, `--json`), and `--out <dir>` wrote a starter `.d.ts`
  per package, names only and every type `any`, never into a repository and
  never over a file. `cant_follow` places gained `coveredBy` and its `next` named
  the command; the build cache recorded the source files and shape files read,
  so editing one re-read the importer (`fixtures/uninstalled-internal-packages`).
- **What the reader could not follow, grouped by cause (P75).** A row about a
  step that could not be followed recorded why, as the code states it, under
  `meta.cause`, and the package it points into under `meta.package`; a folded
  row listed the same per cause under `meta.causes`, with a few places each, so
  folding no longer lost why. Causes include `module-not-installed:<package>`,
  `import-unresolved`, `re-export-missing`, `any-typed`, `language-any`,
  `untyped-parameter`, `callback-param`, `dynamic-member`, `interface-type`,
  `function-field` and `data-layer-unnamed`; a row with no finer answer counted
  under its own reason. `flowatlas doctor --unresolved` printed them by cause
  and by package (`--top`, `--samples`, `--cause`, `--package`, `--json`), the
  page's Not joined tab gained a Can't follow sheet, and the graph server
  gained `cant_follow` (`fixtures/cant-follow`).
- **`flowatlas accept` (P72, P76).** Accepted a known gap by reason or by gap
  id (`gap:<service>|<file>|<reason>`), narrowed with `--service` and `--file`,
  with a `--note`, and undone with `--remove`; `--list` printed what is
  accepted. It wrote `accepted.json` beside `graph.db` and refused a target no
  current gap matches. `doctor` left accepted gaps out of every count and said
  how many (`unresolved.accepted` in `doctor.json`). A rule accepted a route
  finding on every route a `--path` pattern names (`'GET /api/public/*'`), or
  in every file a `--file` glob names; a rule needed `--note`, and `--dry-run`
  listed what it would take. The page's Not joined tab muted accepted rows
  behind *show accepted*, said which rule took a row, and offered *Accept all
  like this*, which copied the command.
- **`flowatlas observe <file...>`: run-time traces confirmed static joins
  (P65).** Read OTLP/JSON and @nestjs/observe trace files, kept only the names
  that place a span in code (method, route template, `Class.method`, queue or
  topic, collection), dropped every value, and matched spans to entries,
  handlers, channels, outbound calls and cross-service joins. It wrote
  `.flowatlas/observed.json`: per join a count and when it was last seen, per
  entry its hits, and the spans no code accounts for. The page showed seen
  counts on ways in and steps, thicker Map links and a "seen at run time, not
  found in code" list, and `get_flow` and `who_calls` rows carried
  `observed: n`. No edge was drawn from a trace (`fixtures/multi-repo/traces`).
- **A Steps tab (P64, P74).** One way in as a list in call order, indented by
  depth: each step with a kind mark and its table, address template or channel
  inline, calls side by side and calls per item marked, a likely N+1 flagged,
  failure paths in red, a red row where a chain breaks (no route, no handler,
  an address not read), and best guesses marked. Its heading listed what the
  way in can fail with, as the ways-in list and the details panel did too, and
  the step that throws was marked; a scheduled way in showed its expression and
  zone, and each step's log lines were folded under it. Hovering a row lit its
  node in the Graph tab.
- **Copy as prompt (P67).** On the Steps tab, a channel and a check row, and
  from the graph server as `describe_for_prompt({id})`: bounded Markdown with
  what is in front of the way in, what it can fail with, its schedule, the
  steps with repo-relative `file:line`, shapes in and out, log lines, open gaps
  with their reasons and the ids to ask next. No source code. Rendered by the
  pure `describeForPrompt`, exported from `@flowatlas/mcp` for reuse.
- **One search box, a Busiest tab and a Changes tab (P73).** The search box
  above the tabs found a route or other way in, a channel, a table, a type, a
  gap or a class, and under *Fails with* the ways in that can fail with an
  exception or a status; a hit opened in the Graph tab, and a way in it opened
  became the one every tab shows. Busiest ranked methods as
  `flowatlas hotspots` does, with how many ways in reach each, how far the
  nearest is, and its own service's edges against all of them.
  `visualise --diff <ref>` ran `flowatlas diff` and added a Changes tab: routes
  added and removed, removed routes something still calls and who calls them,
  shapes that moved, new contract findings, and the unresolved count on each
  side.
- **The graph server hands on the next question (P63, P72, P75).** Every answer
  ended with `next`, the calls that take the ids it returned, and the server
  instructions spelled out the chains (entry → flow → source, channel →
  publishers and handlers → flow, symbol → impact). New tools: `start_here`
  (counts per service, the commonest gaps and the entry ids to begin from),
  `describe_for_prompt`, `search` (routes, channels, tables, types, gaps,
  `fails` and classes in one query), `what_changed` (the last
  `flowatlas diff`, read back from `diff.json`) and `cant_follow`: fifteen
  tools in all. `who_calls`, `impact`, `who_emits` and `who_consumes` took the
  same optional `service` filter `list_entries` and `find_symbol` already did.
  Existing fields were unchanged.
- **A table write reaches the function its stream runs (P51).** DynamoDB
  writes - `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`,
  `TransactWriteItems`, the document client's `put`, `update`, `delete`,
  `batchWrite` and `transactWrite`, from `@aws-sdk/client-dynamodb`,
  `@aws-sdk/lib-dynamodb` and version 2 - became publishers onto
  `dynamodb/<table>` wherever some service's Terraform declares that table's
  stream (`stream_enabled`, `stream_view_type`, or a mapping from its
  `stream_arn`), and the mapping from the stream became a consumer of that
  channel triggering its `event` entry. `flow` and `impact` followed Lambda A
  → table → stream → Lambda B, across repositories too. Kinesis `PutRecord`
  and `PutRecords` landed on `kinesis/<stream>` the same way. A table named by
  `process.env` was completed from the function's deployed environment, as a
  queue is. A write to a table with no stream, and any read, joined nothing
  and said nothing. A mapping's `filter_criteria` was put on the edge with a
  `stream-filter-not-matched` row, and a stream something reads and nothing
  writes became a `stream-no-writer` row, both at `info`
  (`fixtures/lambda-terraform-table-stream`).
- **A workflow's write reaches the function a stream runs (P55).** A Step
  Functions task that writes to a table - `dynamodb:putItem`, `updateItem`,
  `deleteItem`, and through `aws-sdk:` the batch and transaction writes -
  became a producer onto `dynamodb/<table>` from that state, kept only where
  the table's stream is declared, as a function's write is;
  `aws-sdk:kinesis:putRecord` and `putRecords` landed on `kinesis/<stream>`. A
  table chosen at run time (`TableName.$`, JSONata) stayed the existing
  `workflow-target-dynamic` row. A batch keyed by a bare word,
  `RequestItems: { orders: [...] }`, or by a shorthand property, was read as the
  table that word names (`fixtures/lambda-terraform-table-stream`).
- **S3 bucket notifications, and the writes that fire them (P52, P56, P60).**
  `aws_s3_bucket_notification` was read from Terraform, in HCL and in JSON, and
  so was `terraform-aws-modules/s3-bucket/aws//modules/notification`: each
  `lambda_function`, `queue` and `topic` block (`lambda_notifications`,
  `sqs_notifications`, `sns_notifications` in the module) became a consumer of
  `s3/<bucket>` taking its `events` and keys by `filter_prefix` and
  `filter_suffix`, and `eventbridge = true` put the bucket's events on the
  default bus as `aws.s3`, where existing rules take them. `PutObject`,
  `CopyObject`, `CompleteMultipartUpload`, `DeleteObject(s)`, version 2's
  `upload` and `@aws-sdk/lib-storage`'s `Upload` became publishers onto the
  bucket by `Bucket` - written out, from `process.env` completed from the
  deployment, or a constant - recorded as the event they fire with the key they
  write. Each write's edge said which notifications take it (`takenBy`),
  `static` where the key as written says so and `heuristic` with the reason
  otherwise; a URL signed for a `PutObjectCommand` was a `heuristic` write,
  `because: ["presigned"]`. On a bucket that keeps versions
  (`aws_s3_bucket_versioning` Enabled or Suspended, or the bucket module's
  `versioning` input), a `DeleteObject` or `DeleteObjects` naming no
  `VersionId` was taken as `s3:ObjectRemoved:DeleteMarkerCreated` rather than
  `s3:ObjectRemoved:Delete`. New rows `bucket-notification-unread` and
  `s3-write-matches-nothing` (info), and a locator `receiver-constructed-path`
  that reads what a receiver was constructed with
  (`fixtures/lambda-terraform-bucket-notification`,
  `fixtures/lambda-terraform-bucket-module`).
- **Other ways a Lambda function is run, read from Terraform (P53, P56, P60).**
  A function URL and an Application Load Balancer target group of functions
  became `http` entries on the function - `ALL /*` for a URL, each listener
  rule's path and verb for a load balancer, its hosts kept on the entry. A user
  pool's `lambda_config` became an `event` entry `cognito/<pool>/<trigger>` per
  step, and an IoT topic rule an `event` entry `iot/<topic filter>` running its
  function. An IoT rule's other actions were drawn as well: `sqs` and `sns`
  onto their queue or topic, `kinesis` onto `kinesis/<stream>`, `dynamodb` and
  `dynamodbv2` onto `dynamodb/<table>` - so a rule reaches the function that
  table's stream runs - and `step_functions` starting its state machine, as
  `StartExecution` does. An `error_action`'s action was drawn the same way and
  marked `when: "failure"`, a workflow or a function named elsewhere included.
  Any other action (`firehose`, `s3`, `republish`, ...) became an
  `iot-action-not-read` row, and an `aws_lambda_permission` for a principal
  none of these reads an `invoker-not-read` row, both at `info`
  (`fixtures/lambda-terraform-other-ways-in`).
- **Function URL callers and Lambda destinations (P54, P60).** A request rooted
  at a setting no service claims joined the `ALL /*` entry of the function URL
  the running function's environment names
  (`aws_lambda_function_url.x.function_url`, directly or through a module
  output), `via: "functionUrl"`, `static` where the path is read and
  `heuristic` where it is not; `process.env.X + '/path'` was read as an address
  rooted at `X`. `aws_lambda_function_event_invoke_config`
  `destination_config` and an event-source mapping's `on_failure` became
  `triggers` edges from the run to the destination function, or to a publisher
  onto its queue, topic or bus, with `meta.when: "success" | "failure"`; a
  result put on a bus is the platform's `lambda` / `Lambda Function Invocation
  Result - Success|Failure` event. A destination function another service
  deploys was joined the same way, and an invoke configuration of a function
  another service creates was joined from that function's entry instead of
  being a `subscription-source-unread` row
  (`fixtures/lambda-terraform-destinations`).
- **`/** @flowatlas-public <why> */` (P90).** On a handler or its controller,
  a route open on purpose had no `route-unguarded` row and a
  `route-public-declared` row at `info` naming the reason instead; a marker
  with no reason was taken as public and listed as `marker-reason-missing`.
  Nothing else was read as public: not a verb, a path or a name.
- **Tables named where they are set (P88).** Three shapes of a table written
  one step away from the query were read with no configuration. A base,
  abstract or extended, whose queries hand `this.<field>` to the library's own
  table argument (`db.collection(this.collectionName)`) was read as a
  `localBaseClasses` entry with that `tableProperty`: each call through a class
  under it was on the table that class sets, `heuristic` when the field is not
  `readonly`, and a class setting it to something unreadable got a
  `dynamic-table-name` row naming the class. A helper of the same class that
  returns one expression (`this.coll()`, a getter `this.collection`) was
  followed one level in the chain walk. On TypeORM's `EntityManager` and
  `DataSource`, the entity class handed to `find`, `save`, `createQueryBuilder`
  and the like, or to a builder's `from`, named the table
  (`meta.source: "entity-arg"`). Queries read the first two ways carried
  `meta.tableFrom: "inferred-property"` or `"helper"`
  (`fixtures/tables-set-elsewhere`).
- **Callers `dead` used to miss (P91).** A service could be named by
  `services[].aliases` (unique across every name and alias, matched exactly)
  wherever a service is named: `@CallsService`, its JSDoc twin `/**
  @flowatlas-calls <service> <METHOD> <path> */` (now read on server methods
  and functions too), `apiTarget`, a base address's host. A worker's
  `env.X.fetch(input, init)` became an `http_out` with `meta.binding`, joined
  `static`, `via: "serviceBinding"`, to the service its `wrangler.*`
  `services` bind `X` to (by name, alias, or the `name` that service's own
  wrangler file deploys it under); a binding to no known worker was a
  `service-binding-unknown` row. A request made to exactly what a setting holds
  (`fetch(process.env.REINDEX_URL)`) whose value is a whole address took the
  value's path. A wrapper handed the verb (`this.req('PATCH', path)` into
  `fetch(url, { method })`, `http.request(method, url)`) credited each caller
  with the verb it hands in, through further wrappers, by one walk in the core
  (`verbsAtCallers`, `verbAlong`) the server, Angular and React readers share;
  and a caller leaving an argument out handed in its default (`url()` for
  `url(suffix = '')`) (`fixtures/multi-repo-dead-routes`).
- **`likely-dead` (P91).** A route nothing calls that a request read in part
  could still reach — what was read matches, each unread piece standing for the
  rest of its segment and any after it, or only the verb was unread — was
  listed by the build in `routes.nearMissed` and by `dead` as `confidence:
  "likely-dead"` with up to three such requests (under `evidence.couldHit`
  since P95). No edge was drawn.
- **TypeORM's raw SQL read as a statement (P126).** A whole statement handed
  to `query` on a repository, an `EntityManager`, a `DataSource` or a
  `QueryRunner` named the tables and the verb its text writes
  (`meta.source: "sql-parse"`), where it had been a read of the repository's
  entity or a `dynamic-table-name` row; a text not written out whole was read
  as before. A loop of guarded raw `UPDATE`s through it was a `query-in-loop`
  note and a loop of `… = ANY($1)` statements was set aside as a batch, as
  through a driver; a manager's `update(Entity, criteria, …)` was read as
  conditional by its criteria (`fixtures/loops-worth-fixing`).
- **A browser annotation that names its service (P127).** `/**
  @flowatlas-calls catalog GET /items */` above an Angular method or a React
  function was read as `GET /items` at the service it names, by name or alias
  (`meta.service` on the request), ahead of `apiTarget` and every other way a
  browser request's service was decided, and joined `via: "marker"`. A name no
  service answered to was a `marker-service-unknown` row, and a route the named
  service lacked a `marker-route-not-found` row, as for the server's
  annotation. The two-word form (`GET /items`) kept its meaning, and the React
  reader read either form for the first time. A tag with no verb in first or
  second place was no longer read as a request (`catalog items` had been the
  verb `CATALOG`), and a tag was read on one line only
  (`fixtures/multi-repo-annotated-browser`).
- **A body handed through a verb wrapper (P128).** A server request whose body
  is a parameter of the wrapper that sends it - `req(method, path, body)` into
  `fetch(url, { method, body: JSON.stringify(body) })`, the settings one
  `const` away, or `init.body = JSON.stringify(body)` set on them afterwards -
  read its body at each caller, along the same calls its address and verb were
  followed through (the core's `argumentAlong`), so `this.req('POST',
  '/invoices', invoice)` carried `invoice`'s type and keys where P91 had left
  it with none. The caller's second argument stayed the body only for a
  wrapper that did not say where its body is (`fixtures/nest-client-wrapper`,
  `fixtures/nest-forwarded-verb`).
- **A server request's own body (P131).** `fetch(url, { method: 'POST', body:
  JSON.stringify(order) })` carried `order`'s type and keys where it is made;
  the server reader had read no body from a request's own settings at all. A
  body already a string, `body: event.body`, was read as `string`, and
  `contracts` said so (`body-already-serialised`).
- **MCP lists read a page at a time (P93).** `list_entries`, `find_symbol`,
  `search` (every kind from one offset), `who_emits`, `who_consumes`,
  `impact`'s entries, `what_changed`'s lists and `cant_follow`'s causes took
  `offset`, and a cut answer said `total`, `nextOffset` and `n more; next page
  offset k`, with that same call first in `next`; an offset past the end was an
  empty page with the total. The only remedy for a cut had been a larger
  `maxNodes`. `get_source` took `fromLine` and `maxLines` (at most 400) and said
  `truncated: "declaration continues past line N; ask with fromLine N+1"` where
  it had stopped a long declaration at 400 lines with an `endLine` that read as
  its end. Every answer also went out as `structuredContent`, and `start_here`,
  `list_entries`, `find_symbol`, `who_emits`, `who_consumes`, `get_type`,
  `get_source`, `search` and `cant_follow` declared an `outputSchema`; every
  tool was annotated `readOnlyHint`, `openWorldHint: false` and
  `idempotentHint`, and an answer that is an error carried `isError`.
- **`dead`, `findings` and `type_usage` in the MCP server (P95).** `dead({id})`
  said whether a way in, channel, class, method or function is dead, with a
  verdict (`dead`, `likely-dead`, `unknown` or `alive`) and the evidence that
  could make it wrong: the requests read in part that could reach it
  (`couldHit`), the requests that found no route one segment off it (`oneOff`,
  `cancel for archive`), what is outside the project (`outside: cron`,
  `probe`, `stream`, …), or one caller of an alive node; `dead({service,
  kind})` listed the rows `flowatlas dead` lists, verdict first, paged. The
  analysis moved from the CLI into the linker, so the command and the tool
  read the same functions (a test compares them on three fixtures).
  `findings()` counted every finding by kind - likely N+1 loops, unguarded
  routes, contract errors and warnings from the last `flowatlas contracts`,
  channels with one end, and every other finding reason - with the top three
  of each, ranked by reach (the ways in that reach a loop, the writes then the
  reads an unguarded route reaches, severity then the ways in to the sender),
  each row with the call that shows it; `findings({kind})` listed one kind,
  paged, the per-item loops counted as `notes`. `type_usage({type})` listed
  every way in that takes or returns a type, each crossing, publish,
  subscription and call that carries it, and the types holding it one level
  out; a name two types have answered `candidates`
  (`fixtures/multi-repo`, `fixtures/loops-worth-fixing`, `fixtures/cant-follow`).
- **A class, a file or a service as one prompt (P95).** `describe_for_prompt`
  took `scope`: `class` wrote every method of a class with the ways in that
  reach it and its own chain, sharing `maxSteps`; `file` every node of a file
  under the class it belongs to, the gaps in the file and the ways in that
  reach it; `service` its ways in by kind, its crossings to and from the other
  services, its channels, its top findings and its most common gaps. A scope
  a node does not have was an error naming the ones it has. The page gathers
  a class and a file the same way (`steps.js`), checked by the parity test.
- **`who_calls` and `impact` on a class (P95).** Asked about a class, both
  answered for the methods of it something calls, where they had answered
  nothing, since calls point at methods; each caller named the method it calls
  (`calls`), and `impact` said how many methods it answered for (`forMethods`).
- **A verdict on what a branch changed (P96).** `what_changed({verdict:
  true})` answered `safe`, `unsafe` or `unknown` with one sentence per reason
  under `because`: unsafe for a new contract error, a call whose target went or
  a channel left with one end, and a removed way in another service still
  calls; unknown for a service the base ref could not be read for, a new gap on
  a path from a change to a way in, or a `diff.json` too old to hold gaps. It
  listed `newGaps` by gap id with the method each is in, `vanishedTargets`
  (`{ caller, target, now }`), the ways in to `retest` ranked by the changed
  nodes each reaches and then by observed traffic, and `newFindings`, which
  never decide it (`fixtures/multi-repo-diff`, whose fifth edit renames a route
  the gateway still asks for and adds a gap in a changed method).
- **Calls that stopped joining, and gaps by id, in `flowatlas diff` (P96).**
  The document gained two sections: each request that joined a route on the
  base side and joins nothing now, with what the head side says instead, and
  each channel left with no producer or no consumer; and the gap ids and
  findings the head has and the base does not. `lostJoins(base, head)` in the
  linker computes the first, for any two graphs.
- **Prompts and resources in the MCP server (P96).** `before-rename`,
  `pr-review` and `trace-route` wrote out the calls those reviews take, ids
  resolved, with the same call strings `next` uses; a name answering to
  several listed each candidate. `flowatlas://reasons` listed every reason with
  its kind, cause and `doctor`'s sentence, `flowatlas://services` the services,
  and `flowatlas://services/{name}` one service's summary, crossings and top
  findings.
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
  with the part named (`pattern-not-expressible`); a file that cannot be read is
  `pattern-file-unread`; a written description on the same call wins
  (`pattern-shadowed`, info); two rules on one call read neither
  (`pattern-ambiguous`); a rule nothing matches is `pattern-unmatched` (info).
  Nodes a rule drew carry `meta.describedBy: "pattern:<id>"`, and a call a
  description now reads loses its `call-dynamic-receiver` row. New commands:
  `flowatlas patterns test [files...]` runs every rule's tests by the reader the
  build runs, in memory (exit 1 on a failing test, 2 on a rule that does not
  compile; `--sample`, `--service`, `--json`), `flowatlas patterns explain
  <place>` shows how far each rule got at a place and the first part that did
  not fit, and `flowatlas patterns suggest` writes starter rules for the
  wrappers the reader could not follow most often (`--min-sites`, `--out`). The
  MCP server gained `test_pattern({ yaml, code?, service? })`, the same tester,
  and `cant_follow` offers it with a starter. Pattern files join the stand-ins
  fingerprint, so an added, edited or removed file reads the services that list
  it again (`fixtures/house-patterns`).
- **`adapters.http.clients` (P121).** An HTTP client of the project's own,
  described by its receiver type, the function that makes it, or its own name,
  with locators for the address, the body and the verb (or the verb fixed, or
  the method's own name), read by the server reader and both browser readers.
  Every description gained `where` (values the call must write) and
  `describedBy`; a `broker.custom` producer gained `module`.
- **Changed flows as sequence diagrams in `flowatlas diff` (P116).** After the
  impact, the document gained a "Changed flows" section: each way in the impact
  lists, and each way in the branch added or removed, walked on both graphs
  and compared step by step, matched on what a step is rather than its line.
  Each changed flow got a `<details>` with a Mermaid sequence diagram across
  the services (added steps green and prefixed `+`, removed ones red with the
  cross arrow and `−`, a changed body or confidence in a note, a guess said as
  `(best guess)`, a place the walk could not see past as `stops here: <reason>`)
  and the same steps as a `diff` block under it. New flags `--max-diagrams`
  (5), `--context` (3), `--sequence-detail service|class`, `--max-chars`
  (60,000: diagrams were dropped from the last back, then flows, each counted),
  `--no-diagrams` and `--max-flows` (50, the rest counted in a
  `flows-truncated` warning). `fixtures/multi-repo-diff` gained a sixth edit:
  `orders` publishes `order.gift-wrapped` and `billing` takes it.
- **`flowatlas flow --format sequence` (P116).** The walk from one way in drawn
  as the same Mermaid sequence diagram `diff` draws, without the marks, walked
  16 hops unless `--depth` says; `--sequence-detail class` drew a participant
  per class.
- **Docs tied to flows (P120).** `flowatlas docs [paths...]` reads Markdown
  blocks that name a flow, a channel or a symbol by its graph id
  (`<!-- flowatlas:flow id="POST /orders" view="sequence" -->` …
  `<!-- /flowatlas:flow fingerprint="…" -->`, and `<!-- flowatlas:ref id="…" -->`
  before a mention in prose). `--write` regenerates the content between the
  markers, in place and nowhere else, in one of six views: `steps`, `mermaid`,
  `sequence`, `prompt`, `contract` and `tour`, whose notes are kept by step and
  never deleted. `--check` exits 1 when a block is `changed` (the steps it
  covered were added to or removed since it was written, each named), `gone`
  (with the nearest names) or `ambiguous`, and 2 on a marker it cannot read;
  `--format github` writes a `::warning` at each block. The fingerprint is of
  what the block shows, not its text, so a reformat never fails it. Every run
  writes `docs.json` beside the graph (`docsFormatVersion: 1`); the
  configuration gained `docs.files`. `flowatlas diff` gained **Docs this branch
  makes stale**; `get_flow`, `describe_for_prompt` and `impact` gained `docs`
  (the blocks about the node, each checked when asked), `start_here` gained
  `staleDocs`, and the page's details panel lists the docs that describe a
  node (`fixtures/multi-repo/docs`, `fixtures/multi-repo-diff/base/docs`).
- **`what_changed` said what each changed flow does now (P116).** A way in
  under `entries` or `retest` whose flow changed gained `flow: { side, added,
  removed, changed, steps }`, `steps` the changed steps as text from detail 1
  (`+ orders → billing POST /invoices`), and `counts` gained `flows`.

### Changed

- **A subscription described in configuration is matched on what the source
  states (P121).** A `broker.custom` subscriber on a receiver whose type is not
  installed was read only where the checker resolved it; it is now matched on
  the annotation or the construction that names the class, as a described
  publish already was, and its `consumes` edge is `heuristic`. A described
  table access (`db.tables`) and a described subscription withdraw the
  `call-dynamic-receiver` row at their call, as a described publish did
  (`fixtures/data-kit-tables`: seven fewer places).
- **The MCP tool list grew to twenty-three (P105, P106, P121).** `hot_paths`,
  `slow_steps` and `trace_for` (P105), `undeclared_failures` (P106) and
  `test_pattern` (P121) each say one short sentence with no output schema; the
  server's instructions name the run-time tools as chains. The test's ceilings
  were raised from 9,700 to 11,800 characters for the part a model reads and
  from 27,500 to 30,350 for the whole list (11,764 and 30,334 with all five).
- **The page opened on the product (P98).** The masthead and the band became
  one strip: the name, then a pill per figure, whose meaning was its title and
  the line under the strip while it was open; a pill whose total was nought
  was not drawn, except *Missed* and how many repositories were read. The
  build's timings folded into *build · <total>ms · <n> services*, slowest
  first; the sentence under the name moved to the foot of the page. Past
  twelve services the rail became one *Services* button and a checklist with
  a search, *All* and *None*. The tabs' row stuck to the top while a tab
  scrolled, and on a narrow screen the tabs came before the ways in. Every
  tab gained an address, `#<tab>[/<way in>][/reason=<reason>]` beside the
  map's and the graph's, which were kept; moving between tabs rewrote it,
  picking another way in added to the history, and Walk, Steps and the table
  tabs gained *Copy link*. A first visit offered a *Start here* card naming
  the busiest way in, the worst gap and, with `--diff`, the latest change,
  each worked out from the graph and each a link.
- **The page spoke in words and had one search (P101).** A check row's reason,
  an edge's type and its trust were said in words - *route not found on the
  target*, *requests*, *best guess* - from one table (`PAGE_WORDS` in
  `frame.js`), the code kept in the tooltip, in the details panel beside the
  row, and in prompts, links and the MCP server. Trust was said only when it was
  not *read from code*: Steps lost its *certain* mark and Crossings showed the
  edge's verb with a chip only for a guess or an annotation. The Map said
  *problems to fix* for *rows to act on*, numbered its call-order columns from
  *step 1*, and counted a front end's screen actions as its ways in (one with
  none said how many screens it had). The colophon said the page was read from
  code, and only with a trace that what was seen at run time was beside it. The
  global search became the only one: `/` reached it, it gained the Graph tab's
  *Nodes*, and a hit went to where it was in the tab open - a way in picked and
  opened on Steps, the Walk or the Map, a node focused on the Graph, a gap on
  its Not joined row - marking where it landed, else opened the Graph; the Ways
  in list's filter box and the Graph's node search went, the first kept as the
  search's *Filter the Ways in list to '…'* and a chip over the list. The Graph's
  filters and checks moved into *Filters* and *Check* popovers, so its bar was
  one row. Crossings, Busiest and Changes hid the Ways in list. `?` listed every
  key from the table the handlers read (`SHORTCUTS`), and ⌘K (Ctrl+K) opened a
  command list of the tabs, the open tab's actions and a search.
- **One Steps view (P99).** The Walk tab went: Steps is the page's one view of
  a way in, and everything that opened the Walk - a way in clicked on the left,
  *Open in Steps* in the Graph's details, Start here, an old `#walk/<key>`
  link - opens Steps on the same way in. Steps draws in one vocabulary of step
  kinds, now with `view` (screen), `act` (user action) and `cfg` (reads
  config), in a neutral chip, the service being the colour of the row's rule;
  the legend lists every kind. A crossing into another service is a row of its
  own again (*→ orders · requests*, trust only when not read from code) in
  place of the *into orders* mark, and guards are said under the step they
  stand in front of. A switch on the bar, remembered in the browser, draws the
  steps *compact* (a line each, the file by its name, only the marks that
  change the reading), *detailed* (every mark, the full path, logs, and the
  settings a step reads as leaves) or as a *waterfall*: a bar per step in its
  service's colour, laid out in steps, not time, on an axis that says so. The
  steps above the Graph's drawing and the command list follow the switch. The
  line under a cut list says whether the depth or the 300 rows left steps out,
  and the second has a button for 300 more. `stepsOf` rows gained `start` and
  `span` (units on the waterfall) and the result `cut`.
- **Not joined was split by what a row is (P100).** The tab's one table became
  three sections, each with its count and a line on what would appear when
  empty: *Couldn't join* (gaps by reason, with the breakdown by cause and
  package folded under them), *Risks* (findings, grouped *who may ask*, *likely
  N+1 and cost*, then *wired wrong or meeting nothing*) and *Accepted* (each
  rule once, then every accepted row with its note), which replaced the *show
  accepted* checkbox. The split came from the pack (`dicts.reasonClass`, a
  reason's row kind and risk, and `rowKinds` for a row of another kind than its
  reason's), never from the words of a reason, and a row's tone was its risk's.
  Notes left the tab, with one line saying how many and that `doctor` lists
  them. A reason row opened to every place it stood for, fifty at most, and
  each row and place had one `⋯` menu - *Copy as prompt*, *Copy accept command*
  for that place (a route by its route, another row by its file), and *Copy
  accept command for every row like this* where a rule took more, always ending
  in `--dry-run` - in place of the inline *Copy as prompt* and *Accept all like
  this* buttons; what was copied was shown in a toast. The Graph's details
  rows gained the same menu. Core gained `riskOf(reason)` (`auth`,
  `performance`, `wiring`), `RISK_NAMES`, `RISKS` and `findingsWithoutRisk`,
  and the reasons gate failed on a finding with no risk.
- **The page on a phone, for the keyboard and a screen reader, and fast
  (P102).** On a narrow screen the tab row became one line that scrolled
  sideways inside itself, faded on the side that had more, the open tab kept
  in sight; under 360px, or when more than two tabs fell past the edge, a
  *View* select stood in for it. Below 640px the Map tab listed its boxes as
  cards under their call-order columns (*step 1*, *queues and topics*, …),
  each with its type, ways in, nodes and problems and what it reached and
  what reached it as buttons; a card opened the box's details under it, and
  *Show the drawing* (or full screen) drew the map. Every text colour read at
  4.5:1 or more on every ground in both themes: `--faint` and `--muted` were
  darkened in the light theme and lightened in the dark one, `--good`,
  `--warn` and the service hues darkened in the light theme, and the fifth
  service hue became an indigo, since a gold dark enough to read was the warn
  tone's brown; a service let out by the rail was dashed rather than faded.
  No text was under 12px but inside the drawings, whose node and column names
  were 12px at zoom 1. The tab row was a tablist the keyboard moved along (one
  tab in the Tab order, ← → and Home End), each tab tied to its panel; the
  page said `<html lang="en">`. A *Theme* button in the strip turned the
  colours from the system's to light to dark, remembered in the browser, and
  the command list offered it; form controls followed. A plain wheel over the
  Map or the Graph scrolled the page, saying once in the corner that Ctrl (⌘)
  and the wheel zoomed; a pinch zoomed, a drag panned, and in full screen the
  wheel panned as before. Crossings built its rows a hundred at a time while
  the browser was idle and kept them for the next visit; the Ways in list drew
  only the rows in sight, so its *N more* cut went, with the picked way in
  always drawn and the arrows moving between rows; the search waited for a
  pause in the typing.
- **The page's source in modules (P103). `page.html` kept only its markup:
  its styles moved to `page.css` and its script to one module per panel under
  `src/visualise/panels/`, each a factory handed the page so far, written in
  through placeholders `PAGE_PARTS` lists in order. The page the command wrote
  was still one file and drew the same thing on every fixture; the command
  refused to write one with a part or a placeholder missing, and the built
  command shipped `page.css` and `panels/` beside it. Every panel gained a
  test that mounted the page's markup in a small test document.
- **`flowatlas dead` printed a verdict (P95).** The entries table's
  `confidence` column became `verdict` (`dead`, `likely-dead`, `unknown`), the
  channel and provider tables gained one, and a route a request one segment
  off named was listed with that request beneath it. In JSON every row gained
  `verdict` and `evidence`, and P91's `nearMiss` moved to `evidence.couldHit`.
  Infrastructure, stream and declared routes were `unknown`, with `outside`
  saying why; a class in a service with unresolved injects was `likely-dead`.
- **`diff.json` became format 2 (P96).** It gained `unresolved` (the gap ids
  and findings each side has that the other does not) and `joins.lost`. A file
  of format 1 is still read, without them; one from a newer flowatlas is
  refused by name.
- **`diff.json` became format 3 (P116).** It gained `flows`: one per way in
  walked, with its participants and its steps, each `same`, `added`, `removed`
  or `changed`. Files of formats 1 and 2 are still read, without the sections
  they predate; the verdict reads no flows, so a format-2 file is not
  `unknown` for lacking them.
- **`flowatlas diff`'s documented defaults (P190).** `docs/CLI.md` said
  `--max-entries` 20 and `--max-nodes` 50; the command has always used 150 and
  100, which the reference now says.
- **`what_changed` said `base` and `head` as objects (P96).** Each became
  `{ ref, label }`, `label` `working tree` where no ref was read and the ref
  with each service's commit otherwise: `head: null` had read as "no head".
  This changes the answer's shape. Its `counts` became those of the service
  asked about (they had been the whole diff's beside filtered lists), types
  were filtered by the service in their id, and `counts` gained `gaps` and
  `lostJoins`.
- **The MCP tool list grew to eighteen (P95).** The test's ceilings were
  raised from 8,000 to 9,700 characters for the part a model reads and from
  21,000 to 27,500 for the whole list (9,595 and 27,382 with the new tools),
  their text cut first. `get_type`'s `next` named `type_usage` first, a type's
  hints added it, a class's hints added the class prompt, and `cant_follow`
  asked about a finding's reason pointed at `findings({kind})`.
- **`dead` told routes called from outside apart (P91).** Every entry row
  gained `class` (`actionable`, `stream`, `infrastructure`, `declared`), `why`
  (the rule that put it there), `role` for infrastructure (`probe`, `webhook`,
  `callback`, `discovery`, `configured`) and `confidence`. Infrastructure took
  the probes, webhook and callback receivers by path (at any depth), a
  `@HealthCheck()` handler, a handler or controller named for what it answers,
  and what `dead.infrastructure.{paths,decorators,names}` names
  (`builtIn: false` turned the built-in rules off); a route marked
  `@flowatlas-public` was `declared`, like one under `doctor.publicRoutes`. The
  table listed the actionable rows, and folded every other class into one line
  (`4 infrastructure routes: 2 probes, 1 callback, 1 webhook`); `--class`
  listed one. The Map counted infrastructure apart from the routes nothing
  calls. A NestJS entry gained `meta.controllerDecorators`.
- **A verb nobody read is not `GET` (P91).** A request whose verb a caller
  hands in and nothing can read kept `method: null`, joined nothing and was an
  `api-method-dynamic` row; on the server it had been recorded as `GET`. A
  caller handing in the verb no longer had its second argument read as the body.
  Snapshots of `nest-forwarded-verb`, `nest-client-wrapper`,
  `koa-react-full-stack`, `react-client-base` and `react-local-client` moved
  with it; `ground-truth` and `multi-repo` gained `routes.nearMissed`.

- **One table, one name (P88).** A TypeORM entity whose `@Entity('orders')` or
  `@Entity({ name: 'orders' })` states its table was drawn on that table
  through `Repository<Order>` too, where it had been the class name `Order`;
  the class name stayed the default, and the declared name moved to
  `meta.entityType`. Snapshots of `nest-typeorm`, `nest-query-loop`,
  `fn-data-layer`, `multi-repo`, `multi-repo-contracts`, `nest-route-access`
  and `nest-check-through-helper` moved with it.
- **No row where an edge explains the call (P88).** A call that read as data
  only by its receiver's name, and that the graph draws as a `static` call into
  a method of the service's own, was no longer a `db-receiver-name-only` row:
  its queries are read where that method writes them. Each was counted as
  `receiversExplainedByEdge` in the repository's stats, and `flowatlas stats`
  printed `receivers explained by a drawn call` (`receiversExplainedByEdge` in
  JSON). A base named in `localBaseClasses` as a bare string had its
  `tableProperty` read off its own queries where they state it
  (`fixtures/nest-mongo-tables`).
- **N+1 that is worth fixing (P89).** `query-in-loop` became one row per
  loop, at the loop's line, naming every query, cache call, request and
  publish it reaches (`meta.reaches: [{id, type, words, via?}]`, nearest
  first, eight at most with `reachesCut` counting the rest), where it had been
  one row per call. A loop bounded on purpose wrote no row: chunks (a constant
  step above one, a `slice`/`splice` of a constant size, a list from `chunk`,
  `batches` and the like or a helper named under `callShape.boundedCalls`),
  pages and cursors (`while (hasMore)`, `do … while (token)`, `skip`/`take` or
  a cursor key handed to the query, a `while (true)` that stops on a short
  page), retries (a constant number of tries left on success), literal lists,
  loops around nothing but batch calls, and loops in a migration. Each kept
  `meta.inLoop.bounded` on its edges and was counted in the repository's
  `stats.loopsBounded`; `flowatlas stats` printed `loops set aside: chunk 1 ·
  page 2 · …`. A loop whose every leaf is a conditional write (a filter naming
  a state besides the id, an SQL `UPDATE … AND col =` or `RETURNING`, a helper
  named under `callShape.conditionalWrites`) or a send to one recipient (a
  producer described with `perItem: true`, a request to a host under
  `callShape.perItemHosts`) was a note (`meta.severity: 'note'`); the rest were
  `likely` findings. Each row carried `meta.waysIn` and `meta.entries`, the ways
  in of its service that reach the loop, and doctor, the MCP `search` and
  `describe_for_prompt`, and the page's Busiest view listed the likely loops
  most-reached first; the Steps view said *likely N+1* only for those. Query
  nodes gained `meta.batch` and `meta.conditional`, and producers `meta.batch`
  (the SDK's batch sends and writes) and `meta.perItem`, from the descriptors.
  New fixture `fixtures/loops-worth-fixing`; `nest-query-loop`'s rows moved to
  the loop lines.

- **What a route fails with is what it can answer (P87).** Under a global or
  `@UsePipes` `ValidationPipe`, a route listed the 400 only when its handler
  takes a `@Body`, `@Query` or `@Param` typed as a class; any other pipe in
  front of a route only when the handler takes a value pipes are handed. A
  project's own error class that states its status (`readonly status = 404`,
  a getter, `getStatus()`, or what its constructor stores from `super(..., 409)`)
  was answered with that status where an exception filter in front of the route
  (`useGlobalFilters`, `APP_FILTER`, `@UseFilters`, matched by its `@Catch`)
  reads it off the exception; a filter answering a fixed status gave that one.
  A guard written in the project kept its synthetic 403 only where its
  `canActivate` can answer anything but `true`, and one extending passport's
  `AuthGuard(...)` answered 401. A status written nowhere on the path - an
  unknown error's 500, a declared status nothing maps (kept in `declared`), a
  filter whose answer cannot be read - gained `assumed: true` in `meta.fails`,
  and a filter of that kind became a `fails-filter-unread` row at `info`.
  `meta.fails` stayed one row per site; every reader grouped it: `get_flow`'s
  `fails` became one entry per (status, exception) with `sources`, `sites`,
  `loc` and, at `detail >= 2`, `places`; `describe_for_prompt` wrote one line
  per group (`- **404** \`LoanNotFound\` — throw ×6, first at ...`), capped by
  `maxFails` (12); a `fails` search hit is one per route; the page's error card
  and *Copy as prompt* list the groups with counts, draw an assumed status as
  `500?` and keep the places behind a disclosure (`fixtures/nest-fails-accurate`).
- **A check thrown through a helper (P90).** `throw toHttpError(check)`, where
  the helper picks the exception from a table at run time, was read through the
  helper (a function, a method of the class, a member of an object of
  functions, a method of an injected class), a `const` it is held in and an
  `await`: the failure was named after the helper, with `via: 'helper'` and
  `chosenFrom: [{exception, status}]` (an object or `Map` of classes, a table
  of built exceptions, a `switch` or ternary, one more helper down), each
  choice answered through the filters, and `status` only where every choice
  agrees. A helper whose answer cannot be read, under an `if` that tests what a
  check of who is asking answered (`soundsLikeAuthCheck` in the core), became
  `family: 'auth'`. The route audit counted either as `route-checked-in-body`,
  naming the helper and its statuses; a table of 404 and 410 stayed
  `route-unguarded`. `get_flow`, `describe_for_prompt` (`toHttpError (401 | 403
  | 423)`), search and the page showed the choices
  (`fixtures/nest-check-through-helper`).

- **Fewer `route-unguarded` rows (P76).** A route covered by an app-wide guard,
  or opened by a public-sounding opt-out decorator on the handler or its class,
  no longer had a row; an opt-out that switches one check off made it
  `route-guard-skipped`; and a route with no guard whose own code throws a 401
  or 403 became `route-checked-in-body` at `info`, naming the throw. The
  `route-unguarded` hint named accepting by rule.
- **`accepted.json` is version 2 (P76)**, for rules by `path` and file glob. A
  version 1 file was still read; an older `flowatlas` refuses version 2 rather
  than reading a rule as wider than it is.
- **One glob grammar for accepted rules and `shapes` (P80).** An accepted
  `file` glob was read with the grammar `shapes` uses: `?` became one
  character rather than itself, `**` as a whole segment matched zero segments
  too (`src/**/x.ts` took `src/x.ts`), and `**` inside a segment stayed within
  it. Route patterns kept `*` as any run, `/` included. `isFileGlob` became
  `isGlob`, kept one version under the old name.
- **Every surface split accepted rows the same way (P80).** Doctor's report,
  `doctor --unresolved`, `shapes --suggest`, the page and the graph server's
  `cant_follow` and `search` went through one split in the linker
  (`acceptedSplitOf`): rows an annotation answered were demoted first, and a
  route rule took a row read back without its symbol on every one of them.
  `cant_follow` gave such rows the "nothing to do here" hint doctor already
  gave, and the page showed them at `info`. The rules were compiled once per
  surface rather than once per row.
- **Gaps, notes and findings counted apart (P81).** Every unresolved row became
  one of three kinds, derived from its reason (`kindOfRow`, `ROW_KINDS` in
  `@flowatlas/core`, no schema change): a gap (the reader could not follow
  something), a note (how a join or a reading was made: `base-url-from-files`,
  `base-url-from-name`, `environment-from-files`, `package-from-repo`,
  `package-version-differs`, `shape-file-unmatched`, `route-checked-in-body`,
  `route-mount-assumed-empty`, `route-api-guessed`, `workflow-named-by-file`,
  `document-age` and the like) or a finding (something about the code:
  `query-in-loop`, `route-unguarded`, `route-shadowed`, `route-claimed-twice`,
  `s3-write-matches-nothing` and the like). Only gaps counted as missed
  (`wasMissed`), and one function counted them all (`countsOf` →
  `{missed, sites, notes, findings, nothing}`), so the build line, `stats`,
  doctor, the page and the graph server said the same numbers for one
  database. The build line became `missed: N over S sites · notes: N ·
  findings: N` (and the watch line `missed: N`); `LinkReport.totals` gained
  `missed`, `sites`, `notes` and `findings`, with `totals.unresolved` kept equal
  to `missed` for one version and deprecated, and readers of a stored report
  fell back to it. Doctor's heading said the three figures, findings got a line
  of their own (`2 findings: 1 likely N+1, 1 route with no guard`), a group of
  notes or findings was marked `(note)` or `(finding)`, and `doctor.json` gained
  `unresolved.notes`, `unresolved.findings` and a `kind` on each group;
  `unresolved.info` and `unresolved.nothing` counted gaps only. The page's
  "Left unresolved" became "Missed", with "joined from files" and "findings"
  under it, and the Not joined tab listed rows under their kind. The graph
  server's `start_here` gained `counts: {gaps, sites, notes, findings,
  nothing}` and listed only gaps among `topGaps`; `search` gap hits gained
  `kind`; `cant_follow` counted notes and findings apart under `apart`. A
  doctor baseline kept counting every actionable row, findings included, so
  no baseline changed verdict on upgrade; only its `info` and `nothing` tallies
  were recounted by kind. The read gate failed on a reason doctor knows with no
  kind.
- **`query-in-loop`, `package-from-repo` and `shape-file-unmatched` at `info`
  (P81).** They had been written at `nothing` only to stay out of the count of
  what was missed; their kind did that now, and `nothing` meant again only a
  place with no edge to draw.
- **The Map laid out in call order by default (P66).** Services went in columns
  by call depth from the front ends, with queues and topics between the
  columns, stores and outside hosts under the app that uses them (one box per
  outside host, capped with `+n more`), and hovering a box dimmed what it does
  not touch. The layout by role stayed, under *layout*.
- **The graph database kept each unresolved row's meta (P75)**, in a new
  `unresolved.meta` column. An older database without it was still read,
  without causes.
- **`unknown-base-url-env` said more (P77):** which values were found where,
  and which files set the setting without being read.
- **Each function URL's entry was keyed by its function (P54)**,
  `http:ALL:/*@<function>`, so two URLs in one repository no longer merged into
  one entry.
- **A write's recorded value that is written and not read was kept as an empty
  list (P56)** rather than left out, so a version named by a variable still
  counted as named.
- **A lighter page (P84).** The page shipped each failure once: a guard's
  refusal, a pipe's 400 or a shared service's throw that stood in front of
  many routes became one record in `dicts.fails`, and each route a list of
  record positions, where it had been one object per failure per route. Log
  lines' levels and templates (`dicts.logLevels`, `dicts.logTexts`) and an
  unmatched span's service and kind (`observed.services`, `observed.kinds`)
  went through dictionaries too, each listing only the words that repeat
  enough to pay for it. Every view showed the same text. On the synthetic
  `fixtures/nest-shared-failures` (18 routes behind one guard, one pipe and
  one service) the failure data went from 7.6 KB to 0.5 KB and the page's
  data from 18.2 KB to 11.1 KB; scaled to 258 routes, the whole page shrank by
  about 16%. The Busiest view worked out how many ways in reach each row, and
  from how near, by one backward search per row shown instead of a forward
  walk from every way in over the whole graph; the numbers were the same.
  `HOTSPOT_EDGES` moved to `analysis/hotspots.ts` (still exported from
  `@flowatlas/cli`), so no page module imported a command.
- **Smaller MCP answers (P93).** Every answer was written as compact JSON, and
  each fact once: a `cant_follow` place became `{ loc, id?, symbol?,
  service? }` (no `file` and `line` beside the `loc` that says both, `symbol`
  only where it is not the id, `service` only where the cause spans more than
  one service, `coveredBy` once on its package), a `check_contract` finding
  `{ severity, kind, direction, field, expected, actual, message, ignored? }`
  without the edge the answer names at its top, a repeat in a tree `{ id, ref:
  true }`, and a row of `get_flow` or `who_calls` left `service` to a parent of
  the same service. `get_type` and `what_changed` applied `detail`, which they
  had taken and ignored: `get_type` at 0 named the type and its fields, at 1
  (the default) said what each field is and named the nested types, at 2 added
  the hash, `meta` and the nested declarations; `what_changed` at 0 gave ids,
  at 1 service and label, at 2 the changed fields. The part of the tool list a
  model reads (names, descriptions, input schemas) went from about 11,700 to
  under 8,000 characters, and a test holds it there: one-sentence
  descriptions, and `detail`, `maxNodes`, `offset` and `service` described once
  in the server's instructions. The MCP snapshots of `fixtures/multi-repo` came to 38% fewer
  characters, and to half on the trees.
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
  depth`, `past about 12000 characters; raise maxChars…`), with
  `stoppedBy`, and `crossingsLeft` lists up to eight crossings it did not
  follow; `next` gained `check_contract` for the first HTTP crossing and
  `get_flow` on the first crossing left. A depth that cut the walk used to say
  nothing. `who_calls` says `past maxNodes` the same way. `describe_for_prompt`
  uses the same walk, writes a repeat as `again — followed under …`, and asks
  for more depth when depth is what cut it. In the terminal, `flow` and
  `channel` write a repeat as `↺` (`(again)` with `--ascii`, which said
  `(cycle)`) with the node's label, and the cut line names the one flag that
  shows more (`fixtures/multi-repo-plumbing`).
- **MCP walks that say where they stopped (P94).** An answer that stopped,
  found nothing or could not place a name used to read like a complete one.
  `who_calls` counts the callers it left past its depth (`n more nodes past
  depth 3; raise depth`, `stoppedBy`, and `frontier`, the rows to ask on from
  at depth 16), writes a caller the graph has no node for as a `missing` row
  instead of dropping it, and marks a row that is no way in and that nothing
  calls `topOfChain` with `gapsInFile`, the gaps of its file that may hide the
  call, with `cant_follow` and a gap search in `next`. `impact` with no way in
  says `entriesNone` and where to look, and its walk limit moved from `note`
  to `truncated`. `who_calls`, `impact` and `get_source` take a route said
  aloud, a bot key or an `invoke:` name as `get_flow` does, and `get_source`
  a name; a route with a literal segment resolves to the most specific route,
  as the linker joins it, naming the others under `alsoAnswers`
  (`GET /orders/latest` used to come back as three candidates), in the
  terminal's `flow` and `config` too. After an ambiguous name `next`
  asks the same tool once per candidate. An unknown channel, symbol or entry
  names up to five `suggestions`; every error is `isError`. `check_contract`
  between two service names lists every crossing from one into the other with
  its status and the call that checks it. `cant_follow` for a cause with no
  gaps says why (`route-unguarded is a finding, not a step the reader missed`),
  and for a cause nothing knows is an error with the `known` causes and the
  `nearest`. A `search` gap hit's `id` is the method it is in, its gap id moved
  to `gapId`, and it carries `sites` and every `places` (at most ten), so
  `next` leads to `get_source` and `who_calls`. `start_here` lists
  `topFindings` beside `topGaps` (`fixtures/cant-follow/expected.mcp`).
- **Copy as prompt now writes the same text as `describe_for_prompt` (P97).**
  The page's button and the MCP tool had drifted into two documents with their
  own headings, bounds, step marks and advice. Both now gather one subject and
  hand it to one renderer, core's `renderPrompt` (`prompt-text.js`, written into
  the page as it is), so the same way in, channel or check is the same
  characters from either. One heading scheme for every subject: `# Way in:`,
  `# Channel:`, `# Check:` or `# Symbol:`, the id line, *In front of it*, *Can
  fail with* with its statuses in the heading, *Published by · n* and
  *Consumed by · n* (each consumer with what it goes on to do), *Where · n* for
  a check, *Reached from*, **Steps** in call order, **Shapes**, **Gaps** and
  **Ask next** with each call written out with its id. The server's text gained
  the page's step marks (best guess, on failure, side by side, per item, likely
  N+1, throws, seen ×n) and log lines, a schedule and the hits seen at run
  time; the page's gained the ids and calls, and walks the steps `get_flow`
  walks (`reads_config` included, each node once, the crossings first) rather
  than its Steps view's. `describe_for_prompt` takes a gap id
  (`gap:<service>|<file>|<reason>`), as a check row on the page copies it: every
  row of it at its line, with the node it is on. The page ships every node's
  id, less what its type, service and file already say. The shared snapshots
  are `fixtures/multi-repo/expected.prompt/`, and a parity test compares both
  sides on every way in, channel, symbol and gap of every built fixture, walked
  in full and cut short.

### Fixed

- **Controls' edges at 3:1 (P142).** A search box, a select, a tool button, a
  chip, a tab, a service on the rail, a key and the palette's input were
  outlined in the colour of the page's rules, about 1.4:1 on their ground; they
  are drawn in a token of their own, `--edge`, at 3:1 or more on every ground
  in both themes, while the rules and frames keep theirs. A row focused or
  picked by a fill alone (a search result, a menu item, the palette's pick)
  also carries an accent bar along its start. The contrast test holds the edge,
  the focus rings and the marks at 3:1, and no control's edge in `--rule`.
- **A service's prompt counted gaps somebody accepted (P143).**
  `describe_for_prompt({scope: "service"})` listed its most common gaps over
  every row, accepted ones included, where every other surface leaves them
  out; it counts the rows nobody accepted now, as the page does.

- **Four page bugs seen in a browser (P137).** A page opened at `#map` (a
  link, a bookmark, a reload) showed the Map tab selected over an empty panel:
  the tabs' shared state began on the map, so opening it changed nothing and
  its panel stayed hidden. No tab is open now until the first is shown, and a
  test boots the page at every tab's address, at desktop and phone widths. The
  Map's kinds of link stacked in a column since P101 gave the Graph's Filters
  popover that class; they are a wrapping row of their own again. On a phone,
  the Ways in list cut a failure chip mid-word (`500 ×1 not de…`); the chips
  now wrap whole, the row a line taller for each line they take at the list's
  width, and the row's tooltip says them all. The line under a Not joined row
  names `flowatlas doctor --reason <code> --max-nodes <n>` (and `--service`
  when the reason is all in one service), which lists only that reason's places.
- **The Crossings tab drew nothing (P140).** Its table reached for the Not
  joined tab's per-kind sections, which were not in its scope, and stopped on
  the error before drawing a row; it lists every crossing again.
- **A new gap under a gap id the base already had (P194).** `flowatlas diff`
  compared gaps by gap id (one reason in one file), so a second unjoined
  request in a file that already had one, or any gap id whose rows grew, was
  not new, and one whose rows shrank was not gone. The rows under an id both
  sides hold are now matched one by one on what each says (symbol with
  positions masked, and message), never on the line, and the sites left over
  are listed under the same id at the first new or gone one, with the new
  optional field `kept` (the sites both sides share) on the row in `diff.json`,
  on `what_changed`'s `newGaps`, and in the Markdown (`gap, 1 more beside 1`).
  A site replaced by another is listed under both. A row standing for several
  sites is matched by its count. Same `diff.json` format: the field is optional
  and every format reads with or without it.
- **`doctor.json` holds every row (P192).** The file `doctor` writes was cut
  like the terminal: six places per reason and 150 rows per section, with
  `truncated` saying how many, although `--max-nodes` promised "the file is
  always complete" and every `… N more rows` line sent the reader to it. The
  check now builds the whole report, writes it, and cuts only what it prints:
  text, `github` and `--format json` are unchanged, and the file has every
  row and no `truncated` field (same `doctorFormatVersion: 2`; the field was
  always optional). `runDoctorComplete` and `boundDoctorReport` are exported
  beside `runDoctor`, which is the two together.
- **Command and tool counts in the READMEs.** `packages/cli/README.md` said
  `flowatlas --help` lists twenty-two commands; it lists twenty-five, and now
  says "every command". `docs/mcp.md` said nineteen tools; there are
  twenty-three, as the tool-list test holds.
- **`impact` said only one of its notes (P132).** An answer whose walk stopped
  at its limit, asked at `detail: 3`, said only that the level was clamped: the
  second note overwrote the first. It now says both: the walk limit under
  `truncated` since P94, the clamp as `note`.
- **A file's likely N+1 hidden behind its note (P130).** The MCP `search`
  keeps one `query-in-loop` hit per file, and of loops reached alike it kept
  the first; a finding now ranks before a note reached alike, so a file holding
  both keeps its finding.
- **`{ method }` was read as no verb at all (P91).** `fetch(url, { method })`
  written with a shorthand property was taken as the protocol's default, `GET`;
  it names a binding, and is read as one. An address joined with `+` to a
  value read at run time (`'https://catalog/items/' + id`) was read as far as
  it goes, where it had been no address.
- **`observe` read the real @nestjs/observe format, and counted a request once
  (P85).** The @nestjs/observe reader had been written against keys the SDK
  does not send, so a real telemetry batch joined nothing and left `lastSeen`
  empty. It now reads the batch the SDK (0.3.x) posts — `serviceId`,
  `snapshots` with `ct`, `p`, `op`, `a.m`, `a.sc`, `a.ou` and the span tree in
  `t` (nodes need `o`, `c`, `m`; `n` is optional), outgoing `http` nodes as
  client spans and `mongodb` / `pg` / `mysql2` nodes by collection — plain or
  gzipped, and a bare snapshot array as before. Each reader copies only the
  fields of its allow-list: no header, body, user id, query string, host,
  statement, tag, error message or log line reaches `observed.json`, the page
  or an MCP answer. Snapshots of another protocol, nodes the contract refuses
  and jobs without a tree are counted in the summary (`not read: ...`) instead
  of dropped unsaid. A span that fits several joins, routes, calls, methods or
  tables is no longer credited to all of them: it is credited to none and
  listed under the new `ambiguous` (`observedFormatVersion: 2`), which the
  summary, `--format json`, the page (*could be more than one place*) and the
  graph server (`seenAmbiguous: n`) show. Counts on joins that used to be
  shared between candidates drop accordingly. The file's name, version, join
  id and reader (`readObserved`) are defined once, in `@flowatlas/core`; the
  page and the graph server still read a version-1 file.

- **A cached graph went stale when what stood in for a package moved (P83).**
  A shape file added under a listed `shapes` glob, a package directory whose
  `name` answered an import nothing had, and one of two directories claiming a
  name going away each left the importer's graph as it was until one of its own
  files changed, under `build --watch` too, where the package index was
  remembered for the life of the process. Each build now records the expanded
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
- **Joins made from the repositories' files no longer counted as unresolved
  (P81).** A request P77 joined from the value a file gives its setting swapped
  an `unknown-base-url-env` row for a `base-url-from-files` row at `info`, and
  "Left unresolved" and the build line barely moved; it was a note now, and
  `missed` went down by the request it joined. A likely N+1 (P69) had been
  printed as "nothing to join" and counted nowhere; it was a finding, counted
  and named where a reader looks.
- **An `accepted.json` that could not be read was wiped (P80).** A file that
  did not parse (a merge conflict, a truncated write), did not match the
  format, or came from a newer flowatlas was read as empty, and the next
  `flowatlas accept` saved it with one entry: every other accepted gap and rule
  was gone, and doctor showed every gap as new without saying why. Adding and
  `--remove` refused instead, exit 2, naming the file and the problem, and left
  it as it was; `--list` and `--dry-run` said the problem first. Doctor (a
  warning line and `unresolved.accepted.problem`), `doctor --unresolved`,
  `shapes --suggest`, `visualise` and the graph server's `cant_follow` and
  `search` (a `note`) said it and accepted nothing. The file was written
  through a temporary renamed into place. `readAccepted` returned the gaps and
  the problem; `loadAccepted` was kept one version.
- **A large service file no longer slowed the cold build down (P79).** The
  call-shape pass of P69 walked every call in a file once for each call edge
  it looked up there, so its cost grew with calls times edges; it, and the
  pass that marks edges typed by a stand-in (P78), read one index of the
  file's calls by line instead, built once per parsed file. Every line and
  column the readers write was found by a lookup in a list of the file's line
  breaks, kept once per parsed file, rather than by counting newlines from the
  top of the file for each node (P123). The method a call names on a class,
  and a field or getter a reader looks up there, came from one walk of the
  class's members kept per class, instead of a walk of every member for each
  call (P124); whether a node is a conditional write was worked out once per
  node rather than once per search that visited it (P129). The graph was
  unchanged. `scripts/bench-call-shape.mjs` measured the pass over a
  generated service.
- **Package sources cost a build less (P82).** The index of the package
  sources a service may read in place of an install, and every listed shape
  file, were worked out once by `flowatlas build` and written to
  `<output>/stand-ins.json`, which each repository read in a process of its own
  was handed instead of indexing and parsing them again (a watch worked them
  out once for every repository it held open). A path's mount was found by the
  `node_modules/<name>` segment it is under rather than by trying every mount,
  on every file-system call the compiler made; the files a program read from
  its mounts were listed once per program; the package a file belongs to, a
  package's own aliases and the shapes a project installed were looked up
  rather than scanned for. A reader handed a `stand-ins.json` of another version
  worked them out itself; `flowatlas extract` run by hand always did, and came
  to the same graph. Every graph was unchanged.
  `scripts/bench-package-sources.mjs` measured a cold build with
  `packageSources` on against off over a generated project.
- **Error actions and run-time batch lists (P62).** A function an IoT rule's
  `error_action` names was taken as the code the rule's entry runs
  (`meta.invokes`) when no other action had named one first; it became always
  a reference carrying `when: "failure"`. The edge to a queue, topic, bus or
  stream an `error_action` publishes onto gained `meta.when: "failure"`, as its
  producer already had. A Step Functions batch or transaction whose whole list
  is a path (`RequestItems.$`, `TransactItems.$`) or a JSONata expression
  became one `workflow-target-dynamic` row per state naming that field, instead
  of a state whose `TableName` is missing
  (`fixtures/lambda-terraform-table-stream`).
- **A transaction's `ConditionCheck` (P55)** names no written table and stopped
  reading as an address nobody could read, in code and in a definition; a batch
  or a transaction writes no single message, so it stopped being a
  `payload-type-unknown` row.
- **Routes of two APIs, two listeners or two addresses stayed apart (P59,
  P61).** Two API Gateway APIs (REST, HTTP or WebSocket) or two load balancers
  of one deployment serving the same method and path, each in front of its own
  function, were one entry node. Such a route became keyed with its API,
  `GET:/status@api:<api>`, and with the listener where two listeners of one
  load balancer send it to different functions,
  `GET:/health@api:staff-lb@listener:HTTPS:443`; listeners sending it to one
  target stayed one route. An API or load balancer whose name is not read was
  keyed by its Terraform address,
  `GET:/hours@api:aws_apigatewayv2_api.desk_hours`. A route no other API serves
  kept its plain key, so existing ids did not move. Routes were compared across
  every deployment a repository is read from, and a route rooted at another
  repository's point that lands on a route of another API kept both apart
  rather than being reported as declared twice. A request reaching them through
  a `baseUrlEnv` setting, and a `@CallsService` annotation whose route several
  APIs serve, joined the API whose name shares the most words with the
  setting's (`LOANS_API_URL` → `library-loans-api`), `via: "apiName"`,
  `heuristic`, with a `route-api-guessed` row at `info`; where the name settled
  nothing, an `ambiguous-route-api` row named the APIs and nothing was joined.
  Annotations on methods of plain classes, as a function's code writes them,
  were read (`fixtures/lambda-terraform-shared-paths`).
- **The page's ways-in filter matched service names (P73 follow-up)**, not only
  a way in's own label.
- **The Map fit a short drawing at the top of its frame on first load (P73)**,
  and *Copy link* and *Full screen* kept their icons at phone width.

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

[unreleased]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Panevschi-Ruslan/flowatlas/tree/v0.2.0
[0.1.1]: https://www.npmjs.com/package/@flowatlas/cli/v/0.1.1
