# nest-held-calls

A NestJS service whose work is done by module-level functions: no class, no
provider, and no entry point naming any of them (R156). A notification service's
`apps/api/src/app/agents/management/skills/github-skill-bundle.ts` in miniature,
where `streamTarballToParser` makes the request to GitHub and calls
`assertPublicRepository`, which makes another.

The data-layer reader holds a function that makes a request or reads
configuration, whether or not anything reaches it. The call walk runs before it,
and reads only methods and what an entry point's function reaches, so two held
functions sat in the graph with no call between them. The only reader that drew
those calls was the browser reader, walking server code it had no business
reading, and R145 stopped it.

The rule (`heldCallsPass`, `packages/extractor-nestjs/src/passes/held-calls.ts`):
**a call to a function of this service is drawn when that function leads to
something the graph holds** - it is joined already to a way in or to a leaf (a
request, a query, a cache operation, a setting, a message), or it calls, at any
depth, a function that is. Being a node is not enough: a helper the call walk
followed into from a handler is a node, and holds nothing.

| Caller | Callee | Drawn | Shape |
|---|---|---|---|
| `streamTarball` (makes a request) | `buildGithubHeaders` (holds a config read) | yes | a function calling a held one |
| `SkillsService.hasToken` | `buildGithubHeaders` | yes | a method calling a held function by name |
| `SkillsService.bundle` | `fetchSkillBundle` (holds nothing) | yes | a helper between a method and a held function |
| `fetchSkillBundle` | `streamTarball` | yes | the same helper's own call |
| `isGithubConfigured` (nothing calls it) | `buildGithubHeaders` | yes | an unreached function that reaches a leaf, read as the data-layer reader reads it |
| `SkillsService.bundle` | `repoSlug` | no | a helper that holds nothing and reaches nothing |
| `streamTarball` | `mapGithubError` | no | the same |

Before the fix the graph had `buildGithubHeaders` and `streamTarball` as nodes and
not one call into either.

The request `streamTarball` makes, `GET https://api.github.com/repos/:param/tarball`,
is drawn on `SkillsService.bundle`. Its address is handed in as `slug`, through
`fetchSkillBundle`, by the method that decides it, and a parameter of a module
function is followed out to its callers as a method's is (R175). The slug is
`repoSlug(repository)`, which is not read, and it fills one segment, so it is the
route parameter it was where the request is written.
