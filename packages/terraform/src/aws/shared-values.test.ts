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

  it('draws a destination that is a value another deployment publishes too once per kind, under each reading, and lists the kinds on its own import (P261)', () => {
    const mapping = 'aws_lambda_event_source_mapping.clicks';
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
    const failures = deployment.deliveries.filter((delivery) => delivery.by === 'destination');
    const readings = ['stream', 'table'].flatMap((mapped) => ['queue', 'topic'].map((kind) => [mapped, kind] as const));
    expect(failures.map((delivery) => [delivery.address, delivery.from, delivery.to])).toEqual(
      readings.map(([mapped, kind]) => [
        alternativeAddress(alternativeAddress(`${mapping}.on_failure`, mapped), kind),
        { kind: 'outcome', when: 'failure', of: { delivery: alternativeAddress(mapping, mapped) } },
        { kind, name: importedName('parameter:/shop/dlq') },
      ]),
    );
    expect(deployment.imports?.map((site) => [site.key, site.kinds, site.alternatives?.map((alternative) => alternative.address)])).toEqual([
      ['parameter:/shop/clicks', ['stream', 'table'], [...['stream', 'table'].map((kind) => alternativeAddress(mapping, kind)), ...['stream', 'table'].map((kind) => alternativeAddress(`${mapping}.on_failure`, kind))]],
      ['parameter:/shop/dlq', ['queue', 'topic'], readings.map(([mapped, kind]) => alternativeAddress(alternativeAddress(`${mapping}.on_failure`, mapped), kind))],
    ]);
    expect(deployment.rows.map((row) => row.reason)).not.toContain('subscription-target-unread');
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

const STATE = 'state:s3:bucket=shop-state,key=platform.tfstate';
const REMOTE = `
data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = "shop-state"
    key    = "platform.tfstate"
  }
}
`;

describe('values other deployments publish written into one string (P261)', () => {
  it('reads each part of a name built of two, and of one and text, and leaves an import outside the name aside', () => {
    const deployment = readHcl(`${data('prefix', '/shop/prefix')}${data('account', '/shop/account')}${REMOTE}
variable "region" {
  type = string
}
resource "aws_lambda_function" "tally" {
  function_name = "shop-tally"
  runtime       = "nodejs20.x"
  handler       = "tally.handler"
  filename      = "tally.zip"
  environment {
    variables = {
      JOBS_URL = "https://sqs.eu-west-1.amazonaws.com/\${data.aws_ssm_parameter.account.value}/\${data.aws_ssm_parameter.prefix.value}-\${data.terraform_remote_state.platform.outputs.stage}-jobs"
      EVENTS   = data.terraform_remote_state.platform.outputs.events_url
    }
  }
}
resource "aws_cloudwatch_event_rule" "settled" {
  name          = "shop-settled"
  event_pattern = jsonencode({ source = ["ledger"] })
}
resource "aws_cloudwatch_event_target" "audit" {
  rule = aws_cloudwatch_event_rule.settled.name
  arn  = "arn:aws:sqs:\${var.region}:\${data.aws_ssm_parameter.account.value}:\${data.aws_ssm_parameter.prefix.value}-audit"
}
resource "aws_cloudwatch_event_target" "alerts" {
  rule = aws_cloudwatch_event_rule.settled.name
  arn  = "arn:aws:sns:eu-west-1:111122223333:\${data.terraform_remote_state.platform.outputs.alerts}"
}
`);
    const prefix = importedName('parameter:/shop/prefix');
    const stage = importedName(`${STATE}#stage`);
    const jobs = `${prefix}-${stage}-jobs`;
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['JOBS_URL']?.names).toEqual({ kind: 'queue', name: jobs });
    expect(environment['EVENTS']).toMatchObject({ imported: `${STATE}#events_url` });
    expect(deployment.deliveries.map((delivery) => [delivery.address, delivery.to])).toEqual([
      ['aws_cloudwatch_event_target.audit', { kind: 'queue', name: `${prefix}-audit` }],
      ['aws_cloudwatch_event_target.alerts', { kind: 'topic', name: importedName(`${STATE}#alerts`) }],
    ]);
    expect(deployment.imports?.map((site) => [site.key, site.kinds, site.as, site.within])).toEqual([
      [`${STATE}#events_url`, undefined, undefined, undefined],
      ['parameter:/shop/prefix', ['queue'], 'name', jobs],
      [`${STATE}#stage`, ['queue'], 'name', jobs],
      ['parameter:/shop/prefix', ['queue'], 'name', `${prefix}-audit`],
      [`${STATE}#alerts`, ['topic'], 'name', undefined],
    ]);
  });

  it('reads a name with %{ if } and %{ for } around values other deployments publish part by part, every way a condition nothing decides goes (P264)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowatlas-shared-values-'));
    scratch.push(dir);
    writeFileSync(join(dir, 'queue.tftpl'), '%{ if kind == "sqs" }https://sqs.eu-west-1.amazonaws.com/1/${prefix}-jobs%{ endif }');
    writeFileSync(
      join(dir, 'main.tf'),
      `${data('prefix', '/shop/prefix')}${data('stage', '/shop/stage')}
variable "region" {
  type = string
}
variable "blue" {
  type = bool
}
locals {
  parts = ["jobs"]
}
resource "aws_lambda_function" "tally" {
  function_name = "shop-tally"
  runtime       = "nodejs20.x"
  handler       = "tally.handler"
  filename      = "tally.zip"
  environment {
    variables = {
      DECIDED   = "arn:aws:sqs:eu-west-1:1:%{ if true }\${data.aws_ssm_parameter.prefix.value}%{ else }none%{ endif }-%{ for part in local.parts }\${part}%{ endfor }"
      ASIDE     = "arn:aws:sqs:%{ if var.blue }us-east-1%{ else }eu-west-1%{ endif }:1:\${data.aws_ssm_parameter.prefix.value}-\${data.aws_ssm_parameter.stage.value}-audit"
      UNDECIDED = "arn:aws:sqs:eu-west-1:1:\${data.aws_ssm_parameter.prefix.value}-%{ if var.blue }blue%{ else }green%{ endif }"
      FROM_FILE = templatefile("\${path.module}/queue.tftpl", { kind = "sqs", prefix = data.aws_ssm_parameter.prefix.value })
    }
  }
}
`,
    );
    const deployment = terraformReader.read({ repoDir: dir, config: parseConfig({}) });
    const prefix = importedName('parameter:/shop/prefix');
    const stage = importedName('parameter:/shop/stage');
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['DECIDED']?.names).toEqual({ kind: 'queue', name: `${prefix}-jobs` });
    expect(environment['ASIDE']?.names).toEqual({ kind: 'queue', name: `${prefix}-${stage}-audit` });
    expect(environment['UNDECIDED']?.names).toBeUndefined();
    expect(environment['UNDECIDED']?.unread?.text).toMatch(/which queue it names depends on a condition the files do not decide/);
    expect(environment['FROM_FILE']?.names).toEqual({ kind: 'queue', name: `${prefix}-jobs` });
    expect(deployment.imports?.filter((site) => site.within !== undefined).map((site) => [site.key, site.within])).toEqual([
      ['parameter:/shop/prefix', `${prefix}-${stage}-audit`],
      ['parameter:/shop/stage', `${prefix}-${stage}-audit`],
      ['parameter:/shop/prefix', `${prefix}-jobs`],
    ]);
  });

  it('publishes an output of a configuration whose state another reads, as what it names', () => {
    const deployment = readHcl(`
terraform {
  backend "s3" {
    bucket = "shop-state"
    key    = "platform.tfstate"
  }
}
resource "aws_sqs_queue" "jobs" {
  name = "shop-prod-jobs"
}
output "jobs_arn" {
  value = aws_sqs_queue.jobs.arn
}
output "stage" {
  value = "prod"
}
`);
    expect(deployment.exports?.map((value) => [value.keys, value.address, value.names, value.text])).toEqual([
      [[`${STATE}#jobs_arn`], 'output.jobs_arn', { kind: 'queue', name: 'shop-prod-jobs' }, undefined],
      [[`${STATE}#stage`], 'output.stage', undefined, 'prod'],
    ]);
  });
});
