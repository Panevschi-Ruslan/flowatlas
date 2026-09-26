# Coverage: measuring the tool against real repositories

Every other number in this repository is measured against a fixture somebody
here wrote. A fixture is a controlled experiment and it is worth exactly what
the person who wrote it knew to put in it — which is why twenty-five defects in
this tool were found by reading eight repositories nobody here wrote, by hand,
and not one of those readings could be repeated.

This is that measurement, made repeatable.

```sh
pnpm coverage                      # every target, from fresh clones
pnpm coverage --target immich      # one of them
pnpm coverage:deps                 # again, with dependencies installed
pnpm coverage:render               # re-write the reports from the cache
pnpm coverage:pin                  # move the pins to today's commits
```

`coverage:render` is for changing the counting rule or the wording of a report.
It counts ground truth again over the clones already in the cache and re-writes
every report from the measurement kept beside each build. Nothing is cloned,
installed or built, so it takes a second instead of an hour.

**It is not part of `pnpm check`.** It clones the internet and takes minutes.
Run it deliberately: before a release, and after any change to a reader. Then
read the diff.

---

## What it measures, and against what

Eight repositories, listed in [`scripts/coverage/targets.json`](../scripts/coverage/targets.json),
each pinned at a commit. A number without a commit means nothing next month, so
the commit is in the list and in every report.

| target | read | what it is for |
|---|---|---|
| `immich-app/immich` | `server` | NestJS at scale, Kysely, an in-house bus |
| `novuhq/novu` | `apps/api` | NestJS, versioning, deep-subpath imports |
| `outline/outline` | whole repository | Koa, React, socket.io and Sequelize in one |
| `medusajs/medusa` | `packages/medusa` | a file-system router with no reader |
| `calcom/cal.com` | `apps/web` | Next.js in a monorepo, tRPC, wrapped Prisma |
| `payloadcms/payload` | whole repository | Next.js, nested application roots |
| `Chocobozzz/PeerTube` | `server`, `client` | Angular **and** Express in one repository |
| `excalidraw/excalidraw` | whole repository | a repository with no server |

Nothing in that list says how a repository should be read. Each entry names
directories, and `flowatlas link` decides the type of each one by reading its
manifest, exactly as it would for anybody else. A target cannot be made to look
better by writing a cleverer configuration for it, because there is no place to
write one.

## The two states, and why both

A **fresh clone** has no `node_modules`. The checker resolves almost nothing
outside the repository, and that is what a stranger gets when they clone your
project and run this tool on it. It is a real question and the tool should
answer it well.

**With dependencies installed** the checker can follow a type into a package,
and the answers differ a great deal. Each state gets its own committed report —
`immich.md` and `immich.with-deps.md` — so neither hides behind the other.

Dependencies are installed with `--ignore-scripts`. Running eight strangers'
postinstall hooks on a developer's machine is not worth a coverage number, and
what an install is needed for here is resolvable types rather than generated
artefacts. Where that costs something real — a Prisma client that is generated
by a postinstall hook and is therefore not there — the report says so, instead
of quietly filing it as a limit of the tool.

## Ground truth, by one rule

Four agents measured these repositories by hand and four counting methods came
back. A denominator that depends on who held the pen is not a denominator.

The rule is written once, in prose, beside the code that implements it:
[`scripts/coverage/counting-rule.mjs`](../scripts/coverage/counting-rule.mjs).
In short: ground truth is the number of **declaration sites** that a fixed set
of textual probes finds in the files a repository tracks in git, under the
directory being read, excluding tests and build output. Every probe runs against
every repository. A probe that does not apply returns zero, and that zero is
part of the answer rather than a gap in it.

Nothing is switched on or off per target. No probe was added because one
repository needed a number to come out right. A probe that is wrong is wrong
everywhere at once, which is the property the hand measurements did not have.
Every report prints the per-probe counts, so a figure that looks wrong can be
checked against the pattern that produced it in one step.

## The numbers, and why these ones

A route is at three different numbers and only two of them are coverage:

| | means |
|---|---|
| **discovered** | the tool placed an entry point at an address |
| **with a body attached** | it also found the handler the framework will run |
| **whose body reaches anything** | that handler goes on to call, query, request, publish, cache or read a setting |

`cal.com` finds all eighty-four of its routes and reads the code behind about
half. A report that printed only the first number would call that full coverage.

The rest of a report is the same shape: requests **found** beside requests
**joined**, channels beside channels with both ends, query sites beside query
sites that name a table, and the unresolved rows grouped by reason and level.

Node and edge totals are deliberately absent. They move whenever any reader
learns to record one more thing, which would make every report in the directory
a diff with no news in it.

## Reading it as a diff

The reports are committed so that an improvement is reviewable. They are written
for that:

- no timestamp, and no run-to-run identifiers;
- rows ordered by name, never by size, so one row growing does not reorder a
  table and mark every line as changed;
- wall clock and peak memory printed as bands rather than figures. Two
  consecutive runs over the same eight commits produced identical coverage
  everywhere and still moved two lines, one because a build shared the machine
  and one because a reader peaked a hundred and twenty megabytes higher. The
  figures worth having are "seconds or minutes" and "one gigabyte or four", and
  a band says that much and no more.

A reader should be able to look at the diff of a coverage run and see the one
thing that moved.

## Failing is data

Two of the eight targets do not finish, and the harness records that as the
result of the measurement — the exit code, and what the tool said — rather than
as an error of its own. It never skips a target for failing.

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
re-measuring at once produces a diff in which nobody can tell which numbers
moved because the tool changed and which moved because somebody else's
repository did.
