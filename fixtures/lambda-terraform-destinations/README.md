# lambda-terraform-destinations

A lending library's loans service: a kiosk calling another function through its
function URL, and functions whose results and failures the platform hands on to
destinations (P54). `members` deploys two functions the loans service's
configuration names: a destination, and a function whose destination it sets (P60).

Type-checked, never executed or deployed.

## A function URL's callers

`modules/function-url` declares `aws_lambda_function_url.this` and outputs its
`function_url`; the kiosk is deployed with `CARD_LOOKUP_URL = module.card_lookup_url.url`.
No service claims `CARD_LOOKUP_URL` as its base, so each request rooted at it is
joined through the function that runs it, to the `http:ALL:/*@library-lending-card-lookup`
entry (`meta.via: "functionUrl"`, `meta.variable`). `LOAN_URL` names a second
URL, `aws_lambda_function_url.request_loan` in `main.tf`: every function URL is
`ALL /*`, so each entry's key carries the function it stands in front of, and
the two stay apart.

| Request in `kiosk/kiosk.ts` | Edge |
|---|---|
| `fetch(process.env.CARD_LOOKUP_URL + '/cards')` | `http_calls`, `static`: the path is read |
| `` fetch(`${process.env.CARD_LOOKUP_URL}${extra}`) `` | `http_calls`, `heuristic`: the path is not read |
| `fetch(process.env.LOAN_URL + '/loans', { method: 'POST' })` | `http_calls`, `static`, to `http:ALL:/*@library-lending-request-loan`, behind `AWS_IAM` |

## Destinations

| Declared as | From | Outcome | To |
|---|---|---|---|
| `aws_lambda_function_event_invoke_config.request_loan` | `invoke:library-lending-request-loan` | `success` | `invoke:library-lending-notify-member` |
| the same | the same | `failure` | a publisher onto `sqs/library-loan-failures` |
| `aws_lambda_function_event_invoke_config.return_item` | `invoke:library-lending-return-item` | `success` | a publisher onto `eventbridge/library-events/lambda/Lambda Function Invocation Result - Success`, which the rule `library-returned` takes to `audit-return` |
| the same | the same | `failure` | a publisher onto `sns/library-return-alerts` |
| `aws_lambda_function_event_invoke_config.card_lookup` | `invoke:library-lending-card-lookup` | `failure` | `invoke:library-members-alert` in `members`, named by its ARN and joined by the linker (`via: "deployed-name"`) |
| `aws_lambda_function_event_invoke_config.member_digest` | `invoke:library-members-digest` in `members`, named, joined by the linker into a `result` consumer here (`meta.resultOf`) | `success` | `invoke:library-lending-notify-member` |
| `aws_lambda_event_source_mapping.shelf_scan`, `destination_config.on_failure` | `event:kinesis/library-shelf-scans` | `failure` | a publisher onto `sns/library-return-alerts` |

Every edge out of the run is `triggers`, with `meta.when` saying which outcome
it carries.

`doctor` has one row: `stream-no-writer` at `info`, for the Kinesis stream
nothing in the project writes to.
