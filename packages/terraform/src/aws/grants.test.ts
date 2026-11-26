import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';

/** What a function's role lets it send to, as Terraform writes it (P272). */
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const readHcl = (text: string): Deployment => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-grants-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'main.tf'), text);
  return terraformReader.read({ repoDir: dir, config: parseConfig({}) });
};

const grantsOf = (deployment: Deployment, address: string) =>
  (deployment.functions.find((fn) => fn.address === address)?.grants ?? []).map(({ kind, name, any, by }) => ({
    kind,
    ...(name === undefined ? {} : { name }),
    ...(any === undefined ? {} : { any }),
    by,
  }));

const BASE = `
resource "aws_sqs_queue" "settled" { name = "payments-settled" }
resource "aws_sns_topic" "notices" { name = "payments-notices" }
resource "aws_iam_role" "settle" { name = "payments-settle" }
resource "aws_lambda_function" "settle" {
  function_name = "payments-settle"
  handler       = "settle.handler"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.settle.arn
}
`;

describe('what a Terraform function is granted', () => {
  it('reads a policy document a data source builds, attached to the role the function runs as', () => {
    const deployment = readHcl(`${BASE}
data "aws_iam_policy_document" "settle" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.settled.arn]
  }
  statement {
    actions   = ["sqs:ReceiveMessage"]
    resources = ["*"]
  }
}
resource "aws_iam_role_policy" "settle" {
  role   = aws_iam_role.settle.id
  policy = data.aws_iam_policy_document.settle.json
}
`);
    expect(grantsOf(deployment, 'aws_lambda_function.settle')).toEqual([{ kind: 'queue', name: 'payments-settled', by: 'data.aws_iam_policy_document.settle.statement[0]' }]);
  });

  it('reads a policy jsonencode writes, a wildcard as every one of the kind, and a managed policy attached by its ARN', () => {
    const deployment = readHcl(`${BASE}
resource "aws_iam_role_policy" "notify" {
  role = aws_iam_role.settle.name
  policy = jsonencode({
    Statement = [
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.notices.arn },
      { Effect = "Allow", Action = "sqs:SendMessage", Resource = "arn:aws:sqs:*:*:*" },
    ]
  })
}
resource "aws_iam_role_policy_attachment" "s3" {
  role       = aws_iam_role.settle.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}
`);
    expect(grantsOf(deployment, 'aws_lambda_function.settle')).toEqual([
      { kind: 'topic', name: 'payments-notices', by: 'aws_iam_role_policy.notify.policy.Statement[0]' },
      { kind: 'queue', any: 'arn:aws:sqs:*:*:*', by: 'aws_iam_role_policy.notify.policy.Statement[1]' },
      { kind: 'bucket', any: 'AmazonS3FullAccess', by: 'aws_iam_role_policy_attachment.s3' },
    ]);
  });
});
