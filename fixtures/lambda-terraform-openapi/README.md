# lambda-terraform-openapi

A lending library's circulation service with two APIs created from OpenAPI
documents rather than from resources and methods (R174). Every route is read
from the document, with what its `x-amazon-apigateway-integration` names.

Type-checked, never executed or deployed.

## The REST API: `templatefile("openapi.yaml", {...})`

`infra/openapi.yaml` is rendered with the variables `infra/api.tf` hands it. A
variable that is a reference stays the reference, so the integration names the
function or queue even where the account id it is written beside is not known.

| Route (line of `openapi.yaml`) | Integration | Read as |
|---|---|---|
| `POST /loans` | `uri: ${create_loan_invoke_arn}` | onto `create-loan.ts` |
| `GET /loans/{loanId}` | `uri: ${get_loan_invoke_arn}`, `security: librarians` | onto `get-loan.ts`, behind the guard `librarians` |
| `POST /loans/{loanId}/renewals` | an invoke address written around `${renew_loan_arn}` | onto `renew-loan.ts` |
| `POST /returns` | `type: aws`, `sqs:path/${account_id}/${returns_queue}` | a publisher onto `sqs/library-returns`; no function runs |

## The HTTP API: `jsonencode({...})`

The kiosk API's document is built in place in `infra/api.tf`; each route is
placed on the line its path is written on.

| Route | Integration | Read as |
|---|---|---|
| `POST /holds` | `integrationSubtype: SQS-SendMessage`, `QueueUrl = aws_sqs_queue.holds.url` | a publisher onto `sqs/library-hold-requests` |
| `GET /items/{itemId}` | `uri = aws_lambda_function.get_item.invoke_arn` | onto `get-item.ts` |

Both queues are read by event-source mappings, so `flow 'POST /returns'` walks
from the route through the queue into `process-return.ts`. The stages
(`live`, `$default`) are recorded on the routes.

`doctor` has nothing to say: no row.
