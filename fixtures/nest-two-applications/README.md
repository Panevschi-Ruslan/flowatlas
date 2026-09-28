# nest-two-applications

One service, two applications, one address each of them serves (R119).

An address is only an address within an application. This repository creates two
of them — an API and a worker — and they overlap in the way that matters:

- `src/health/health.controller.ts` serves `GET /health` in the API, reached from
  `ApiModule` through an import of `HealthModule`, because membership is
  transitive.
- `src/worker/worker-health.controller.ts` serves `GET /health` in the worker.
  **This is the file that used to disappear.** Its emission landed on the API
  entry's id, `GraphBuilder.addNode` kept the node it already had, and the file
  contributed no node and no row at all. Nothing in any total moved: the count of
  addresses was right, the count of handlers was right, and what was missing was
  a file.
- `src/shared/status.controller.ts` is mounted in both, which is a photo server's shape —
  a controller the application and a maintenance worker both register. It really
  does answer in two places, so it is two entries with one handler each rather
  than one entry with two, which is what lets `routes.duplicated` mean "two
  handlers of one application" and be asserted to zero.

And one route no application can be shown to serve.
`src/legacy/legacy.module.ts` declares its controller through a spread of an array
built in another file, which nothing static resolves, so the module reads as
declaring no controllers at all. That used to be silent and cost only a piece of
metadata; now it decides whether an address can be told from another
application's, so the module's line gets a row and the route's id carries no
application. It is the honest answer rather than a good one — a second
application serving `/legacy` would collide with it exactly as before — and it is
A photo server's real shape, where `controllers: [...controllers]` leaves 292 of its 303
addresses in no application anybody could name.

The two applications are found by walking the repository for `NestFactory`, not
by following calls out of `src/main.ts`: `src/worker/main.ts` is a file nothing
else here imports, because a supervisor starts it by path. Everything after the
roots comes from the module pass, which already reads every `@Module`, its
`imports` and its `controllers`.

Five entries, therefore, where before there were three, and the four that could
be placed carry the application that serves them:

    entry:nest-two-applications@ApiModule:http:GET:/health
    entry:nest-two-applications@ApiModule:http:GET:/status
    entry:nest-two-applications@WorkerModule:http:GET:/health
    entry:nest-two-applications@WorkerModule:http:GET:/status
    entry:nest-two-applications:http:GET:/legacy

No global prefix is set here on purpose. The bootstrap reader still folds one
record per *service*, so a prefix set on one application would be applied to
both; that is a limit this fixture deliberately does not exercise, and naming it
is cheaper than a fixture that asserts the wrong answer.
