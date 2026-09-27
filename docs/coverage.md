# Coverage: measuring the tool against repositories nobody here wrote

Every other number in this repository is measured against a fixture somebody
here wrote. A fixture is a controlled experiment, and it is worth exactly what
the person who wrote it knew to put in it. Reading real repositories by hand
finds what the fixtures miss, and a reading by hand cannot be repeated.

This is that measurement, made repeatable.

```sh
pnpm coverage                        # every target, from fresh clones
pnpm coverage --target <name>        # one of them
pnpm coverage:deps                   # again, with dependencies installed
pnpm coverage:render                 # re-write the reports from the cache
pnpm coverage:pin                    # move the pins to today's commits
pnpm coverage:gate                   # the read gate alone, over the fixtures
```

`coverage:render` is for changing the counting rule or the wording of a report.
It counts ground truth again over the clones already in the cache and re-writes
every report from the measurement kept beside each build. Nothing is cloned,
installed or built, so it takes a second instead of an hour.

**It is not part of `pnpm check`.** It clones other people's repositories and
takes minutes. Run it deliberately: before a release, and after any change to a
reader. Then read the diff. The one part of it that *is* in `pnpm check` is the
read gate, run over the fixtures (see below).

---

## What it measures, and against what

The targets are listed in
[`scripts/coverage/targets.json`](../scripts/coverage/targets.json). Each is a
record: the repository, the commit it is pinned at, the directories inside the
clone to read, and a sentence saying what the target is for, which is printed at
the head of its report. A number without a commit means nothing next month, so
the commit is in the list and in every report.

Nothing in that list says how a repository should be read. Each entry names
directories, and `flowatlas link` decides the type of each one by reading its
manifest, exactly as it would for anybody else. The file allows one override, a
service's `type`, because choosing a type is configuration a real user writes;
where it is used the report prints both what `link` guessed and what was set, so
a wrong guess stays visible. A target cannot be made to look better by writing a
cleverer configuration for it, because there is no other place to write one.

The harness measures the tool in the tree or it refuses. It runs the built
bundle, and a reader edited and not rebuilt is not in the bundle, so a run whose
sources are newer than `packages/cli/dist` is refused rather than answered. A fix
that looks as though it did nothing is the one result a coverage harness must
never produce by accident.

## The two states, and why both

A **fresh clone** has no `node_modules`. The checker resolves almost nothing
outside the repository, and that is what a stranger gets when they clone a
project and run this tool on it. It is a real question and the tool should
answer it well. A fresh report says on its face that it is a partial read and
that its figures are a floor: what it still reads is what the repository's own
source states.

**With dependencies installed** the checker can follow a type into a package,
and the answers differ a great deal. Each state gets its own committed report,
`<target>.md` and `<target>.with-deps.md` under `scripts/coverage/reports/`, so
neither hides behind the other.

Dependencies are installed with `--ignore-scripts`. Running strangers'
postinstall hooks on a developer's machine is not worth a coverage number, and
what an install is needed for here is resolvable types rather than generated
artefacts. Where that costs something real, such as a database client that a
postinstall hook generates and that is therefore not there, the report says so
instead of quietly filing it as a limit of the tool.

An install that fails is never written down as a measurement. `--install`
refuses that target, leaves its report alone, exits non-zero and names the
package manager and what it said, because a report carrying fresh-clone figures
under an installed heading is a lie about the state it was taken in. A build that
crashes is different, and is covered under [Failing is data](#failing-is-data).

## Ground truth, by one rule

A denominator that depends on who held the pen is not a denominator, so there is
one rule, written once in prose beside the code that implements it:
[`scripts/coverage/counting-rule.mjs`](../scripts/coverage/counting-rule.mjs).

Ground truth is the number of **declaration sites** that a fixed set of textual
probes finds in a service's source files. A source file is a file the repository
tracks in git, inside the service's **extent**, with a source extension, outside
tests and build output. Nothing git does not carry is counted, so the same file
list is counted whether or not the dependencies are installed.

The extent is the service's own directory plus the workspace packages it
declares at run time, which is what the tool itself reads as one service.
[`scripts/coverage/extent.mjs`](../scripts/coverage/extent.mjs) works it out
from the repository's own manifests and never by asking the tool. That is on
purpose: a denominator computed by the code being measured cannot disagree with
it, and a reader that stopped walking a package early would lose the same package
from both sides of the fraction and still read a hundred per cent. The price is
two implementations of one question, and invariant I14 in `pnpm invariants` holds
them to each other over every fixture, failing on any disagreement and naming
the packages each side claims.

A probe is a named pattern. A `line` probe counts every match in a file; a
`file` probe counts a whole file once, which is how a router that keeps the
address in the directory name is counted at all. Each probe belongs to one of
five families: `routes`, `screens`, `clicks`, `data` and `models`.

**Every probe runs against every repository.** A probe that does not apply
returns zero there, and that zero is part of the answer rather than a gap in it.
No probe is switched on or off per target, and none was added because one
repository needed a number to come out right. A probe that is wrong is wrong
everywhere at once. Every report prints the per-probe counts, so a figure that
looks wrong can be checked against the pattern that produced it in one step.

Where a repository writes a family in a style no probe knows, the denominator is
zero and the report says "no denominator: the rule has no probe for it" rather
than "nothing of this kind here", because the two read the same in a table and
mean opposite things.

## The numbers, and why these ones

A route is at three different numbers and only the last two are coverage:

| | means |
|---|---|
| **discovered** | the tool placed an entry point at an address |
| **with a body attached** | it also found the handler the framework will run |
| **whose body reaches anything** | that handler goes on to call, query, request, publish, cache or read a setting |

A repository can have every one of its routes discovered and the code behind
half of them read. A report that printed only the first number would call that
full coverage, which is why `build` prints the first two apart as well.

The rest of a report is the same shape: requests **found** beside requests
**joined**, channels beside channels with both ends, query sites beside query
sites that name a table, addresses told apart only by the application that
serves them, and the unresolved rows grouped by reason and level. Where the tool
finds more than the rule can see, the figure is printed as a sentence rather
than as a fraction above one.

Node and edge totals are deliberately absent. They move whenever any reader
learns to record one more thing, which would make every report in the directory
a diff with no news in it.

## The read gate

Every measurement is also an assertion, held in
[`scripts/coverage/read-gate.mjs`](../scripts/coverage/read-gate.mjs):

**A file the counting rule found sites of a family in must yield, for that
family, a node, or a row naming the file.**

That is all it asks. A reader that saw a file and could say nothing useful about
it is allowed to say so; a reader that said nothing at all is the defect. It
catches the failure no count can: two controllers lost inside a repository whose
other four hundred were read still leave a family that yielded nodes, and only a
question asked file by file notices them. `routes`, `screens`, `clicks` and
`data` are asked per file. `models` is asked only of the service as a whole,
because a table node carries no file in this graph model: it records where a
table is used, never where it is declared.

It runs in two places. Over the fixtures it reads each one's committed expected
graph, costs a second, needs nothing cloned, and is the last step of
`pnpm fixtures:check`, so `pnpm check` fails on it. Over a coverage target it
reads the graph just built and fails the run.

Three lists in that file say what the assertion does not cover, each entry with
a reason beside it:

- **`EXEMPT`** is a file, or a subtree written `dir/**`, that legitimately yields
  neither a node nor a row for one family, never for all of them. Each entry is a
  sentence somebody has to be willing to defend, and an entry that no longer
  applies fails the gate, because an exemption nobody has removed is an exemption
  nobody has re-read.
- **`BASELINE`** is known red. A gate that is already failing cannot report a new
  failure, because non-zero means "the thing I already know about" to everybody
  who runs it. So a known failure is enumerated exactly: a target, a state, a
  family, a subtree and a count. A run then fails on the difference, which is one
  more file unread, a file unread where no entry reaches, or a count that dropped
  because somebody fixed something and left the excuse behind. It is empty today,
  and stays in the file so the next known failure has somewhere honest to go.
- **`BLIND`** is what the assertion cannot see, as data rather than prose: each
  entry is one kind of failure, with the ticket that established it and what was
  measured. The gate prints how many there are beside `read gate ok`, and a
  report renders the same list, because `ok` is a sentence about one assertion
  and a reader who is never told what it excludes is the person it misleads.
  Today there are four: a family written in a style the rule has no probe for,
  where the check is vacuous; two applications colliding, where the file that
  loses is still named by an edge and so counts as spoken for; a wrong value,
  such as a route placed at the wrong address, which is a node in the right file
  for the right family; and one of several declarations in a file being dropped,
  which would need a per-file comparison of sites against nodes and is recorded
  as deliberately not done.

## Reading it as a diff

The reports are committed so that an improvement is reviewable. They are written
for that:

- no timestamp, and no run-to-run identifiers;
- rows ordered by name, never by size, so one row growing does not reorder a
  table and mark every line as changed;
- wall clock and peak memory printed as bands rather than figures. The figures
  worth having are "seconds or minutes" and "one gigabyte or four", and a band
  says that much and no more, where an exact figure moves between two runs of
  the same commit because something else shared the machine.

A reader should be able to look at the diff of a coverage run and see the one
thing that moved.

## Failing is data

A target whose build crashes or runs out of heap is recorded as the result of the
measurement, with the exit code and what the tool said, rather than as an error
of the harness. It never skips a target for failing.

A tool that dies on a real repository is the single most important thing a
coverage report can say. A harness that hid it behind a stack trace of its own
would be worse than no harness at all.

## The cache

Clones live in `.coverage-cache/` at the root of the checkout, which is
gitignored. A second run re-uses them, so only the first is slow. Everything in
it is derived from `targets.json`, and it is safe to delete at any time:

```sh
rm -rf .coverage-cache
```

## Moving the pins

```sh
pnpm coverage:pin
```

resolves each repository's default branch to a commit and writes it back into
`targets.json`. Do it deliberately and in its own commit: re-pinning and
re-measuring at once produces a diff in which nobody can tell which numbers moved
because the tool changed and which moved because somebody else's repository did.
