# One graph for the team

Building the graph needs every repository checked out, and ideally installed.
Most people have one checkout: a front-end developer has `web`, a new hire has
whatever they were told to clone, and an assistant runs wherever its person is.
The question flowatlas exists for - who calls this, in the repositories I do not
have - is the one they cannot ask.

CI has every checkout already. So CI builds the graph on the main branch and
writes it as one file, and anybody can pull that file and ask the whole project
from a checkout of one repository, or of none. Nothing is hosted: the file is
kept where the team's code is, and the tool never uploads anything.

## In CI: publish

On every push to the main branch, with the action:

```yaml
on:
  push:
    branches: [main]
jobs:
  graph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Panevschi-Ruslan/flowatlas/action@v0.7.0
        with:
          publish: true
          repositories: |
            orders=acme/orders
            billing=acme/billing
          token: ${{ secrets.FLOWATLAS_READ_TOKEN }}
```

It clones the other repositories, runs `flowatlas build` and `flowatlas
publish`, and uploads the bundle as the artifact `flowatlas-graph`, kept 30
days (`retention-days`); a run on every push keeps a fresh one. Without the
action, the same is two commands and whatever upload step the workflow uses:

```sh
flowatlas build
flowatlas publish --output flowatlas-graph.tgz
```

## Anywhere: pull

The configuration names where the team's graph is:

```json
{
  "services": [ … ],
  "remote": { "url": "gh:acme/shop/flowatlas-graph" }
}
```

```sh
flowatlas pull
```

With a `remote`, a service whose repository is not checked out here is not an
error: its graph is the team's. The questions - every command, the page and the
graph server - read the pulled graph when no graph was built here, and say so:
`start_here` says `pulled`, with where it came from and when it was built, and
`get_source` on a service that is not checked out says that instead of failing.

A second `pull` with nothing new is one conditional request and installs
nothing; `--force` pulls anyway. `"mcp": { "pull": "on-start" }` has the graph
server pull when it starts, and a failed pull never stops the server.

## Your branch against everyone's main

```sh
flowatlas build --on-pulled     # read what is checked out here, take the rest from the team's
flowatlas diff --pulled         # what this branch does to the project as main has it
```

`--on-pulled` reads the repositories checked out here, as an ordinary build
does, and takes every other one's own graph from the bundle, so a request from
your `web` joins the `orders` route CI read. `diff --pulled` compares your
working tree with the pulled graph: the base is read, not built, so the
comparison costs one build of what you have.

A checkout here that is on another commit than CI built says so, as any
checkout does (`checkout-moved`), and an answer citing a file of yours that
changed since says `stale`. A service that is not checked out is neither: there
is nothing here to compare it with.

## Where the bundle comes from

| `remote.url` | Reads |
|---|---|
| `gh:owner/repo/name` | the newest artifact of that name from a run that a push to the repository's default branch started and that succeeded, through the GitHub API, with `GITHUB_TOKEN`, `GH_TOKEN` or the `gh` command's own login; it downloads as a zip, and the bundle inside is used |
| `https://…` | any address, a release asset or an object store; with `remote.tokenEnv` naming a variable, its token is sent as `Authorization: Bearer`, and never to another origin (scheme, host and port) after a redirect |
| a path or `file:` | a file, on a shared disk or downloaded by hand |

`http://` is refused except on this machine, and so is a redirect to it.

A `gh:` source reads only the repository's own code: an artifact from a
pull request is never taken, not from a fork's branch that happens to be named
like the default one, and not from a `pull_request_target` run, which reports
the default branch but is started by the request. So the workflow that
uploads the graph has to run on `push`, as the one above does; an artifact from
a run started by hand or on a schedule is not read either.

## What is in it

`graph.db`, `project-graph.json`, `link-report.json`, each service's own graph
(what an overlay takes), `docs.json`, `names.json`, `observed.json` and
`freshness.json` where they were written, a manifest - the bundle's format, the
flowatlas version and graph schema that wrote it, when it was built, and each
service's commit and branch - and the SHA-256 of every file. Never a line of
source: the graph says where everything is, and a checkout is how to read it.

A pull checks every file against its checksum and the manifest against what
this version reads before anything is installed, writes it beside the old one
and moves it into place, so no question is ever asked of half a graph. A graph
from a newer schema is refused with the command that installs the version that
wrote it.

**Who should be able to read it.** The bundle is a map of the code: names,
paths, routes, shapes. Keep it where the code is, readable by whoever can read
the code. A CI artifact in the repository is that by default.
