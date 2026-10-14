# lambda-terraform-other-ways-in

A lending library's members service: functions run by something other than an
API Gateway route, a rule, a queue or a topic (P53), and an IoT rule whose
actions write a table, start a workflow and fail over to a queue (P56).

Type-checked, never executed or deployed.

| Declared as | Entry | Runs |
|---|---|---|
| `aws_lambda_function_url.card_lookup` | `http:ALL:/*@library-members-card-lookup` | `url/card-lookup.ts` |
| `aws_lb_listener_rule.kiosk_checkout`, forwarding to a `lambda` target group | `http:POST:/kiosk/checkout`, `meta.hosts: ["kiosk.library.example"]` | `kiosk/kiosk.ts` |
| `aws_cognito_user_pool.members`, `pre_sign_up` | `event:cognito/library-members/pre_sign_up` | `accounts/pre-sign-up.ts` |
| the same, `post_confirmation` | `event:cognito/library-members/post_confirmation` | `accounts/post-confirmation.ts` |
| `aws_iot_topic_rule.shelf_weight` | `event:iot/library/shelves/+/weight`, also publishing onto `sqs/library-shelf-readings` | `shelves/shelf-sensor.ts` |
| `aws_lambda_permission.log_digest`, principal `logs.amazonaws.com` | none: one `invoker-not-read` row at `info` | `logs/log-digest.ts` |
| `aws_iot_topic_rule.book_returned`, `dynamodbv2` | `event:iot/library/returns/+/dropped`, publishing onto `dynamodb/library-members-returns`, whose stream runs it | `returns/return-desk.ts` |
| the same, `dynamodb` onto `library-members-drops` | none: the table has no stream, so its write is dropped with its channel, as a write in code is (P51) | |
| the same, `step_functions` | starting `workflow:library-members-restock`, whose task runs it | `returns/restock-shelf.ts` |
| the same, `error_action { sqs }` | a publisher onto `sqs/library-shelf-readings` with `when: "failure"` | |
| the same, `firehose` | none: one `iot-action-not-read` row at `info` | |

The listener's own default action is a fixed response, so it adds no route. The
permission for the user pool is already read from the pool, and says nothing.
