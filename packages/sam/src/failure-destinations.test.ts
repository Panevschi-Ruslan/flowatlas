import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { alternativeAddress, importedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cloudFormationReader, samReader } from './index.js';

const read = (files: Record<string, string>, reader = cloudFormationReader): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cfn-failures-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return reader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda' } });
};

/** A plain template with a function and the resources given. */
const template = (resources: string): string =>
  [
    "AWSTemplateFormatVersion: '2010-09-09'",
    'Resources:',
    '  Fn:',
    '    Type: AWS::Lambda::Function',
    '    Properties: { FunctionName: shop-tally, Runtime: nodejs20.x, Handler: fn.handler, Code: src }',
    ...resources.split('\n').map((line) => `  ${line}`),
  ].join('\n');

const failures = (deployment: Deployment) => deployment.deliveries.filter((delivery) => delivery.by === 'destination').map((delivery) => [delivery.address, delivery.from, delivery.to]);

describe("a mapping's failure destination, written as a resource (P264)", () => {
  it('hands what a mapping of a stream it declares gives up on to the queue its DestinationConfig names', () => {
    const deployment = read({
      'stack.yaml': template(
        [
          'Clicks:',
          '  Type: AWS::Kinesis::Stream',
          '  Properties: { Name: shop-clicks, ShardCount: 1 }',
          'Failed:',
          '  Type: AWS::SQS::Queue',
          '  Properties: { QueueName: shop-failed }',
          'Map:',
          '  Type: AWS::Lambda::EventSourceMapping',
          '  Properties:',
          '    EventSourceArn: !GetAtt Clicks.Arn',
          '    FunctionName: !Ref Fn',
          '    StartingPosition: LATEST',
          '    DestinationConfig: { OnFailure: { Destination: !GetAtt Failed.Arn } }',
        ].join('\n'),
      ),
    });
    expect(failures(deployment)).toEqual([['stack.Resources.Map.DestinationConfig.OnFailure', { kind: 'outcome', when: 'failure', of: { delivery: 'stack.Resources.Map' } }, { kind: 'queue', name: 'shop-failed' }]]);
  });

  it('reads a destination another deployment publishes as a queue or a topic, under each reading of a mapping of a value another publishes', () => {
    const deployment = read({
      'stack.yaml': template(
        [
          'Map:',
          '  Type: AWS::Lambda::EventSourceMapping',
          '  Properties:',
          "    EventSourceArn: '{{resolve:ssm:/shop/clicks}}'",
          '    FunctionName: !Ref Fn',
          '    StartingPosition: LATEST',
          "    DestinationConfig: { OnFailure: { Destination: '{{resolve:ssm:/shop/failed}}' } }",
        ].join('\n'),
      ),
    });
    const failure = 'stack.Resources.Map.DestinationConfig.OnFailure';
    const inner = ['stream', 'table'].flatMap((reading) => ['queue', 'topic'].map((kind) => alternativeAddress(alternativeAddress(failure, reading), kind)));
    expect(failures(deployment).map(([address, from, to]) => [address, (from as { of: unknown }).of, to])).toEqual(
      ['stream', 'table'].flatMap((reading) =>
        ['queue', 'topic'].map((kind) => [alternativeAddress(alternativeAddress(failure, reading), kind), { delivery: alternativeAddress('stack.Resources.Map', reading) }, { kind, name: importedName('parameter:/shop/failed') }]),
      ),
    );
    expect(deployment.imports?.map((site) => [site.key, site.alternatives?.map((alternative) => alternative.address)])).toEqual([
      ['parameter:/shop/clicks', [...['stream', 'table'].map((kind) => alternativeAddress('stack.Resources.Map', kind)), ...['stream', 'table'].map((kind) => alternativeAddress(failure, kind))]],
      ['parameter:/shop/failed', inner],
    ]);
  });

  it("reads a SAM stream event's destination of an import as the kind its Type says", () => {
    const deployment = read({
      'template.yaml': [
        "AWSTemplateFormatVersion: '2010-09-09'",
        'Transform: AWS::Serverless-2016-10-31',
        'Resources:',
        '  Fn:',
        '    Type: AWS::Serverless::Function',
        '    Properties:',
        '      FunctionName: shop-tally',
        '      Runtime: nodejs20.x',
        '      Handler: fn.handler',
        '      CodeUri: src',
        '      Events:',
        '        Clicks:',
        '          Type: Kinesis',
        '          Properties:',
        '            Stream: arn:aws:kinesis:eu-west-1:1:stream/shop-clicks',
        '            StartingPosition: LATEST',
        '            DestinationConfig: { OnFailure: { Type: SNS, Destination: !ImportValue shop-failed } }',
      ].join('\n'),
    }, samReader);
    expect(failures(deployment).map(([address, , to]) => [address, to])).toEqual([['Resources.Fn.Events.Clicks.DestinationConfig.OnFailure', { kind: 'topic', name: importedName('export:shop-failed') }]]);
    expect(deployment.imports?.map((site) => [site.key, site.kinds, site.alternatives])).toEqual([['export:shop-failed', ['topic'], undefined]]);
  });
});
