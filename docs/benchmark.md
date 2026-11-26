# Does flowatlas help an assistant? Measured

Run `2026-11-07-pilot`: flowatlas 0.6.0 (a5a20c8a), claude-code 2.1.319 (Claude Code), model claude-sonnet-5-5, seed 1, 1 run a question an arm, 2026-11-07. **A pilot**: one run each, eight questions, for the estimate; not a result to quote.

## How it is measured

A generated project of eight TypeScript repositories - a NestJS gateway, three
NestJS services, an Express service, Lambda functions declared in Terraform, a
React storefront and an Angular back office, and a package of shared types -
is asked 42 fixed questions (`scripts/bench-agent/questions.yaml`). The
answers are marked against a key the generator writes from its own model of
what it generated, never from flowatlas's reading of it. The project has
traps: routes nothing calls, an event nobody handles, a call made through a
helper, an address read from a settings object, a field renamed across a
boundary.

Beside the questions that name what to look at, three kinds ask what a
change needs or where something is: *find the bug*, six planted defects (a
route renamed on the server with its old caller left, a body field renamed
on one side, an event renamed on one side, a literal route declared after a
`:id` route that answers first, a setting renamed in the deployment only, a
write route left without the guard its siblings carry), each beside a twin
that looks like it and is right, marked as true positives minus false
positives over the defects planted, so naming every odd thing costs as much
as missing one; *change files*, every file in every repository a rename of a
route or an event touches; and *navigation*, a question in words ("where are
coupons exported?") with no name from the code.

| Arm | Workspace | flowatlas |
|---|---|---|
| A | every repository side by side | none |
| B | the repository the question is asked from | none |
| C | that repository | the graph of all of them over MCP, and the guide |
| D | every repository | the graph over MCP, and the guide |
| E | every repository | the graph through the terminal only: no server, the guide spells the commands |
| F | every repository | D, and prompt cards: the graph's answer for what a prompt names, before the first turn |
| G | every repository | D, with four core tools upfront instead of nine |

A is search's best case and B its usual one; C is what one person in one
repository gets; D isolates what the graph adds when search sees everything
too. E, F and G each change one thing of D, and run when asked
(`--arms`): what a server's listing costs against the commands, what an
answer handed over before the first turn saves, and what four upfront
schemas save on every turn against the ToolSearch a fifth tool needs.
Every arm has the same model, the same prompt and the same tools for
reading and searching, in a fresh copy of its workspace; the person's own
settings, hooks and MCP servers are left out. Each question runs at least
three times an arm, and the tables give the median and the range. The kinds
where the graph should not help - one repository's own code, a constant, what
a method does - are asked and reported like the rest. What was expected was
written down before the first run (`scripts/bench-agent/expectations.md`) and
is compared below.

The guide the graph arms read is what `flowatlas agents install
--instructions --hook` writes in each repository: the skill, the marked block
in `AGENTS.md` (and `CLAUDE.md` where there is one), and the search and
edit hooks, with
`--no-prompt-cards` unless the run is started with `--prompt-cards` (F always
has the prompt hook; E adds `--terminal`). A project of your own is set up
the way arm D is measured with `flowatlas build`, `flowatlas mcp --install`
and `flowatlas agents install --instructions --hook --no-prompt-cards`, or
without `--no-prompt-cards` for F's.

## Run it yourself

```sh
pnpm install && pnpm -r build
node scripts/bench-agent/run.mjs --pilot        # 32 sessions; prints what a full run would take
node scripts/bench-agent/run.mjs --full --yes   # after the pilot
node scripts/bench-agent/report.mjs scripts/bench-agent/results/<the run>
node scripts/bench-agent/run.mjs --pilot --arms A,D,E,F,G   # the terminal, prompt-card and four-upfront arms beside A and D
node scripts/bench-agent/run.mjs --pilot --kinds find-the-bug,change-files,navigation
node scripts/bench-agent/turns.mjs scripts/bench-agent/results/<the run>   # where every turn went
```

It drives Claude Code in print mode on the account you are signed in with,
so it spends that account's usage. A run stopped by a usage limit goes on
with `--resume <the run>`. `node scripts/bench-agent/run.mjs --dry` checks the
generator, the key and the scorers with no assistant at all, and is part of
`pnpm check`. The graph arms run without prompt cards unless the run is started
with `--prompt-cards` (P386), which installs the prompt hook too and says so in
`run.json`; a full run then needs a pilot started the same way.

Each session's transcript stays in the work directory; what its turns went
on - a ToolSearch, a skill read, `start_here`, a lookup before the question's
own call, a failed call, a second graph call, a read after a complete answer -
is classified from it (`turns.mjs`) and kept with the session's measures.

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

## What a right answer cost

Tokens per fully right answer are every token of an arm over its answers fully right. A wasted call is one whose answer holds none of what the final answer names (judged only where it names items). pass^k: the share of questions all k runs got fully right.

| Arm | Tokens a question | Tokens per right answer | Extra turns | Tool errors | Wasted calls | pass^k |
|---|---|---|---|---|---|---|
| A | 69k | 84k | — | — | — | — |
| B | 92k | 246k | — | — | — | — |
| C | 98k | 108k | — | — | — | — |
| D | 73k | 96k | — | — | — | — |

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
- `find-the-bug: C > B` not measured in this run
- `find-the-bug: D >= A` not measured in this run
- `change-files: C > B` not measured in this run
- `change-files: D >= A` not measured in this run
- `navigation: C > B` not measured in this run
- `navigation: D >= A` not measured in this run
- `cross-repo-callers: E >= D` not measured in this run
- `tokens single-repo: E < D` not measured in this run
- `tokens cross-repo-callers: F < D` not measured in this run
- `calls cross-repo-callers: F < D` not measured in this run
- `cross-repo-callers: G >= D` not measured in this run
- `tokens single-repo: G < D` not measured in this run

## Where the graph did worse

No question scored lower with the graph than with every repository open and search alone.

## Every session

- answered, read by answer-line: 32

