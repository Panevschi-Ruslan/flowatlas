# nest-rendered-mail

A NestJS API that really does run React, in one package of it and nowhere else
(R145). novu's shape in miniature: its API renders e-mail through a template
library built on React, and once React is detected the browser reader used to
read the whole service - so the API's own end-to-end helper, the transport it
hands messages to, and an SDK's provider for other people's applications were all
read as browser code.

The rule: **a file is read as React when React is supplied to the package that
holds it** (`suppliedWith` in `packages/core/src/adapters/manifest.ts`).

| Package | React in its manifest | Supplied? | Why |
|---|---|---|---|
| `apps/api` (the service) | none | no | a service supplies the framework to everything it reaches only when it declares it itself |
| `packages/mail` | `dependencies` | yes | it installs React, so its templates are React it runs |
| `packages/ui` | `peerDependencies` | yes | a peer is supplied by the dependent, and `mail` depends on it and is supplied |
| `packages/sdk` | `peerDependencies` | no | its only dependent is the API, which supplies nothing |
| `packages/relay` | none | no | reached from a supplied package, but a member supplies only itself |

What to watch:

- **In the graph:** `Layout` and `Receipt` in `packages/mail`, and `ButtonLink` in
  `packages/ui`, as `ui_component`.
- **Not in the graph:** any `ui_api_call`, and `SdkProvider`. Before the fix there
  were three UI calls - the e2e helper's `POST /orders` (joined to the API's own
  route, as if a page called it), the SDK's `GET /customers/:param` and the
  relay's `POST /send` - and `SdkProvider` was a component.
- **Still in the graph:** the SDK's and the relay's requests as `http_out`, which is
  what they are and what the server reader always said. Each is now read once.
- **Not read at all:** the e2e helper, `apps/api/src/e2e/helpers.ts`. It was the
  third `http_out` until R157, which settled that a test is not read, and a file
  in a directory named `e2e` is a test's (`isTestFile` in
  `packages/core/src/test-files.ts`, the definition the coverage harness counts
  by too). Its `POST /orders` and its `E2E_API_URL` went with it. The skip is
  not silent: one `test-directory-skipped` row at level `info` names `src/e2e/`
  and its one file, and says how to have it read if it were runtime code.

`react` is still named at arm's length in `build`'s summary: detection is a
different question (R123), and the answer to it - React is in what this service
can import, through `mail` and `sdk` - is still true.
