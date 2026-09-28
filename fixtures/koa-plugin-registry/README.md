# koa-plugin-registry fixture

A way in registered once, over a collection — which is how a repository mounts a
plugin's routes when the plugins are loaded from disk at start-up.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/koa-plugin-registry/tsconfig.json --noEmit
```

`node_modules` holds hand-written stubs for `koa`, `@koa/router`, `koa-mount`
and `plugin-host`.

## The shape

```ts
PluginManager.getHooks(Hook.API).forEach((hook) => router.use('/', hook.value.routes()));
```

One mount, and it installs as many applications as anything anywhere in the
repository put into that collection. Nothing imports a plugin: the real
`PluginManager` globs `plugins/*/server/index` and requires each match, so the
only statement anywhere about what is in the collection is the `PluginManager.add`
call inside each plugin.

The reader beside this one places a route by following the mount that moved the
application it is declared on, and there was no mount here to follow. Worse than
none: `hook.value` resolves to the *type* the collection is declared with, so the
mount was recorded against a property of an interface, nothing was ever mounted,
and every plugin route kept the address it is written at. On a wiki app that was
`POST /passkeys.list` for what the service serves at `POST /api/passkeys.list` —
7 of 26 browser requests unable to join, and 46 files under `plugins/*/server/api`
producing nothing and saying nothing (R121, from R114).

## What is read

| Site | Read as |
|---|---|
| `passkeys` API router, registered at `value` | `POST /api/passkeys.list`, `POST /api/passkeys.update` |
| `webhooks` router, registered with `add({ … })` rather than `add([{ … }])` | `POST /api/webhooks.create` |
| `passkeys` auth router, registered at `value.router` | `GET /auth/passkey` |
| `documents`, imported and mounted the ordinary way | `POST /api/documents.info` |
| `hostHooks('api')`, a collection a package publishes | one row: the registry and the mount |

`/api` and `/auth` are written in `src/server.ts`, two mounts and a file away
from the routers served under them. The segment was never missing because nobody
wrote it; it was missing because the mount in between was over a collection.

## The two halves of the description

Where the member came from, and what is in it. They are separate questions
because a repository can make either of them unreadable on its own, and the
answers are needed in that order.

**Where it came from** is walked back from the mount's argument to the expression
being iterated, recording the keys read off a member on the way. The keys matter
as much as the collection: this registry holds a router at `value` and a
`{ router, id }` pair at `value.router`, under different kinds, and the path the
mount itself reads is what sends each router to the application that really
installs it. Nothing reads the registry's own `type` key — it does not have to.

**What is in it** is the calls made on the same registry anywhere in the
repository, with their arguments opened out by the same reading of a list that
the declarative middleware list of a file-system router goes through (R91). One
way of following a list, not two.

Three spellings of the iteration are here because all three are in the repository
this is modelled on: `forEach` in `src/routes/api.ts`, and in `src/routes/auth.ts`
a `for…of` over a collection published as a **static getter**, whose member is
**awaited into a name of its own** before it is mounted.

## Where it cannot be followed, a row and not silence

`hostHooks('api')` is a collection a package publishes: its members are
contributed by code that is not in this repository at all, so nothing here can
enumerate them. That gets one row naming the collection and the mount — one row,
not one per member of a list nobody can count — and the routes under it are
missing rather than wrong, which is the distinction this whole family of fixes is
about.
