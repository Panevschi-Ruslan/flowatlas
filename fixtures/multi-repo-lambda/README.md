# multi-repo-lambda fixture

Three repositories sharing one REST API: two hang their routes from a point of
it the third, a repository of nothing but Terraform, publishes.

Type-checked, never executed or deployed.

## The repositories

| Service | What it is | How its routes find the API |
|---|---|---|
| `platform` | Terraform only, no `package.json`: the API, `/v1`, and one route of its own | owns it; publishes `/v1` as the parameter `/lending-library/api/v1-resource-id` and as the output `v1_resource_id` of its S3 state |
| `loans` | one `package.json` per function directory, each with its own stubs, and code shared between them | `data.terraform_remote_state.platform.outputs.v1_resource_id` |
| `holds` | one `package.json`, handlers packaged from `dist/handlers` | `data.aws_ssm_parameter.v1_resource_id.value`, through `nonsensitive()` |

The linker joins each route to the point it hangs from by that point's name, as a
channel is joined, so every route has its full path: `POST /v1/loans`,
`GET /v1/loans/:param`, `POST /v1/holds`, `DELETE /v1/holds/:param`.

`platform`'s own route, `GET /v1/borrowers/:param/loans`, is integrated with a
function it knows only by name (`data.aws_lambda_function`); the linker gives it
the handler of the `invoke` entry `loans` deploys under that name.

## Environments

`loans` keeps `infra/env/dev.tfvars` and `infra/env/prod.tfvars`, which name its
functions differently, and the configuration chooses `dev` under
`services[].infra.vars`. `holds` keeps two such files and nothing chooses, so its
two functions have no name and two `function-name-disputed` rows say which
variable and which files; their routes still reach their handlers, because a
route names its function by reference rather than by name.
