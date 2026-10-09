# lambda-terraform-modules fixture

The same kind of service declared through modules: one of the repository's own,
the public `terraform-aws-modules/lambda/aws` and `terraform-aws-modules/apigateway-v2/aws`,
and a module from another repository that the configuration describes.

Type-checked, never executed or deployed. The configuration at the root is the
project; the repository is the fixture itself.

## The shapes

| Declared through | Function or route | Read because |
|---|---|---|
| `./modules/function` | `catalogue-get-title` | a local module is read with its inputs bound |
| `terraform-aws-modules/lambda/aws` | `catalogue-search-titles`, `catalogue-register-borrower`, `catalogue-get-borrower` | its description ships with the tool; `source_path` is read as a path and as a list of objects |
| `terraform-aws-modules/apigateway-v2/aws` | `GET /titles/:param`, `GET /titles`, `POST /borrowers` | its description ships with the tool; the `routes` map is expanded because its keys are written out |
| `git::https://git.example.com/library-platform/terraform-api-route.git` | `GET /borrowers/:param` | described under `adapters.infra.modules` in `flowatlas.config.json` |

`catalogue-register-borrower` is wrapped in `middy`, and its route carries the
same middleware as the function, behind the `AWS_IAM` authoriser the HTTP API
route names.

## What it does not read

`module.newsletter` comes from another repository and nothing describes it. It is
one `infra-module-undescribed` row naming the module, its source and the inputs
it was given (`function_name`, `handler`, `source_dir`, `schedule`), with the
description to write; nothing it declares is in the graph.
