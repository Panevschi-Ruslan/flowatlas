# Running flowatlas in CI

One job, and a decision about how strict to be on the first day.

`flowatlas doctor` reads a graph and answers in five sections. Without `--strict`
it reports and exits 0, because a report is not a failure. With `--strict` it
fails a build on three things and nothing else:

- an annotation that is wrong,
- a contract error between two repositories,
- more unresolved places than the project has accepted.

Everything else is printed and costs nothing.

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
unresolved: total=40 (missing) · markers: errors=0 warnings=0 · desync=0 · contracts: errors=107 ignored=0 · exit=0
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
```

`--format github` prints one `::error file=…,line=…::` per finding, so they
appear against the lines that caused them rather than only in the log.

## On a pull request

`flowatlas diff` answers the question a reviewer has, which is not which lines
moved:

```sh
flowatlas diff origin/main --format markdown --output diff.md
```

It reads each repository at its own commit through a detached worktree, so
uncommitted work is never touched, and it remembers each graph under the commit
that produced it, so the second run is much faster than the first.

The report has three parts. What changed, and what reaches it from anywhere in
the project — including a node that is gone, walked on the base graph, because a
removal nobody can see the effect of is the dangerous kind. What the revision did
to the contracts, sorted into new, fixed, already there and excused. And which
types changed shape.

To fail only on a break this branch introduced:

```sh
flowatlas diff origin/main --fail-on-contract-break
```

A pre-existing error is somebody else's problem and an excused one is nobody's,
so neither stops the build.

## Two things that will bite you otherwise

**Every repository needs its dependencies installed.** flowatlas reads types, and
a repository with no `node_modules` resolves nothing, which looks exactly like a
repository with nothing in it.

**`fetch-depth: 0`.** A shallow clone has no `origin/main` to compare against,
and `diff` will tell you the ref was not found rather than guess.
