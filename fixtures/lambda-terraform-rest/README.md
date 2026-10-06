# lambda-terraform-rest fixture

Lambda handlers whose ways in are declared in Terraform: one `aws_lambda_function`
per handler, and a REST API built resource by resource in front of them.

Type-checked, never executed or deployed. `node_modules` holds hand-written
stubs of `@middy/core`, two of its middlewares and `@types/aws-lambda`.

## The shapes

`infra/functions.tf` declares five functions, each packaged from an archive of a
directory, and `infra/api.tf` a REST API whose resources are two levels deep with
a path parameter (`/loans/{loanId}/renewal`).

| Function | Handler | What it exercises | `handles` |
|---|---|---|---|
| `library-dev-create-loan` | `create-loan.handler` | `middy(createLoan).use(jsonBodyParser()).use(httpErrorHandler())` | `createLoan`, with the two middlewares as `guarded_by` in order |
| `library-dev-get-loan` | `get-loan.handler` | an exported arrow function | `handler` |
| `library-dev-renew-loan` | `renew-loan.handler` | a function written inside the chain; its integration spells the invoke address out around the function's ARN | the inline function |
| `library-dev-record-return` | `record-return.handler` | packaged from `dist/returns`, which the tsconfig's `outDir` and `rootDir` map back to `src/returns` | `handler` in `src/returns/record-return.ts` |
| one per reminder channel | `send-reminder.handler` | `for_each` over `var.reminder_channels`, which nothing sets | `handler`, under an entry with no name |

Every route is an `http` entry onto the same handler as its function, with the
authoriser in front of it as a guard: `POST /loans` and `POST /returns` behind
the Cognito authoriser, `POST /loans/:param/renewal` behind `AWS_IAM`, and
`GET /loans/:param` behind nothing.

## What it does not read

The reminder functions are one per element of a list the files leave unset, so
neither how many there are nor their names can be known. That is one
`function-repeated-unread` row naming `var.reminder_channels`; the entry has no
name and its id says so (`${…}@aws_lambda_function.send_reminder[?]`), so
nothing can join to it.
