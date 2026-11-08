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
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-parameters-'));
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
  environment {
    variables = {
      MODE = data.aws_ssm_parameter.mode.value
    }
  }
}
`;

const data = (name: string, path: string): string => `data "aws_ssm_parameter" "${name}" {\n  name = "${path}"\n}\n`;

describe('parameters of the account shared between deployments (P253)', () => {
  it('publishes what a parameter it writes holds: a queue, an API with its root, text', () => {
    const deployment = readHcl(`
resource "aws_sqs_queue" "placed" {
  name = "shop-placed"
}
resource "aws_api_gateway_rest_api" "shop" {
  name = "shop"
}
resource "aws_ssm_parameter" "placed" {
  name  = "/shop/placed"
  type  = "String"
  value = aws_sqs_queue.placed.url
}
resource "aws_ssm_parameter" "api" {
  name  = "/shop/api/id"
  type  = "String"
  value = aws_api_gateway_rest_api.shop.id
}
resource "aws_ssm_parameter" "mode" {
  name  = "/shop/mode"
  type  = "String"
  value = "live"
}
`);
    expect(deployment.exports?.map((value) => [value.keys[0], value.names ?? value.text])).toEqual([
      ['parameter:/shop/placed', { kind: 'queue', name: 'shop-placed' }],
      ['parameter:/shop/api/id', { kind: 'api', name: 'shop' }],
      ['parameter:/shop/mode', 'live'],
    ]);
    // The API's id is not a point of its tree: a route hangs from a resource's (P21).
    expect(deployment.roots).toEqual([]);
  });

  it('reads a parameter another deployment writes in a value of the environment, a subscription, a mapping and a destination', () => {
    const deployment = readHcl(`${FUNCTION}${data('mode', '/shop/mode')}${data('topic', '/shop/topic')}${data('stream', '/shop/stream')}${data('failures', '/shop/failures')}
resource "aws_sns_topic_subscription" "restocked" {
  topic_arn = data.aws_ssm_parameter.topic.value
  protocol  = "lambda"
  endpoint  = aws_lambda_function.tally.arn
}
resource "aws_lambda_event_source_mapping" "changes" {
  event_source_arn  = data.aws_ssm_parameter.stream.value
  function_name     = aws_lambda_function.tally.arn
  starting_position = "LATEST"
}
resource "aws_lambda_function_event_invoke_config" "tally" {
  function_name = aws_lambda_function.tally.function_name
  destination_config {
    on_failure {
      destination = data.aws_ssm_parameter.failures.value
    }
  }
}
`);
    expect(deployment.functions[0]?.environment?.['MODE']?.imported).toBe('parameter:/shop/mode');
    expect(deployment.deliveries.map((delivery) => [delivery.address, delivery.from.kind === 'outcome' ? delivery.to : delivery.from])).toEqual([
      [alternativeAddress('aws_lambda_event_source_mapping.changes', 'stream'), { kind: 'changes', of: 'stream', name: importedName('parameter:/shop/stream') }],
      [alternativeAddress('aws_lambda_event_source_mapping.changes', 'table'), { kind: 'changes', of: 'table', name: importedName('parameter:/shop/stream') }],
      ['aws_sns_topic_subscription.restocked', { kind: 'topic', name: importedName('parameter:/shop/topic') }],
      ...['queue', 'topic', 'bus', 'function'].map((kind) => [
        alternativeAddress('aws_lambda_function_event_invoke_config.tally.on_failure', kind),
        expect.objectContaining({ kind, name: importedName('parameter:/shop/failures') }),
      ]),
    ]);
    expect(deployment.imports?.map((site) => site.key)).toEqual(expect.arrayContaining(['parameter:/shop/mode', 'parameter:/shop/topic', 'parameter:/shop/stream', 'parameter:/shop/failures']));
  });
});
