# Running flowatlas in CI

One job, and a decision about how strict to be on the first day.

`flowatlas doctor` reads a graph and answers in five sections. Without `--strict`
it reports and exits 0, because a report is not a failure. With `--strict` it
fails a build on three things and nothing else:

- an annotation that is wrong,
- a contract error between two repositories,
- more unresolved places than the project has accepted.

Everything else is printed and costs nothing.

With one exception, which is not about how strict you asked it to be. Four
graphs are refused with exit 2 — the code that has always meant "the check could
not be run" — with or without `--strict`:

- a graph that holds nothing;
- a graph whose build recorded that a repository could not be read;
- a graph a service was read into and contributed nothing to;
- a graph where most of one service's ways in have no handler that was read.
  The growth check sees a change only when the change adds a row, and a change
  inside a body nobody read never does, so for that service the gate would be
  blind rather than lax. It is decided service by service, so a service read end
  to end cannot carry a hollow one past the check, and `doctor` prints the two
  numbers, found and read, above the rows. A few unread handlers among many read
  ones are ordinary rows.

A job that treats 2 as a failure is treating it correctly: the reading is broken
rather than the project, and 0 over one of those graphs is a clean bill of health
on something nobody read. `--accept` refuses the same four, so a baseline can
never be written over one.

## What to turn on first

Almost no project can adopt all three on the first day, and one that fails on
every branch is switched off within a week. Turn them on in the order the
numbers allow.

Start by seeing where you stand:

```sh
flowatlas build
flowatlas doctor
```

The last line says it in one sentence:

```
unresolved: total=40 (missing) · markers: errors=0 warnings=0 · desync=0 · contracts: errors=1 ignored=0 · exit=0
```

Read it as three separate decisions.

**Annotations.** `markers: errors=0` means every `@CallsService`, `@Emits` and
`@Consumes` in the project is true. If that is your number, it costs nothing to
keep it that way, and it is the check that catches an annotation left behind by
a rename.

**Unresolved growth.** Accept what is there today:

```sh
flowatlas doctor --accept
git add flowatlas.baseline.json && git commit -m "flowatlas: accept what is unresolved today"
```

The baseline is a decision your team made, so it is committed like a lockfile.
It counts places rather than rows and names each by where it is and what it is,
never by which line it sits on, so a reformat does not fail a build. It leaves
out the rows that describe what static reading cannot see: no edit removes one,
so growing on them would fail a build nobody can fix.

A gap that will never be fixed can be accepted on its own rather than counted,
with a note saying why: `flowatlas accept <reason> --service <name> --note '…'`,
or by rule with `--path` or a file glob. `doctor` then leaves it out of every
count, including the growth check. It writes `accepted.json` beside `graph.db`,
in the configured output; for the job to see it, commit that file too, even if
the rest of the output directory is ignored.

**Contracts.** These are the ones a project usually has a backlog of. If
`contracts: errors=N` with N large, leave them out until they have been read:

```sh
flowatlas doctor --strict --no-contracts
```

and turn them on by deleting that flag once N is 0.

## The job

```yaml
name: flowatlas

on:
  push:
    branches: [main]
  pull_request:

jobs:
  flowatlas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # `flowatlas diff` needs the history

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      # Every repository the configuration names has to be on disk, and each
      # needs its own dependencies: the type checker resolves against them, and
      # without them a repository reads as though half its code were missing.
      - run: npm ci

      - run: npx @flowatlas/cli build
      - run: npx @flowatlas/cli doctor --strict --no-contracts --format github
      # Pages whose doc blocks no longer say what the graph says.
      - run: npx @flowatlas/cli docs --check --format github
```

`--format github` prints one `::error file=…,line=…::` per finding, so they
appear against the lines that caused them rather than only in the log.

**Docs.** A page that names a flow in a doc block (see
[`flowatlas docs`](CLI.md#flowatlas-docs-paths)) is checked like code:
`docs --check` exits 1 when a flow a block describes gained or lost a step
since the block was written, when its id names nothing any more, or when it
names more than one thing, and `--format github` puts a `::warning` at the
block's opening line. The fix is `flowatlas docs --write`, committed with the
change; a reformat or a line moved never fails it, because the fingerprint is
of the steps, not of the text. Set `docs.files` in the configuration to read
only the pages that hold blocks.

## On a pull request

`flowatlas diff` answers the question a reviewer has, which is not which lines
moved:

```sh
flowatlas diff origin/main --format markdown --output diff.md
```

It reads each repository at its own commit through a detached worktree, so
uncommitted work is never touched, and it remembers each graph under the commit
that produced it, so the second run is much faster than the first.

The report has four parts. What changed, and what reaches it from anywhere in
the project — including a node that is gone, walked on the base graph, because a
removal nobody can see the effect of is the dangerous kind. What each of those
ways in does now that it did not before: under **Changed flows**, one Mermaid
sequence diagram per changed flow across the services, added steps in green,
removed ones in red with a cross, a changed request body named in a note, and
the same steps listed as text under it for a reader whose mail or client does
not render Mermaid. What the revision did to the contracts, sorted into new,
fixed, already there and excused. And which types changed shape. Where the
project has doc blocks, **Docs this branch makes stale** lists the ones that
were true on the base and are not on this branch, at their `file:line`, so the
page is updated in the same pull request.

The comment stays under `--max-chars` (60,000 by default; a GitHub comment
holds 65,536): the diagrams are dropped from the last one back, then whole
flows, each counted, and the line that says so names `diff.json`, which always
has every flow. `--max-diagrams` (5) and `--context` (3 unchanged steps on each
side of a change) keep a large branch readable, and `--no-diagrams` lists the
steps alone. Posting it is the workflow's job:

```sh
flowatlas diff origin/main --output diff.md
gh pr comment "$PR" --body-file diff.md
```

To see one flow's diagram locally, as the comment draws it without the marks:
`flowatlas flow "POST /orders" --format sequence`.

To fail only on a break this branch introduced:

```sh
flowatlas diff origin/main --fail-on-contract-break
```

A pre-existing error is somebody else's problem and an excused one is nobody's,
so neither stops the build.

## Three things that will bite you otherwise

**Every repository needs its dependencies installed.** flowatlas reads types, and
a repository with no `node_modules` resolves nothing outside itself. It is still
read — what its own source states is read, and marked `heuristic` — and the run
says once, at the head of `doctor` and after `build`'s `unresolved` line, that
the read was partial. But a CI job is the one place the install costs nothing,
and a graph read with every type resolved is the one to gate on. Install without
running scripts if you must, and know that a client a postinstall script
generates is then absent either way.

**`fetch-depth: 0`.** A shallow clone has no `origin/main` to compare against,
and `diff` will tell you the ref was not found rather than guess.

**A large monorepo wants a larger heap.** Each repository is read in a process
of its own and held in memory while it is read. `build` asks for a share of the
machine, divided by how many repositories it reads at once, and a read that
still does not fit exits 2 naming the repository, the limit that did not hold and
the flag that raises it. On a small runner, lower `--concurrency` so each read
gets a larger share, or set `--heap` to what the runner can actually give.
