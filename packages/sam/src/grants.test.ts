import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generatedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { samReader } from './index.js';

/**
 * What a function's policies and role let it send to (P272), and an address
 * of the template's own API a function is deployed with.
 */
const read = (files: Record<string, string>): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-sam-grants-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return samReader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda' } });
};

const template = (resources: string, head = ''): string =>
  `Transform: AWS::Serverless-2016-10-31\n${head}Resources:\n${resources.replace(/^/gm, '  ')}\n`;

const grantsOf = (deployment: Deployment, address: string) =>
  (deployment.functions.find((fn) => fn.address === address)?.grants ?? []).map(({ kind, name, any, unread, by }) => ({
    kind,
    ...(name === undefined ? {} : { name }),
    ...(any === undefined ? {} : { any }),
    ...(unread === undefined ? {} : { unread }),
    by,
  }));

describe('what a SAM function is granted', () => {
  it('reads policy templates, statements written in place and managed policies, and leaves reads and denials out', () => {
    const deployment = read({
      'template.yaml': template(`Orders:
  Type: AWS::SQS::Queue
Shop:
  Type: AWS::SNS::Topic
  Properties:
    TopicName: shop
Send:
  Type: AWS::Serverless::Function
  Properties:
    Handler: send.handler
    Runtime: nodejs20.x
    Policies:
      - SQSSendMessagePolicy:
          QueueName: !GetAtt Orders.QueueName
      - Statement:
          - Effect: Allow
            Action: [sns:Publish]
            Resource: !Ref Shop
          - Effect: Allow
            Action: sqs:ReceiveMessage
            Resource: "*"
          - Effect: Deny
            Action: sns:Publish
            Resource: "*"
      - AmazonS3FullAccess
      - DynamoDBReadPolicy:
          TableName: ledger`),
    });
    expect(grantsOf(deployment, 'Resources.Send')).toEqual([
      { kind: 'queue', name: generatedName('Resources.Orders'), by: 'SQSSendMessagePolicy' },
      { kind: 'topic', name: 'shop', by: 'Policies[1].Statement[0]' },
      { kind: 'bucket', any: 'AmazonS3FullAccess', by: 'Policies[2]' },
    ]);
  });

  it('reads a role the template declares and a policy attached to it, an ARN ending in a wildcard as every one of the kind', () => {
    const deployment = read({
      'template.yaml': template(`Archive:
  Type: AWS::Kinesis::Stream
  Properties:
    Name: archive
Put:
  Type: AWS::Lambda::Function
  Properties:
    Handler: put.handler
    Runtime: nodejs20.x
    Code: src
    Role: !GetAtt PutRole.Arn
PutRole:
  Type: AWS::IAM::Role
  Properties:
    Policies:
      - PolicyName: put
        PolicyDocument:
          Statement:
            - Effect: Allow
              Action: kinesis:Put*
              Resource: !GetAtt Archive.Arn
Wide:
  Type: AWS::IAM::Policy
  Properties:
    Roles: [!Ref PutRole]
    PolicyDocument:
      Statement:
        - Effect: Allow
          Action: sqs:SendMessage
          Resource: !Sub "arn:aws:sqs:\${AWS::Region}:\${AWS::AccountId}:*"`),
    });
    expect(grantsOf(deployment, 'Resources.Put')).toEqual([
      { kind: 'stream', name: 'archive', by: 'Resources.PutRole.Policies[0].Statement[0]' },
      { kind: 'queue', any: 'arn:aws:sqs:…:…:*', by: 'Resources.Wide.Statement[0]' },
    ]);
  });

  it('reads a policy template on a table a parameter with no value names', () => {
    const deployment = read({
      'template.yaml': template(
        `Ledger:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Ref LedgerName
Write:
  Type: AWS::Serverless::Function
  Properties:
    Handler: write.handler
    Runtime: nodejs20.x
    Policies:
      - DynamoDBCrudPolicy:
          TableName: !Ref LedgerName`,
        'Parameters:\n  LedgerName:\n    Type: String\n',
      ),
    });
    expect(grantsOf(deployment, 'Resources.Write')).toEqual([{ kind: 'table', name: generatedName('Parameters.LedgerName'), by: 'DynamoDBCrudPolicy' }]);
  });
});

describe('an address of the template\'s own API a function is deployed with', () => {
  it('is that API, with the path it asks for after the stage; another stage or the id alone is not', () => {
    const deployment = read({
      'template.yaml': template(
        `Shop:
  Type: AWS::Serverless::Api
  Properties:
    StageName: !Ref Stage
Caller:
  Type: AWS::Serverless::Function
  Properties:
    Handler: caller.handler
    Runtime: nodejs20.x
    Environment:
      Variables:
        SHOP_API: !Sub "https://\${Shop}.execute-api.\${AWS::Region}.amazonaws.com/\${Stage}/orders"
        OTHER_STAGE: !Sub "https://\${Shop}.execute-api.\${AWS::Region}.amazonaws.com/test"
        SHOP_ID: !Ref Shop`,
        'Parameters:\n  Stage:\n    Type: String\n    Default: live\n',
      ),
    });
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['SHOP_API']?.names).toEqual({ kind: 'api', name: 'template.yaml#Resources.Shop' });
    expect(environment['SHOP_API']?.path).toBe('/orders');
    expect(environment['SHOP_API']?.referenced).toBe(true);
    expect(environment['OTHER_STAGE']?.names).toBeUndefined();
    expect(environment['SHOP_ID']?.names?.kind).not.toBe('api');
  });
});
