# nest-addressing

Where a NestJS service's addresses are decided, and what it costs to read the
wrong file (R89).

Two facts decide every route's address here, and neither of them is in
`src/main.ts`:

- **`setGlobalPrefix('api')`**, called from `src/setup.ts`. That is how a
  repository with more than one worker and a test suite shares one copy of its
  configuration, and it is what a photo server does — its prefix is set in
  `app.common.ts`, called from a worker its supervisor forks by path. Reading
  only the entry file recorded all 292 of a photo server's routes without the `/api`
  every one of them answers on.
- **`enableVersioning({ type: URI, prefix: 'v', defaultVersion: '1' })`**, in
  the same helper. Under URI versioning the version is part of the address, and
  A notification service's is: 59 of its entries carried a version in their metadata and not one
  of their paths, keys or ids carried a `/v1`.

So the reader looks for those two calls anywhere in the repository once the entry
file has not made them, and adopts what it finds only when nothing disagrees.
Which application was created is still read from the entry file and nowhere
else — that question has one right answer per entry point and searching for it
picks the wrong one silently.

The four controllers are the four things that go wrong:

- `topics.v1` and `topics.v2` serve the same two paths at two versions. Without
  the version in the address they collapse onto one entry each and the tool
  reports a route claimed by two handlers. On a notification service that was fourteen warnings
  and every one of them false — which is the sharpest thing to test here,
  because a missing version does not merely lose information, it makes two
  different routes look like one.
- `health` names `VERSION_NEUTRAL`, a symbol the framework exports and nothing
  can evaluate. Read as a whole, its options object was unresolved and the
  controller was dropped, with a row claiming somebody had computed its path.
  Read one property at a time, the path beside it is a plain literal.
- `legacy.list` names no version at all and is therefore served at the
  application's default, which is the commonest case and was silently the wrong
  one. `legacy.replay` names two, and two versions is two addresses.
