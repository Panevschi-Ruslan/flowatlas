# nest-query-loop fixture

Exercises P69: a call in a loop, and calls side by side.

| Call site | What the graph says |
|---|---|
| `findOne` in a `for-of` body (`byIdsOneByOne`) | `meta.inLoop: { kind: "for-of" }`, a `query-in-loop` row |
| `findOne` in `ids.map(...)` inside `Promise.all` (`byIdsTogether`) | `meta.inLoop: { kind: "map" }`, `meta.concurrent: true`, a `query-in-loop` row |
| `find` and `findOne` in one `Promise.all([...])` (`summary`) | both `meta.concurrent: true`, no row |
| `find` in the list a `for-of` walks (`totals`) | nothing: read once, before the loop |
| `saveOne` called in a `for` body (`saveAll`) | the call edge has `meta.inLoop`, a row with `meta.via` naming `saveOne` |
| `delete` in an arrow pushed from a loop (`later`) | nothing: the arrow runs when it is called |

Type-checked, never executed. `node_modules/typeorm` is the same hand-written stub
`nest-typeorm` uses.
