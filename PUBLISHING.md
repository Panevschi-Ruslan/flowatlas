# Releasing

A runbook for the first release. Everything mechanical is already done; what is
left is two accounts and one decision.

## What is already prepared

All eleven packages carry a licence, description, repository, keywords, `engines`
and `publishConfig: {"access": "public"}`, sit at `0.1.0`, and are no longer
private. `workspace:*` dependencies are rewritten to real version ranges by pnpm
at publish time, so nothing needs changing by hand.

Both names were free on npm as of writing: `flowatlas` and the `@flowatlas` scope.
Check again before you count on them.

---

## Step 1: what actually goes out

Two packages.

| Package | Why somebody installs it |
|---|---|
| `flowatlas` | the command. One install, and it works anywhere |
| `@flowatlas/markers` | imported into your own code, for `@CallsService` and the rest |

The other nine `@flowatlas/*` packages are how the source is organised, not
something anybody should install. They are compiled into the command by
`scripts/bundle.mjs` and marked `private`, so a publish cannot send them by
accident.

That was a real decision and it went the other way first. Publishing all eleven
would have made every export of nine internal packages a promise to somebody,
and the first time a function moved between `core` and `linker` it would have
been a breaking change for a package nobody was meant to import.

**Everything it needs is a plain dependency, and that is deliberate.**

About 15 MB of the install is the graph server's transport library and the
Angular template parser. Both could be optional, and the saving is real. They are
not, because the person installing this cannot be expected to know which parts of
their own stack the tool needs before it has read their stack. A tool that
answers `flowatlas mcp` with "install something else first" is a worse tool than
one that is 15 MB larger, and `npx @flowatlas/cli` has to work on the first try with no
arguments at all.

If that ever becomes worth tuning, the place to do it is from what the project
already has: the configuration knows which repositories exist and each one's
manifest says whether there is an Angular app in it. That is a decision the tool
can make on somebody's behalf, rather than a question it asks them. Recorded in the internal notes.

`flowatlas` is unscoped, so no npm organisation is needed. `@flowatlas/markers` is
scoped because it is the one thing a person imports in their own source, and the
scope says where it came from. If the `@flowatlas` scope is taken by the time you
publish, the markers can be `flowatlas-markers` with no other change.

## Step 2: your name on it

Each `package.json` carries:

```json
"author": "Ruslan Panevschi"
```

npm accepts a string or an object. The object form is worth using if you want
your profile linked from the package page:

```json
"author": {
  "name": "Ruslan Panevschi",
  "url": "https://github.com/Panevschi-Ruslan"
}
```

You can add `"email"` as a third field. Do that only if you want the address
public: npm shows it on the package page and it is scraped. A profile URL gives
people a way to reach you without it.

To change it everywhere at once:

```sh
node -e '
const { readFileSync, writeFileSync, globSync } = require("node:fs");
const author = { name: "Ruslan Panevschi", url: "https://github.com/Panevschi-Ruslan" };
for (const path of globSync("packages/*/package.json")) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.author = author;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
}
'
```

The `LICENSE` at the root names you as the copyright holder, with the year.
Check both read the way you want before anything is public.

## Step 3: the gates, all five

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
arrives in and the only one that proves the order is right. It takes about
forty-five seconds. The `check` workflow in `.github/workflows/` does exactly
that on every push.

`fixtures:run` exists because a snapshot nobody compares is not a gate: a fixture
that has not been run is validated against the schema and then skipped. `clean`
exists because the compiler will otherwise read the state file it left last time,
report that nothing needs doing, and let every gate after it read output the
current sources could not produce. That happened once, on a merge that added a
package.

One thing to know when a merge adds a package: `pnpm install` may leave the new
workspace link uncreated, and only `pnpm install --force` makes it. The symptom
is a module that cannot be found from a package that declares it.

## Step 4: check what would actually ship

`files` in each `package.json` limits the tarball to `dist`, plus `bin` where
there is one. Look at what that comes to before it is public:

```sh
cd packages/cli && pnpm pack --pack-destination /tmp
```

Five files, and that is the whole command: `bin/flowatlas.js`, `dist/index.js`,
`dist/visualise/page.html` for `flowatlas visualise`, and the manifest. About
200 kB packed.

Use `pnpm pack`, not `npm pack`: pnpm rewrites the `workspace:*` ranges and npm
cannot read them. The stronger check is to install the tarball into an empty
directory and read a repository with it, which is what step 7 does.

## Step 5: GitHub

```sh
gh repo create flowatlas --private --source=. --remote=origin
git push -u origin main
```

Private first is the safer order: you can read the repository as a stranger sees
it before anyone else can. Make it public when you are ready.

The README points at `github.com/Panevschi-Ruslan/flowatlas`. If it lands
elsewhere, change the `repository`, `homepage` and `bugs` fields in every
`package.json` and the links in the README.

`.github/workflows/check.yml` already runs `pnpm check` on every push and pull
request, from a clean checkout. Add a description and topics on the repository
itself before it goes public, since that is what people see before they open
anything.

## Step 6: npm

```sh
npm login
npm whoami                                 # confirm the account you think you are
pnpm -r publish --access public --dry-run
pnpm -r publish --access public
```

The dry run prints every package and version without sending anything. Read it.

Eleven packages go up together. Only two are things a person installs directly:

| Package | Why someone installs it |
|---|---|
| `flowatlas` | the `flowatlas` command. Everything else arrives as its dependency |
| `@flowatlas/markers` | imported into their own code, for `@CallsService` |

`@flowatlas/mcp` also ships a `flowatlas-mcp` binary, but `flowatlas mcp` reaches the
same server, so most people will never install it on its own.

## Step 7: prove the published thing works

Install it as a stranger would, from a directory that is not this one:

```sh
cd $(mktemp -d)
npm install -g @flowatlas/cli
flowatlas --version
flowatlas link /path/to/repo-a /path/to/repo-b
flowatlas build
flowatlas stats
flowatlas visualise && open graph.html
```

That catches the two things a workspace hides: a dependency that was only ever
resolved through the monorepo, and a file that was never added to `files`.

## Step 8: tag it

```sh
git tag -a v0.1.0 -m "First release"
git push origin v0.1.0
```

---

## Versioning after this

One version across the workspace, bumped together, even though only two
packages leave it. The command carries the other nine inside it, so their
version is whatever it was built from.

The schema has its own version, `SCHEMA_VERSION` in
`packages/core/src/schema/version.ts`, checked at every read. A database built by
another version is refused with a message saying to rebuild, rather than half
read. Bump it whenever a node type, edge type or required field changes, and
regenerate every snapshot in the same commit.

For each release: run step 3, bump the ten `version` fields together, publish,
tag.

---

## What a first user will ask

Two answers worth having ready, both already in the README.

**"Why are some calls unjoined?"** Because their address is not written down
anywhere the tool can read it: built entirely at run time, or assembled by a
helper whose tail depends on something only the caller knows. They are reported
with a reason rather than guessed at, which is the design. `flowatlas stats` counts
them and `flowatlas dead` explains them. On the project this was built against it
is 31 of 354 requests from a browser.

**"Why is my route reported as unreachable?"** Because nothing the tool can read
reaches it, and every such row says so and says it might be wrong. A public API
with no caller inside the project is the common case.
