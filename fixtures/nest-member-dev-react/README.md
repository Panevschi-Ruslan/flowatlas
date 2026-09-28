# nest-member-dev-react

A NestJS API one of whose members declares React as a **devDependency** only
(R145, the second half of R143).

R143 stopped a member's devDependencies from widening a service's *extent*. The
widened manifest every adapter gates on (`readResolvedPackageJson`) still merged
them, so React was detected for this API through `@member-dev-react/mailer`'s
devDependencies, the browser reader ran over the service, and the mailer's
server-side `fetch` was read as a UI call and its test preview as a component.

Both now read a member through one function, `extentDeclared` in
`packages/core/src/workspace.ts`, which applies `EXTENT_SECTIONS`: a member's
devDependencies are never installed for the service, so they neither take a
package into the extent nor switch an adapter on.

What to watch:

- The repository node's `adapters` has no `frontend` entry, and `build` prints no
  arm's-length line.
- No `ui_component` for `Preview`, no `ui_api_call`.
- `POST /send` from `packages/mailer/src/index.ts` is in the graph once, as
  `http_out`.
