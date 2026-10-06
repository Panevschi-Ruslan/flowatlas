# multi-repo-events

A publisher, its rules and its consumers in three repositories, on a bus a
fourth repository owns. Every channel is joined across repositories by its
name, and every rule's target by the name it is deployed under.

Type-checked, never executed or deployed.

| Service | What it is | What it contributes |
|---|---|---|
| `platform-events` | Terraform only, no `package.json` | the bus `library`, through `terraform-aws-modules/eventbridge/aws`, with an `audit` rule (`source` by `prefix "library."`, so `audit-rule` by the module's naming) copying every library event to `sqs/library-audit`, which nothing reads |
| `loans` | Lambda functions behind an HTTP API | `POST /loans` and `POST /loans/{loanId}/return` put `LoanCreated` and `LoanReturned` on the bus named by `process.env.EVENT_BUS_NAME`, which the functions' Terraform sets from a lookup of the bus: by its name in one, by its ARN in the other |
| `routing` | Terraform only | the rules: `LoanCreated` exactly, onto `library-welcome-borrower` by an ARN whose region and account are not known from the files; every other loan event (`anything-but`) to `sqs/library-loan-digest`; a partner's events (`prefix "partner."`), which nothing here puts |
| `notifications` | Lambda functions | `library-welcome-borrower`, and `library-loan-digest` reading the digest queue through a mapping |

`flow 'POST /loans'` walks from the route in `loans`, through `PutEvents`, onto
the channel, through the rule in `routing`, into the welcome function's body in
`notifications` - and through the audit rule in `platform-events` onto its queue.

The exact rule's join is `static`; the audit rule's and the digest rule's are
`heuristic`, each with its reason on the edge. The partner rule selects nothing
anybody configured publishes: one `subscription-matches-nothing` row at `info`.
