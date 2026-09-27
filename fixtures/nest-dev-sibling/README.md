# nest-dev-sibling

A NestJS API whose extent must stop at the line the package manager draws
(R143).

`apps/api` answers `POST /orders`, and the work behind it is one package away in
`@dev-sibling/mailer`, a runtime dependency. The mailer has a devDependency of
its own: `@dev-sibling/preview`, a browser tool for looking at its messages while
they are written, built on React. That is novu's shape in miniature - its API
reached the `novu` command-line tool, and that tool's browser interface, only as
a devDependency of `@novu/notifications`, and gained two hundred UI components
and a React reading it does not run.

What a service's extent takes in, by whose manifest it is:

| Manifest | Sections followed | Why |
|---|---|---|
| the service's own | all four | it is the package being built; its devDependencies are its own build and its own tests, and a bundled application ships code from there |
| a member's | `dependencies`, `peerDependencies`, `optionalDependencies` | a member's devDependencies are installed only when that member is being worked on, never for whoever depends on it |

So what to watch here is what is **not** in the graph: nothing from
`packages/preview` - no `ui_component`, no `ui_action`, no `ui_api_call` - and
no `react` at arm's length in `build`'s summary. Before the fix all of that was
there, and the mailer's server-side `fetch` was read as a UI call too, because
React had been switched on for the whole service.

And what **is** in it, as the two controls:

- `../../packages/mailer/src/index.ts:sendReceipt`, with its setting and its
  outbound request: a runtime member, read as part of the service. The request's
  one row, `unknown-base-url-env`, is true of it.
- `../../packages/e2e/src/index.ts:apiUnderTest` and `E2E_API_URL`: the service's
  **own** devDependency, which stays in its extent. A member's devDependencies and
  the service's own are not the same question, and only the first is answered no.
