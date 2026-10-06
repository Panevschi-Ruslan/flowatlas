# lambda-terraform-json

A lending library's catalogue: two Lambda functions behind an HTTP API, deployed
by Terraform written entirely as JSON (`*.tf.json`), the way a generator writes
it. It exists to prove that JSON syntax is read into the same tree as the native
syntax, with a line on every block and argument (R174).

Type-checked, never executed or deployed.

| What | Written as | Read as |
|---|---|---|
| `aws_lambda_function.get_item` | a resource in `functions.tf.json`, its `environment` a nested object and its `lifecycle` a block | `invoke` entry `library-dev-get-item`, `ITEMS_TABLE` naming the table `library-dev-items` |
| `module.add_item` | a call to a local module whose own files are JSON (`modules/function/main.tf.json`) | `invoke` entry `library-dev-add-item`, through the module's inputs |
| `GET /items/{itemId}` | `aws_apigatewayv2_route` with `"${...}"` references | `GET /items/:param`, onto `get-item.ts` |
| `POST /items` | the same, with `authorization_type = AWS_IAM`, integrated with the module's output | `POST /items` behind the guard `AWS_IAM`, onto `add-item.ts` |

Names are built from `local.prefix`, itself built from `var.stage`, whose
default is JSON as written: every name is read. `"//"` at the top of
`main.tf.json` is a comment, as Terraform reads it.

`doctor` has nothing to say: no row.
