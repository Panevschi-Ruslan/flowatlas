# graphql-codegen-helpers fixture

A NestJS server serving two GraphQL schemas, the second by default for a
resolver with no scope as a patch the repository commits to its GraphQL
library says, and two front ends sending operations whose `…Document`
constants GraphQL codegen generates into a module nobody commits (P275).

- `web` lists its documents in `gql-codegen.yml`, which its scripts name; its
  operations go through helpers of its own (`runQuery({ query })`,
  `runMutation(doc)`, a subscription taking `{ query }` apart, a search handed
  the client), and its client's address is rooted at a key of the settings
  object the page is served with (`window._env_?.SERVER_URL`).
- `admin` has no codegen configuration: every `.graphql` file of the package
  is its documents, an operation named `ToggleSMTP` is `ToggleSmtpDocument`,
  and a document no file holds is a row.
- `api`'s `PreferencesResolver` has no scope; the patch under `api/patches`
  gives it the settings schema at `/settings`.
