# terraform-role-grants

A shop's payments as Lambda functions deployed with Terraform
(`payments/infra/main.tf`), each sending where its code decides when it runs
and allowed only where the role it runs as says (P272).

| What | Read as |
|---|---|
| `QueueUrl: outcomes.get(...)`, the role's `aws_iam_role_policy` a `data.aws_iam_policy_document` granting `sqs:SendMessage` on two queues | drawn to both queues, `heuristic`, which the ledger's mappings read; a `channel-from-grant` note |
| `TopicArn: topics.get(...)`, the role's policy written with `jsonencode` granting `sns:Publish` on `*` | nothing drawn: the row stays and says the grant bounds nothing |
