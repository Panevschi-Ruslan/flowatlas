# Running flowatlas in CI

One job, and a decision about how strict to be on the first day.

`flowatlas doctor` reads a graph and answers in six sections. Without `--strict`
it reports and exits 0, because a report is not a failure. With `--strict` it
fails a build on four things and nothing else:

- an annotation that is wrong,
- a contract error between two repositories,
- a violation of an architecture rule at `error` the baseline does not hold,
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
unresolved: total=40 (missing) · markers: errors=0 warnings=0 · desync=0 · contracts: errors=1 ignored=0 · rules: errors=0 new=0 · exit=0
```

Read it as four separate decisions.

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

**Architecture rules.** Write down the rules the team already believes are
true - a frontend reaching only its gateway, one owner per table - under
`rules` in `flowatlas.config.json` (the CLI reference has the four shapes), and
look before anything fails:

```sh
flowatlas rules --list      # how many nodes each side of each rule selects
flowatlas rules             # each violation, where it crosses, and why the rule exists
```

A side that selects nothing is a typo, and is listed as not checked rather than
passed. Turn them on in this order: first as `severity: "warning"` while the
violations are read; then accept what is real and planned for, with a note
(`flowatlas accept rule:<name> --service <name> --note '…'`) or by
`flowatlas doctor --accept`, which writes their keys into the baseline; then
`error`, so `doctor --strict` fails on a new one. A violation along a guessed
edge is shown and never fails a run until `rulesSettings.failOnHeuristic` says
so - leave it off until the guesses are rare.

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
      # The architecture rules on their own, once they are at error; doctor
      # --strict already fails on a new violation, so this is for a report.
      - run: npx @flowatlas/cli rules --format github --fail-on error
```

`--format github` prints one `::error file=…,line=…::` per finding, so they
appear against the lines that caused them rather than only in the log.

## Code scanning

Workflow annotations vanish with the job and cannot be dismissed. A SARIF log
is the same findings in the format code scanning keeps: each result on the line
it is about in the pull request, an alert that stays open while the finding is
there, closes when it is fixed, and can be dismissed with a reason.

```yaml
name: flowatlas code scanning

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  security-events: write    # what the upload needs

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci

      - run: npx @flowatlas/cli build
      - run: npx @flowatlas/cli contracts --format sarif --output contracts.sarif
      # Last, because --strict is the step that fails the job.
      - run: npx @flowatlas/cli doctor --strict --format sarif --output doctor.sarif

      # always(): a failing gate still uploads what it found.
      - if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: doctor.sarif
          category: flowatlas/doctor/
      - if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: contracts.sarif
          category: flowatlas/contracts/
```

One file and one `category` per command. Each log already carries its
category (`automationDetails.id`, `flowatlas/<command>/`); the step names the
same one. Code scanning replaces a category's alerts on each upload, so one
category per command is what keeps the doctor's alerts open on a run that
uploaded only contracts. `rules`, `dead`, `cycles` and `diff` take
`--format sarif --output <file>` the same way; `dead` is notes only, worth
uploading once its rows have been read.

The format decides no exit code: `doctor --strict` fails on what it always
failed on, and `contracts` only with `--fail-on`. Each result's fingerprint is
made of the key the baseline already uses, never a line, so a reformat keeps an
alert open; a row the baseline holds is marked `unchanged`, and a gap or rule
violation `accepted.json` names, or a contract finding `@ContractIgnore`
excuses, is written suppressed with the note it was accepted with, so it shows
as dismissed rather than new.

**A project in several repositories.** Paths are written as the
configuration's directory sees them (`billing/src/invoices/x.ts`), which is
right when the configuration sits at the root of one checkout holding every
service. When each repository uploads to itself, run the command once per
repository with `--sarif-root <that checkout>`: paths are then relative to it,
and a result whose place is in another repository is left out of that log and
counted in a notification, to be uploaded by the job of the repository it
belongs to.

The upload is GitHub's feature, not a flowatlas service: the tool writes a
file, and the workflow decides where it goes. Any code host that reads SARIF
2.1.0 reads the same file.

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
fixed, already there and excused, and to the architecture rules the same way.
And which types changed shape.

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
flowatlas diff origin/main --fail-on-contract-break --fail-on-rule-break
```

The second flag does for the architecture rules what the first does for the
contracts: the comment's **Rules** section sorts violations into new, fixed,
already there and excused, and only a new one at `error` fails the build.

A pre-existing error is somebody else's problem and an excused one is nobody's,
so neither stops the build.

## Before a deploy

A pull request is compared with `main`. A deploy should be compared with what
runs: `main` of another service is often ahead of what is deployed, so a branch
that agrees with it can still break production. `flowatlas check` reads every
service at the ref an environment runs and puts the one being shipped in its
place:

```sh
flowatlas check --env prod --service orders --head "$GITHUB_SHA" --format markdown --output check.md
```

The running versions come from a committed `flowatlas.deployed.json`, or from the
deploy job itself, which usually knows them already:

```sh
flowatlas check --env prod --service orders --head "$GITHUB_SHA" \
  --pin billing="$BILLING_RUNNING" --pin gateway="$GATEWAY_RUNNING"
# or: FLOWATLAS_PIN_BILLING=v2.3.1 FLOWATLAS_PIN_GATEWAY=4f1c2a9 flowatlas check --env prod --service orders
```

It exits 0 when deployable, 1 when deploying would introduce a contract error, a
violation of a rule at `error`, or a call or channel left with nothing to join
(each named with the file and line of the end left behind), and 2 when it cannot
decide. Problems already running in that environment are listed and never fail
the job. Several environments at once (`--env staging --env prod`) are one
section each, and the exit is the worst.

Every pinned ref must be in the checkout. Check every repository out with its
whole history and tags, or the run refuses rather than guess:

```yaml
- uses: actions/checkout@v4
  with: { repository: acme/billing, path: billing, fetch-depth: 0 }
- run: git -C billing fetch --tags
```

After the deploy, record what ran, by commit, and commit the file back (or keep
it in the pipeline's own store and pass `--pins`):

```sh
flowatlas deployed set prod orders "$GITHUB_SHA" --resolve
git commit -m "deployed orders to prod" flowatlas.deployed.json
```

`flowatlas deployed show` prints each environment's pins with their commits and
ages, and warns of a pin that names a branch, which moves.

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
