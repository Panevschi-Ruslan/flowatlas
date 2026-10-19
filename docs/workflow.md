# flowatlas through a change, start to finish

The other pages say what each command does. This one says **when** to reach for
it: once when you set a project up, then on every change, from the question
"what does this touch" to "it ran in production the way the code says". The
examples use the demo project in `fixtures/multi-repo` (`web`, `gateway`,
`orders`, `billing`).

```
 set up once ──► before a change ──► while coding ──► before the PR ──► in CI ──► deploy ──► after it runs
   init           impact / flow       build --watch     diff             doctor     deployed    observe
   build          who_calls (MCP)     the page          contracts        rules      check --env doctor --strict-runtime
   doctor         channel             docs --write      rules / dead     diff                   visualise --observed-diff
   baseline                                                              SARIF
```

## 0. Set up once

```sh
flowatlas init                 # finds the repositories beside each other and writes flowatlas.config.json
flowatlas build                # reads and joins them into graph.db
flowatlas doctor               # what it could not follow, grouped by cause
```

`doctor` is the to-do list for the map itself. Work it top to bottom:

- **A gap with a fix in the configuration.** For example a base URL in an
  environment variable (`unknown-base-url-env`): add it to the service's
  `hosts`, or let `settingFiles` read your `.env` files. Each row's check says
  how to close it.
- **A package that isn't installed** (a shared internal library): `npm ci` in
  that repository, or describe it with a shape file (`flowatlas shapes --suggest`
  lists which ones are worth it).
- **A wrapper of your own** (an event bus, an HTTP client, a data kit):
  `adapters.http.clients`, or your own extraction patterns
  (`flowatlas patterns suggest`).
- **What you have decided to live with:** `flowatlas accept <reason> --service <name> --note '…'`.
- **`doctor --missing`** names a repository that is probably missing from the
  workspace. Clone it beside the others, or accept it.

Then fix today's count so it can only go down:

```sh
flowatlas doctor --accept      # writes flowatlas.baseline.json
git add flowatlas.baseline.json
```

Give it to your agent. `init` registers the MCP server in every repository; it
lists only the tools your project can answer, and more appear as you add rules,
traffic or a `diff`:

```sh
flowatlas mcp --install
```

## 1. Before a change: what does it touch

Ask before you edit, not after the review.

| Question | CLI | MCP tool |
| --- | --- | --- |
| Who calls this route / method / class? | `flowatlas impact OrdersService.findOne` | `who_calls`, `impact` |
| Where does this request go, across services? | `flowatlas flow "POST /orders" --format sequence` | `get_flow` |
| Who publishes and who consumes this message? | `flowatlas channel order.created` | `who_emits`, `who_consumes` |
| Is this still used at all? | `flowatlas dead` | `dead` |
| Does the other side still expect this shape? | `flowatlas contracts` | `check_contract` |
| Renaming something? | | the `before-rename` prompt |

On the page (`flowatlas visualise`), the same questions are a search away: type a
route, a channel, a table or a class, and Steps shows the request in call order
across services.

## 2. While coding

```sh
flowatlas build --watch        # rebuilds what changed; also sees a new folder or a config edit
flowatlas visualise            # graph.html: reopen it after a rebuild
```

If the repository keeps architecture notes, tie them to the graph so they cannot
drift:

```sh
flowatlas docs --write         # fills the doc blocks from the flows they name
```

## 3. Before the PR: what did the branch change

```sh
flowatlas diff main            # a verdict, changed flows as sequence diagrams, what stopped joining
flowatlas contracts            # request and response shapes across each boundary
flowatlas rules                # the architecture rules you wrote down
flowatlas dead                 # what nothing reaches any more
```

`diff` is the one to read. It names callers in repositories the change does not
touch, such as the gateway route and the browser button above a renamed orders
route. For an agent, the `pr-review` prompt runs `what_changed` with a verdict and
follows its `next` steps. With an API change, `flowatlas spec diff main` compares
the OpenAPI / AsyncAPI documents of both sides.

## 4. In CI

Turn things on in the order [ci.md](ci.md) gives, so the build doesn't fail
on day one:

1. `doctor --strict --no-contracts --format github`: a new gap or a broken
   annotation fails; today's are in the baseline.
2. `rules`: as `warning` first, then accept what's planned, then `error`.
3. `diff origin/main --format markdown` as a PR comment, and
   `--fail-on-contract-break` once contracts are clean.
4. `--format sarif` to put findings on the PR's lines through code scanning.
5. `docs --check`, if you use doc blocks.

## 5. Deploy: can this go out against what is running

```sh
flowatlas deployed set prod orders "$GITHUB_SHA" --resolve   # after each deploy: what runs where
flowatlas check --env prod --service orders                  # before the next one: does it break a caller still on an old version
flowatlas diff --env prod                                    # the branch against what prod runs, not against main
```

## 6. After it runs: what really happened

The map says what *can* happen. Traffic says what *did*, and flowatlas never draws
an edge from a trace, so traffic only confirms or questions the map.

```sh
flowatlas observe traces/            # OTLP, @nestjs/observe, Zipkin, Jaeger, HAR, X-Ray, Step Functions, API Gateway / Lambda logs
flowatlas observe test-results/      # a Playwright run's HAR files: see run-time.md
flowatlas observe --listen           # or receive traces on this machine while you click through the app
flowatlas doctor --strict-runtime    # fail on a status the code does not declare
```

Then read it:

- **Never seen:** routes no request reached. A `dead` candidate with evidence.
- **Blind spots:** traffic the map has no place for (a route read wrong, a missing repository).
- **Failures seen but not declared:** a status a route answered that its code does not say it can.
- **On the page:** the Steps waterfall in real time, the heat map, and Traces.
- **Before and after a release:** `flowatlas visualise --observed-diff before.json after.json`.

## 7. Now and then

- `flowatlas hotspots`: where change concentrates.
- `flowatlas cycles`: services that call each other in a loop.
- `flowatlas dead`: what to delete.
- The page's **Busiest** tab: the ways in that cross the most services.
- `flowatlas export backstage | structurizr`: keep a catalogue or C4 model fed from the code.

## The short version

| When | Run |
| --- | --- |
| once | `init`, `build`, `doctor` until it's short, `doctor --accept`, `mcp --install` |
| before editing | `impact`, `flow`, `channel` (or ask the agent) |
| while editing | `build --watch`, the page |
| before the PR | `diff main`, `contracts`, `rules` |
| CI | `doctor --strict`, `rules`, `diff` as a comment, SARIF |
| deploy | `deployed set`, `check --env` |
| after | `observe`, `doctor --strict-runtime`, `visualise --observed-diff` |
