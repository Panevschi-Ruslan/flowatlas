# Does flowatlas help an assistant? Measured

Run `2026-11-07-pilot`: flowatlas 0.6.0 (a5a20c8a), claude-code 2.1.319 (Claude Code), model claude-sonnet-5-5, seed 1, 1 run a question an arm, 2026-11-07. **A pilot**: one run each, eight questions, for the estimate; not a result to quote.

## How it is measured

A generated project of eight TypeScript repositories - a NestJS gateway, three
NestJS services, an Express service, Lambda functions declared in Terraform, a
React storefront and an Angular back office, and a package of shared types -
is asked 30 fixed questions (`scripts/bench-agent/questions.yaml`). The
answers are marked against a key the generator writes from its own model of
what it generated, never from flowatlas's reading of it. The project has
traps: routes nothing calls, an event nobody handles, a call made through a
helper, an address read from a settings object, a field renamed across a
boundary.

| Arm | Workspace | flowatlas |
|---|---|---|
| A | every repository side by side | none |
| B | the repository the question is asked from | none |
| C | that repository | the graph of all of them over MCP, and the guide |
| D | every repository | the graph over MCP, and the guide |

A is search's best case and B its usual one; C is what one person in one
repository gets; D isolates what the graph adds when search sees everything
too. Every arm has the same model, the same prompt and the same tools for
reading and searching, in a fresh copy of its workspace; the person's own
settings, hooks and MCP servers are left out. Each question runs at least
three times an arm, and the tables give the median and the range. The kinds
where the graph should not help - one repository's own code, a constant, what
a method does - are asked and reported like the rest. What was expected was
written down before the first run (`scripts/bench-agent/expectations.md`) and
is compared below.

## Run it yourself

```sh
pnpm install && pnpm -r build
node scripts/bench-agent/run.mjs --pilot        # 32 sessions; prints what a full run would take
node scripts/bench-agent/run.mjs --full --yes   # after the pilot
node scripts/bench-agent/report.mjs scripts/bench-agent/results/<the run>
```

It drives Claude Code in print mode on the account you are signed in with,
so it spends that account's usage. A run stopped by a usage limit goes on
with `--resume <the run>`. `node scripts/bench-agent/run.mjs --dry` checks the
generator, the key and the scorers with no assistant at all, and is part of
`pnpm check`.

## Results by kind

Each cell: median score (range) · fully right · median tool calls · tokens · time.

| Kind | A | B | C | D |
|---|---|---|---|---|
| cross-repo-callers | 1.00 (1.00–1.00) · 1/1 · 4 calls · 69k tok · 7s | 0.00 (0.00–0.00) · 0/1 · 4 calls · 92k tok · 10s | 1.00 (1.00–1.00) · 1/1 · 3 calls · 98k tok · 8s | 1.00 (1.00–1.00) · 1/1 · 3 calls · 93k tok · 8s |
| blast-radius | 1.00 (1.00–1.00) · 1/1 · 8 calls · 90k tok · 11s | 0.00 (0.00–0.00) · 0/1 · 5 calls · 89k tok · 11s | 1.00 (1.00–1.00) · 1/1 · 3 calls · 103k tok · 9s | 1.00 (1.00–1.00) · 1/1 · 4 calls · 124k tok · 9s |
| event-handlers | 1.00 (1.00–1.00) · 1/1 · 4 calls · 64k tok · 7s | 0.00 (0.00–0.00) · 0/1 · 5 calls · 92k tok · 10s | 1.00 (1.00–1.00) · 1/1 · 3 calls · 72k tok · 5s | 1.00 (1.00–1.00) · 1/1 · 3 calls · 69k tok · 5s |
| dead | 1.00 (1.00–1.00) · 1/1 · 8 calls · 169k tok · 23s | 0.62 (0.62–0.62) · 0/1 · 8 calls · 218k tok · 21s | 1.00 (1.00–1.00) · 1/1 · 4 calls · 112k tok · 12s | 1.00 (1.00–1.00) · 1/1 · 4 calls · 126k tok · 15s |
| contract | 1.00 (1.00–1.00) · 1/1 · 3 calls · 70k tok · 7s | 1.00 (1.00–1.00) · 1/1 · 7 calls · 162k tok · 18s | 1.00 (1.00–1.00) · 1/1 · 9 calls · 206k tok · 14s | 1.00 (1.00–1.00) · 1/1 · 4 calls · 73k tok · 7s |
| settings | 1.00 (1.00–1.00) · 1/1 · 4 calls · 109k tok · 13s | 1.00 (1.00–1.00) · 1/1 · 10 calls · 226k tok · 18s | 1.00 (1.00–1.00) · 1/1 · 6 calls · 158k tok · 13s | 1.00 (1.00–1.00) · 1/1 · 7 calls · 168k tok · 17s |
| single-repo | 1.00 (1.00–1.00) · 1/1 · 2 calls · 63k tok · 5s | 1.00 (1.00–1.00) · 1/1 · 2 calls · 63k tok · 6s | 1.00 (1.00–1.00) · 1/1 · 2 calls · 71k tok · 6s | 1.00 (1.00–1.00) · 1/1 · 2 calls · 70k tok · 6s |
| code-text | 1.00 (1.00–1.00) · 1/1 · 1 calls · 41k tok · 4s | 1.00 (1.00–1.00) · 1/1 · 1 calls · 41k tok · 3s | 1.00 (1.00–1.00) · 1/1 · 1 calls · 47k tok · 3s | 1.00 (1.00–1.00) · 1/1 · 1 calls · 45k tok · 5s |

## What was expected

- `cross-repo-callers: C > B` held: 1.00 against 0.00
- `cross-repo-callers: D >= A` held: 1.00 against 1.00
- `calls cross-repo-callers: D < A` held: 3 against 4
- `blast-radius: C > B` held: 1.00 against 0.00
- `blast-radius: D >= A` held: 1.00 against 1.00
- `tokens blast-radius: D < A` **did not hold**: 123629 against 89999
- `event-handlers: C > B` held: 1.00 against 0.00
- `event-handlers: D >= A` held: 1.00 against 1.00
- `dead: C > B` held: 1.00 against 0.62
- `dead: D > A` **did not hold**: 1.00 against 1.00
- `contract: D >= A` held: 1.00 against 1.00
- `settings: D <= A` held: 1.00 against 1.00
- `single-repo: C = B` held: 1.00 against 1.00
- `single-repo: D = A` held: 1.00 against 1.00
- `code-text: C = B` held: 1.00 against 1.00
- `code-text: D = A` held: 1.00 against 1.00
- `explain: C = B` not measured in this run
- `explain: D = A` not measured in this run
- `tokens single-repo: C > B` held: 71356 against 62959

## Where the graph did worse

No question scored lower with the graph than with every repository open and search alone.

## Every session

- answered, read by answer-line: 32

