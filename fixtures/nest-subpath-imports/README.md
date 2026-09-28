# nest-subpath-imports fixture

Three Nest controllers whose decorators arrive by three different routes, and one
reader that used to read only the first of them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/nest-subpath-imports/tsconfig.json --noEmit
```

There are no stubs under `node_modules`, deliberately: this is the state a fresh
clone is in, where the checker can resolve nothing outside the repository and the
import statement is the only evidence of where a decorator came from. It is also
the state the coverage harness measures a notification service in.

## What each controller is for

| File | How the decorators arrive | Read as |
|---|---|---|
| `health/health.controller.ts` | every one from `@nestjs/common/decorators` | three routes under `/health-check` |
| `reports/reports.controller.ts` | `@Controller` from the package, the verb from a subpath and under an alias | `GET /reports/daily` |
| `legacy/legacy.controller.ts` | through `framework/nest.ts`, a barrel of this repository | no route, and one row naming the class |

## What was wrong (R84)

The module specifier was matched exactly, so `@nestjs/common/decorators` was not
`@nestjs/common`. A controller written that way carried no `@Controller` as far as
the reader could see, and the loop reached a `continue` before anything was
written down. Everything else about the file was read normally — the class, the
methods, the providers it injects — so the output showed a controller with no
routes and nothing anywhere said a route had been dropped. On a notification service that was 21
routes in 3 files.

The alias is the same failure one level down: the table of verbs is keyed by the
names Nest exports, and `import { Get as HttpGet }` is not one of them.

## What the row is for

`LegacyController` cannot be read, and that is honest rather than fixable here:
the symbol behind its `@Controller` is the import specifier in its own file,
which names a module of this repository. The decorator is Nest's, re-exported —
or it is a local decorator that happens to share the name, and nothing here can
tell which. Both readings matter to whoever is looking at the graph, so the class
is named and the module is quoted, at `info`, and the reader decides.
