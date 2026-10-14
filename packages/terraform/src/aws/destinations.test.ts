import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfig, type DeployedDelivery, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';

const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/lambda-terraform-destinations');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const readHcl = (text: string): Deployment => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-destinations-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'main.tf'), text);
  return terraformReader.read({ repoDir: dir, config: parseConfig({}) });
};

describe('destinations and function URL addresses (fixtures/lambda-terraform-destinations)', () => {
  const deployment = terraformReader.read({
    repoDir: join(FIXTURE, 'lending'),
    config: parseConfig(JSON.parse(readFileSync(join(FIXTURE, 'flowatlas.config.json'), 'utf8'))),
  });
  const nameOf = (index: number): string | undefined => deployment.functions[index]?.name;
  const describeOutcome = (delivery: DeployedDelivery): string => {
    const { from, to } = delivery;
    if (from.kind !== 'outcome') return '-';
    const source = 'function' in from.of ? nameOf(from.of.function) : 'name' in from.of ? `named ${from.of.name}` : from.of.delivery;
    const target = to === undefined ? '-' : 'function' in to ? nameOf(to.function) : `${to.kind} ${to.name}`;
    return `${source} ${from.when} -> ${target}`;
  };

  it('reads each destination of an invoke configuration and a mapping as an outcome of the run', () => {
    expect(deployment.deliveries.filter((delivery) => delivery.by === 'destination').map(describeOutcome)).toEqual([
      'library-lending-request-loan success -> library-lending-notify-member',
      'library-lending-request-loan failure -> queue library-loan-failures',
      'library-lending-return-item success -> bus library-events',
      'library-lending-return-item failure -> topic library-return-alerts',
      'library-lending-card-lookup failure -> function library-members-alert',
      'named library-members-digest success -> library-lending-notify-member',
      'aws_lambda_event_source_mapping.shelf_scan failure -> topic library-return-alerts',
    ]);
  });

  it('names a result put on a bus by the source and detail type the platform gives it', () => {
    const toBus = deployment.deliveries.find((delivery) => delivery.to?.kind === 'bus');
    expect(toBus?.to).toEqual({
      kind: 'bus',
      name: 'library-events',
      fields: { source: 'lambda', 'detail-type': 'Lambda Function Invocation Result - Success' },
    });
  });

  it("reads a function URL handed through a module's output as the address of its function", () => {
    const kiosk = deployment.functions.find((fn) => fn.name === 'library-lending-kiosk');
    expect(kiosk?.environment?.['CARD_LOOKUP_URL']?.names).toEqual({ kind: 'url', name: 'library-lending-card-lookup' });
  });
});

describe('destinations of a function another deployment creates', () => {
  it('names the function, for the linker to join wherever it is declared (P60)', () => {
    const deployment = readHcl(`
resource "aws_sqs_queue" "failures" {
  name = "library-failures"
}
resource "aws_lambda_function_event_invoke_config" "elsewhere" {
  function_name = "library-elsewhere"
  destination_config {
    on_failure {
      destination = aws_sqs_queue.failures.arn
    }
  }
}
`);
    expect(deployment.deliveries.map((delivery) => [delivery.from, delivery.to?.kind])).toEqual([
      [{ kind: 'outcome', when: 'failure', of: { name: 'library-elsewhere' } }, 'queue'],
    ]);
    expect(deployment.rows.filter((row) => row.reason === 'subscription-source-unread')).toEqual([]);
  });
});

describe('destinations not drawn', () => {
  it('says so for an invoke configuration that names no function', () => {
    const deployment = readHcl(`
resource "aws_sqs_queue" "failures" {
  name = "library-failures"
}
resource "aws_lambda_function_event_invoke_config" "nameless" {
  destination_config {
    on_failure {
      destination = aws_sqs_queue.failures.arn
    }
  }
}
`);
    expect(deployment.deliveries).toEqual([]);
    expect(deployment.rows.map((row) => [row.reason, row.level])).toEqual([['subscription-source-unread', 'info']]);
  });

  it('reads nothing from an invoke configuration that names no destination', () => {
    const deployment = readHcl(`
resource "aws_lambda_function" "f" {
  function_name = "library-f"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
}
resource "aws_lambda_function_event_invoke_config" "retries" {
  function_name          = aws_lambda_function.f.function_name
  maximum_retry_attempts = 0
}
`);
    expect(deployment.deliveries).toEqual([]);
    expect(deployment.rows.filter((row) => row.reason === 'subscription-source-unread')).toEqual([]);
  });
});
