# lambda-terraform-other-ways-in

A lending library's members service: six functions, each run by something other
than an API Gateway route, a rule, a queue or a topic (P53).

Type-checked, never executed or deployed.

| Declared as | Entry | Runs |
|---|---|---|
| `aws_lambda_function_url.card_lookup` | `http:ALL:/*` | `url/card-lookup.ts` |
| `aws_lb_listener_rule.kiosk_checkout`, forwarding to a `lambda` target group | `http:POST:/kiosk/checkout`, `meta.hosts: ["kiosk.library.example"]` | `kiosk/kiosk.ts` |
| `aws_cognito_user_pool.members`, `pre_sign_up` | `event:cognito/library-members/pre_sign_up` | `accounts/pre-sign-up.ts` |
| the same, `post_confirmation` | `event:cognito/library-members/post_confirmation` | `accounts/post-confirmation.ts` |
| `aws_iot_topic_rule.shelf_weight` | `event:iot/library/shelves/+/weight`, also publishing onto `sqs/library-shelf-readings` | `shelves/shelf-sensor.ts` |
| `aws_lambda_permission.log_digest`, principal `logs.amazonaws.com` | none: one `invoker-not-read` row at `info` | `logs/log-digest.ts` |

The listener's own default action is a fixed response, so it adds no route. The
permission for the user pool is already read from the pool, and says nothing.
