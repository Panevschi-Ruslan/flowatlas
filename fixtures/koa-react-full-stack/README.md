# koa-react-full-stack fixture

One directory that is honestly both halves: a Koa server under `src/server`, a
React screen under `src/web`, and one `package.json` declaring both.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/koa-react-full-stack/tsconfig.json --noEmit
```

`node_modules` holds the hand-written stubs for `koa` and `@koa/router`.

## What it is for

R88. `guessType` used to answer with the first row of `TYPE_SIGNATURES` whose
dependency a manifest declared, and `react` sat above `koa` for a reason that had
nothing to do with either of them. So a repository shaped like this one — which
is the shape of outline, and of most repositories that ship a browser with the
server it talks to — was offered `react` by `init` and `link`, read by the reader
that opens `.tsx` and nothing else, and came back with its screens, its requests,
and none of the routes those requests reach.

The rule now is that the reader which can read both halves reads a repository
that is both: a server type wins over a browser type, whatever order the rows are
in. Nothing here is specific to Koa or to React; the fixture is one pairing of
the two halves, and `stacks.test.ts` asserts the rule over the others.

## What each reader finds here

| Read as | Routes | Screens | Requests joined to a route |
|---|---|---|---|
| `koa` — the server reader, which also runs the frontend adapters | both | the screen | both |
| `react` — the browser reader | none | the screen | none |

`flowatlas extract` with no configuration reaches the same answer from the other
side, and must: it has no `type` to look up, so it asks the entry adapters
whether there is a server in the directory. There is, so the server reader opens
it and hands the browser half to the frontend adapter that recognised it.
