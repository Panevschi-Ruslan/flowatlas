import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generatedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { serverlessReader } from './index.js';

/** What a service's role lets its functions send to (P272), and a resource a parameter with no value names. */
const read = (files: Record<string, string>): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-sls-grants-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return serverlessReader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda' } });
};

const grantsOf = (deployment: Deployment, address: string) =>
  (deployment.functions.find((fn) => fn.address === address)?.grants ?? []).map(({ kind, name, any, by }) => ({
    kind,
    ...(name === undefined ? {} : { name }),
    ...(any === undefined ? {} : { any }),
    by,
  }));

const SERVICE = `service: notices
provider:
  name: aws
  runtime: nodejs20.x
  stage: dev
  region: eu-west-1
  iam:
    role:
      statements:
        - Effect: Allow
          Action: events:PutEvents
          Resource: !GetAtt Bus.Arn
        - Effect: Allow
          Action: [sqs:SendMessage]
          Resource: arn:aws:sqs:eu-west-1:123456789012:alerts
functions:
  announce:
    handler: src/announce.handler
  fanout:
    handler: src/fanout.handler
    iamRoleStatements:
      - Effect: Allow
        Action: sqs:SendMessage
        Resource: arn:aws:sqs:*:*:*
  both:
    handler: src/both.handler
    iamRoleStatementsInherit: true
    iamRoleStatements:
      - Effect: Allow
        Action: sns:Publish
        Resource: "*"
  alert:
    handler: src/alert.handler
    environment:
      ALERTS: \${param:alertsQueue}
resources:
  Resources:
    Bus:
      Type: AWS::Events::EventBus
      Properties:
        Name: shop-bus
    Alerts:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: \${param:alertsQueue}
`;

describe('what a function of a service file is granted', () => {
  it('reads the provider role\'s statements for every function', () => {
    expect(grantsOf(read({ 'serverless.yml': SERVICE }), 'functions.announce')).toEqual([
      { kind: 'bus', name: 'shop-bus', by: 'provider.iam.role.statements[0]' },
      { kind: 'queue', name: 'alerts', by: 'provider.iam.role.statements[1]' },
    ]);
  });

  it('reads a function\'s own statements in place of the provider\'s, or beside them where it inherits', () => {
    const deployment = read({ 'serverless.yml': SERVICE });
    expect(grantsOf(deployment, 'functions.fanout')).toEqual([{ kind: 'queue', any: 'arn:aws:sqs:*:*:*', by: 'functions.fanout.iamRoleStatements[0]' }]);
    expect(grantsOf(deployment, 'functions.both').map((grant) => grant.kind)).toEqual(['topic', 'bus', 'queue']);
  });
});

describe('a resource named by a parameter of the service with no value', () => {
  it('is named by the parameter, and a function deployed with the parameter names it', () => {
    const deployment = read({ 'serverless.yml': SERVICE });
    const alert = deployment.functions.find((fn) => fn.address === 'functions.alert');
    expect(alert?.environment?.['ALERTS']?.names).toEqual({ kind: 'queue', name: generatedName('params.alertsQueue') });
    expect(deployment.rows.filter((row) => row.reason === 'deployed-name-from-parameter').map((row) => row.symbol)).toEqual(['params.alertsQueue']);
  });

  it('is the value given under params where there is one', () => {
    const deployment = read({ 'serverless.yml': `${SERVICE}params:\n  default:\n    alertsQueue: shop-alerts\n` });
    const alert = deployment.functions.find((fn) => fn.address === 'functions.alert');
    expect(alert?.environment?.['ALERTS']?.text).toBe('shop-alerts');
  });
});
