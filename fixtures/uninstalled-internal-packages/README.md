# uninstalled-internal-packages fixture

What stands in for a package that is not installed (P78). Nothing is installed
in any repository here; only the framework's own packages resolve, through the
built-in shapes. `loans-api`, a lending library's API, imports three internal
packages:

- `@acme/money` (`Money`, `formatAmount`) is the `name` in `money-lib`'s
  `package.json`, and `money-lib` is a configured service. The import resolves
  to its source - `main` names a `dist/` nobody built, so `src/index.ts` - at
  the path an install would have, so nothing of it becomes a node of
  `loans-api`. The row `package-from-repo` says which repository answered, and
  `package-version-differs` that `loans-api` asks for `^2.0.0` while the
  source is `1.4.0`.
- `@acme/queue-client` is declared by `flowatlas-shapes/acme-queue-client.d.ts`,
  listed under `shapes`. `QueueClient.publish(topic: string, body: unknown)`
  types the publish, which the configuration describes as a producer of the
  `loan-bus`: the producer and its channel are drawn, and the two edges say
  `because: ["shape-file"]`, `typedBy: "@acme/queue-client"`, at `heuristic`.
  `connect()` is a call the shape answers, so it is no longer a place the
  reader could not follow.
- `@acme/feature-flags` has neither, and stays `module-not-installed`:
  `flowatlas shapes --suggest` lists it with `FlagClient` (constructed,
  `variant()` read off it) and `isOn` (called).

`money-lib-copy` carries the same package name as `money-lib`. It is not a
configured service, so it is a directory under the configuration, the weaker
tier, and the configured repository wins. A configuration that names both as
services makes the name ambiguous: neither is read, and the import is a
`package-source-ambiguous` row (`stand-ins.test.ts`).
