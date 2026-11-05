# The files flowatlas writes

Everything is written under the configuration's output directory, `.flowatlas`
by default, and nothing is written into a repository it reads. The JSON files a
script or another tool may build on have a published JSON Schema in
[`schema/`](../schema), generated from the schemas the tool itself reads them
with, so a schema cannot drift from the reader. A file's version moves when its
shape does, and the schema's name carries the version.

| File | What it is | Version | Schema |
|---|---|---|---|
| `project-graph.json` | the whole graph: nodes, edges, types, what could not be read | `schemaVersion` | [`project-graph.v6`](../schema/project-graph.v6.schema.json) |
| `services/<name>/graph.json` | one service's own graph, before it was joined | `schemaVersion` | [`repo-graph.v6`](../schema/repo-graph.v6.schema.json) |
| `graph.db` | the same graph as SQLite, which every question reads | `schemaVersion` | — |
| `link-report.json` | what joined and what did not | — | — |
| `diff.json` | what `flowatlas diff` found | `diffFormatVersion` | [`diff.v5`](../schema/diff.v5.schema.json) |
| `diff-comment.json` | the figures of `diff --format comment` | — | — |
| `docs.json` | the doc blocks and mentions `flowatlas docs` read | `docsFormatVersion` | [`docs.v2`](../schema/docs.v2.schema.json) |
| `freshness.json` | each service's checkout and every file a build read, for answers to say when the code moved | `freshnessFormatVersion` | [`freshness.v1`](../schema/freshness.v1.schema.json) |
| `names.json` | the names the search hook can say something about | `namesFormatVersion` | — |
| `observed.json` | what traffic was seen, from `flowatlas observe` | `observedFormatVersion` | — |
| `cache.json`, `stand-ins.json` | what the next build compares against | — | — |
| `pulled/` | the team's graph, from `flowatlas pull` | the bundle's manifest | — |
| `export/<kind>/` | `flowatlas export` | — | — |

The schemas' `$id` is the file's address in this repository's main branch. A
validator for draft 2020-12 reads them (Ajv's `ajv/dist/2020`, for one).

## The graph in other tools

`flowatlas export dot | graphml | cypher | csv` writes the graph in the formats
graph tools read ([CLI](CLI.md#flowatlas-export-backstagestructurizr)). Loading
them:

```sh
dot -Tsvg .flowatlas/export/dot/graph.service.dot > services.svg
cypher-shell -f .flowatlas/export/cypher/graph.node.cypher
neo4j-admin database import full --nodes=.flowatlas/export/csv/nodes.node.csv --relationships=.flowatlas/export/csv/edges.node.csv
```

Every edge carries how sure the graph is of it: `confidence` in GraphML, Cypher
and CSV, and the line style in DOT (dashed for a best guess, dotted for an
annotation, bold where traffic was seen). The Cypher is `MERGE` throughout, so
running it again after a rebuild updates and never duplicates; it removes
nothing, so load it into an empty database for an exact copy.
