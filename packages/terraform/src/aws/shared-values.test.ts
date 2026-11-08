import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { alternativeAddress, importedName, parseConfig, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const readHcl = (text: string): Deployment => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-shared-values-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'main.tf'), text);
  return terraformReader.read({ repoDir: dir, config: parseConfig({}) });
};

const FUNCTION = `
resource "aws_lambda_function" "tally" {
  function_name = "shop-tally"
  runtime       = "nodejs20.x"
  handler       = "tally.handler"
  filename      = "tally.zip"
}
`;

const data = (name: string, path: string): string => `data "aws_ssm_parameter" "${name}" {\n  name = "${path}"\n}\n`;

describe('a Terraform mapping read as alternatives draws its failure destination (P259)', () => {
  it('draws the destination once per reading, from that reading, and lists it on the import', () => {
    const mapping = 'aws_lambda_event_source_mapping.clicks';
    const deployment = readHcl(`${FUNCTION}${data('clicks', '/shop/clicks')}
resource "aws_sqs_queue" "failures" {
  name = "shop-failures"
}
resource "aws_lambda_event_source_mapping" "clicks" {
  event_source_arn  = data.aws_ssm_parameter.clicks.value
  function_name     = aws_lambda_function.tally.arn
  starting_position = "LATEST"
  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.failures.arn
    }
  }
}
`);
    const failures = deployment.deliveries.filter((delivery) => delivery.by === 'destination');
    expect(failures.map((delivery) => [delivery.address, delivery.from, delivery.to])).toEqual(
      ['stream', 'table'].map((kind) => [
        alternativeAddress(`${mapping}.on_failure`, kind),
        { kind: 'outcome', when: 'failure', of: { delivery: alternativeAddress(mapping, kind) } },
        { kind: 'queue', name: 'shop-failures' },
      ]),
    );
    expect(deployment.imports?.[0]?.alternatives).toEqual([
      { kind: 'stream', address: alternativeAddress(mapping, 'stream') },
      { kind: 'table', address: alternativeAddress(mapping, 'table') },
      { kind: 'stream', address: alternativeAddress(`${mapping}.on_failure`, 'stream') },
      { kind: 'table', address: alternativeAddress(`${mapping}.on_failure`, 'table') },
    ]);
  });

  it('says a destination that is a value another deployment publishes too, and draws none', () => {
    const deployment = readHcl(`${FUNCTION}${data('clicks', '/shop/clicks')}${data('dlq', '/shop/dlq')}
resource "aws_lambda_event_source_mapping" "clicks" {
  event_source_arn  = data.aws_ssm_parameter.clicks.value
  function_name     = aws_lambda_function.tally.arn
  starting_position = "LATEST"
  destination_config {
    on_failure {
      destination_arn = data.aws_ssm_parameter.dlq.value
    }
  }
}
`);
    expect(deployment.deliveries.filter((delivery) => delivery.by === 'destination')).toEqual([]);
    expect(deployment.rows.find((row) => row.reason === 'subscription-target-unread')?.message).toMatch(/\/shop\/dlq/);
  });
});

describe('rule targets and subscription endpoints of a parameter (P259)', () => {
  it('reads a rule target as each kind it may be, and a subscription endpoint as its protocol says', () => {
    const deployment = readHcl(`${FUNCTION}${data('jobs', '/shop/jobs')}${data('fulfil', '/shop/fulfil')}
resource "aws_cloudwatch_event_rule" "settled" {
  name          = "shop-settled"
  event_pattern = jsonencode({ source = ["ledger"] })
}
resource "aws_cloudwatch_event_target" "jobs" {
  rule = aws_cloudwatch_event_rule.settled.name
  arn  = data.aws_ssm_parameter.jobs.value
}
resource "aws_sns_topic" "entries" {
  name = "shop-entries"
}
resource "aws_sns_topic_subscription" "fulfil" {
  topic_arn = aws_sns_topic.entries.arn
  protocol  = "lambda"
  endpoint  = data.aws_ssm_parameter.fulfil.value
}
`);
    const target = 'aws_cloudwatch_event_target.jobs';
    expect(deployment.deliveries.map((delivery) => [delivery.address, delivery.to])).toEqual([
      ...['function', 'queue', 'topic', 'bus', 'workflow'].map((kind) => [alternativeAddress(target, kind), { kind, name: importedName('parameter:/shop/jobs') }]),
      ['aws_sns_topic_subscription.fulfil', { kind: 'function', name: importedName('parameter:/shop/fulfil') }],
    ]);
    expect(deployment.imports?.map((site) => [site.key, site.kinds, site.alternatives?.length])).toEqual([
      ['parameter:/shop/jobs', ['function', 'queue', 'topic', 'bus', 'workflow'], 5],
      ['parameter:/shop/fulfil', ['function'], undefined],
    ]);
    expect(deployment.rows.map((row) => row.reason)).not.toContain('subscription-target-unread');
  });
});
