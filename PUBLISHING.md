# Releasing

How a release goes out. The one-time setup is done (see the end), so what is
left each time is a version, a changelog entry, the gates, and the publish
itself, in that order.

## What ships

Two packages, and only two.

| Package | Why somebody installs it |
|---|---|
| `@flowatlas/cli` | the command, `flowatlas`. One install, and it works anywhere |
| `@flowatlas/markers` | imported into your own code, for `@CallsService` and the rest |

They are versioned separately, because they change for different reasons: the
command moves with nearly every release, and the markers move only when an
annotation changes what it takes. At the time of writing `@flowatlas/cli` is at
0.5.0 and `@flowatlas/markers` at 0.2.0. `CHANGELOG.md` names the package when
only one of them moved.

The other nine `@flowatlas/*` packages are how the source is organised, not
something anybody should install. They are compiled into the command by
`scripts/bundle.mjs` and marked `private`, so a publish cannot send them by
accident. Their own `version` fields do not move and mean nothing outside this
repository; the version a person sees is the command's.

That was a real decision and it went the other way first. Publishing all eleven
would have made every export of nine internal packages a promise to somebody,
and the first time a function moved between `core` and `linker` it would have
been a breaking change for a package nobody was meant to import.

**Everything the command needs is a plain dependency, and that is deliberate.**

A large share of the install is two libraries: the graph server's transport
library and the Angular template parser. Both could be optional, and the saving
would be real. They are not, because the person installing this cannot be
expected to know which parts of their own stack the tool needs before it has
read their stack. A tool that answers `flowatlas mcp` with "install something
else first" is a worse tool than a larger one, and `npx @flowatlas/cli` has to
work on the first try with no arguments at all.

If that ever becomes worth tuning, the place to do it is from what the project
already has: the configuration knows which repositories exist and each one's
manifest says whether there is an Angular app in it. That is a decision the tool
can make on somebody's behalf, rather than a question it asks them.

## pnpm

The workspace is pnpm, pinned by `packageManager` in the root `package.json`
(`pnpm@10.30.3`). It has to be pnpm, not npm, for anything that installs,
packs or publishes: the packages depend on each other through `workspace:*`
ranges, which pnpm rewrites to real versions and npm cannot read.

Node 25 no longer bundles Corepack, so on a machine whose default Node is 25
`pnpm` may simply not be there. Any one of these fixes it:

```sh
nvm use 24                          # a Node that still ships Corepack
npm install -g pnpm@10.30.3         # the pinned version, installed directly
npm install -g corepack && corepack enable
```

With Corepack, the version in `packageManager` is the one that runs. If you
install pnpm directly, install the pinned version rather than the newest, so the
lockfile is read the way it was written. The `check` workflow gets its pnpm
from the same field.

## The gates

Nothing ships that has not passed these.

```sh
pnpm install
pnpm check
```

`check` runs them in the one order that works and stops at the first failure, so
its exit code is the whole answer. Read it, do not read the output: a gate that
prints a lot of green and still fails is exactly the trap this exists to close.

The order matters and is not obvious. The tests and the snapshot gate both read
graphs the tool generates, which are therefore not committed, so the build and
`fixtures:run` come before them. Run this on a fresh clone every so often, with
no `dist` and no `.flowatlas` anywhere, since that is the state a contributor
arrives in and the only one that proves the order is right. The `check`
workflow in `.github/workflows/` does exactly that on every push and pull
request.

`fixtures:run` exists because a snapshot nobody compares is not a gate: a fixture
that has not been run is validated against the schema and then skipped. `clean`
exists because the compiler will otherwise read the state file it left last time,
report that nothing needs doing, and let every gate after it read output the
current sources could not produce. That happened once, on a merge that added a
package.

One thing to know when a merge adds a package: `pnpm install` may leave the new
workspace link uncreated, and only `pnpm install --force` makes it. The symptom
is a module that cannot be found from a package that declares it.

## Releasing the command

In this order. Each step is there because skipping it has a cost that only
shows up later.

**1. Bump the version.** Change `version` in `packages/cli/package.json`, and
nothing else's. `flowatlas --version` reads it from that manifest at run time,
so it is the one place the version is written.

**2. Write the changelog entry.** In `CHANGELOG.md`:

- turn the `## [Unreleased][unreleased]` section into `## [x.y.z][] - YYYY-MM-DD`,
  and leave an empty Unreleased heading above it for the next one;
- add a line under the heading saying which package moved, for example
  "`@flowatlas/cli` only; `@flowatlas/markers` is unchanged at 0.2.0.";
- add the `[x.y.z]:` compare link at the bottom, from the previous tag to
  `vx.y.z`;
- repoint `[unreleased]` so it compares from `vx.y.z` to `HEAD`.

If `SCHEMA_VERSION` moved in this release, say so in the entry and tell people
upgrading to run `flowatlas build` once: a database built by the previous
version is refused, and the message is less surprising if they read it here
first.

**3. Regenerate the snapshot that records the version.** One CLI snapshot
records the tool's version: `flowatlasVersion` in
`fixtures/multi-repo-doctor/expected.doctor.json`. The snapshots read built
graphs, so build and run the fixtures first:

```sh
pnpm -r build
pnpm fixtures:run
node scripts/cli-snapshots.mjs --update
git status
```

Then check that nothing else moved. The version bump should change that one
field and no other snapshot; anything more is a change to the tool's output that
belongs to some other commit and should be read before it is accepted.

**4. Run the gates.** `pnpm install && pnpm check`, and read the exit code.

**5. Look at what would actually ship.** `files` in `packages/cli/package.json`
limits the tarball to `dist`, `bin` and the README; packing adds the manifest
and the licence. Look at what that comes to before it is public:

```sh
out="$(mktemp -d)"
(cd packages/cli && pnpm pack --pack-destination "$out")
```

About eleven files and about 330 kB packed: `bin/flowatlas.js`,
`dist/index.js`, the chunks under `dist/chunks/` that the bundle is split into,
`dist/visualise/page.html` for `flowatlas visualise`, the README, the licence
and the manifest. The split is deliberate: the graph server is its own chunk,
loaded by `flowatlas mcp` and by nothing else, so `flowatlas --version` does not
read it.

Then install that tarball as a stranger would, into an empty directory, with
npm:

```sh
cd "$(mktemp -d)"
npm install "$out"/flowatlas-cli-x.y.z.tgz
npx flowatlas --version
```

That catches the two things a workspace hides: a dependency that was only ever
resolved through the monorepo, and a file that was never added to `files`.

**6. Land it on `main`.** Merge the release commit, and wait for the `check`
workflow and the GitHub Pages build to go green. The package is published from
`main` and the tag is made on it, so what goes out should be exactly what CI
passed. pnpm also refuses to publish from a dirty tree or from a branch other
than `main`, and that check is worth keeping rather than overriding.

**7. Publish, from the repository root.**

```sh
npm whoami                  # confirm the account you think you are
pnpm --filter @flowatlas/cli publish --access public --dry-run
pnpm --filter @flowatlas/cli publish --access public
```

The dry run prints the package, the version and the files without sending
anything. Read it. It must be `pnpm publish`, not `npm publish`: pnpm rewrites
the workspace ranges in the manifest it uploads, and npm would upload them as
written. Do the same with `--filter @flowatlas/markers` only when the markers
changed.

**8. Wait for the registry, then check it.** npm may ask you to approve the
publish in a browser. It then accepts the upload with "Your package is being
processed…", and the new version appears on the registry a few minutes later,
so an immediate `npm view` still shows the old `latest`. That is not a failed
publish. After a few minutes:

```sh
npm view @flowatlas/cli dist-tags
cd "$(mktemp -d)"
npm install -g @flowatlas/cli@x.y.z && flowatlas --version
```

Install the exact version rather than `latest`, so a registry that has not caught
up yet cannot hand you the previous one and let the check pass.

**9. Tag it.**

```sh
git tag -a vX.Y.Z -m "X.Y.Z"
git push origin vX.Y.Z
```

The tag is what the changelog's compare links point at, so a release without one
leaves a broken link at the bottom of `CHANGELOG.md`.

## Releasing the markers

The same steps, on `packages/markers`: bump its `version`, write a changelog
entry that names it, run the gates, pack it and look at the tarball, land it,
and publish with `--filter @flowatlas/markers`. No snapshot records the
markers' version, so there is nothing to regenerate. When both packages move in one release, the changelog entry says so and names
both versions.

## The schema version

The graph has its own version, `SCHEMA_VERSION` in
`packages/core/src/schema/version.ts`, and it is independent of either package's.
It is checked wherever a graph is read: a graph or a database built by another
version is refused with a message saying to rebuild, rather than half read.

Bump it whenever a node type, edge type or required field changes, and
regenerate every snapshot in the same commit. `pnpm invariants` holds that: I11
fails when a fixture snapshot carries a schema version other than the one the
core declares. A release that carries a schema bump says so in its changelog
entry, as in step 2.

## One-time setup, already done

The GitHub repository, the `@flowatlas` scope on npm, and the metadata in every
`package.json` (author, licence, repository, homepage, keywords, `engines` and
`publishConfig`) were set up for the first release and do not need doing again.
If any of them has to change, change it in every package that carries it, and
check the `LICENSE` at the root in the same pass.

## What a first user will ask

Two answers worth having ready, both already in the README.

**"Why are some calls unjoined?"** Because their address is not written down
anywhere the tool can read it: built entirely at run time, or assembled by a
helper whose tail depends on something only the caller knows. They are reported
with a reason rather than guessed at, which is the design. `flowatlas stats`
counts them and `flowatlas dead` explains them. How many there are depends on
how a project builds its addresses, not on the tool, and every one of them says
why it was left unjoined.

**"Why is my route reported as unreachable?"** Because nothing the tool can read
reaches it, and every such row says so and says it might be wrong. A public API
with no caller inside the project is the common case.
