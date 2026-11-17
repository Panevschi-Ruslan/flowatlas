import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkReader } from './index.js';

/** What a CDK app grants a function (P272). */
const stack = (body: string, more: Record<string, string> = {}): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cdk-grants-'));
  const files: Record<string, string> = {
    'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts' }),
    'bin/app.ts': "import { App } from 'aws-cdk-lib';\nimport { AppStack } from '../lib/stack';\nconst app = new App();\nnew AppStack(app, 'App');\n",
    'lib/stack.ts': [
      "import * as path from 'path';",
      "import * as cdk from 'aws-cdk-lib';",
      "import { aws_lambda as lambda, aws_sqs as sqs, aws_sns as sns, aws_iam as iam } from 'aws-cdk-lib';",
      "import { Construct } from 'constructs';",
      'export class AppStack extends cdk.Stack {',
      '  constructor(scope: Construct, id: string) {',
      '    super(scope, id);',
      body,
      '  }',
      '}',
    ].join('\n'),
    ...more,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return cdkReader.read({ repoDir, config: parseConfig({}), service: { name: 'app', repo: repoDir, type: 'lambda' } });
};

const FN = `const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler' });`;

describe('what a CDK function is granted', () => {
  it('reads a construct\'s grant to it and a statement added to its role, and leaves a grant to read out', () => {
    const deployment = stack(`${FN}
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const writeOff = new sqs.Queue(this, 'WriteOff', { queueName: 'stock-write-off' });
    const notices = new sns.Topic(this, 'Notices', { topicName: 'stock-notices' });
    restock.grantSendMessages(move);
    notices.grantPublish(move.role);
    writeOff.grantConsumeMessages(move);
    move.addToRolePolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [writeOff.queueArn, 'arn:aws:sqs:*:*:*'] }));`);
    const grants = (deployment.functions[0]?.grants ?? []).map(({ kind, name, any, by }) => ({ kind, ...(name === undefined ? {} : { name }), ...(any === undefined ? {} : { any }), by }));
    expect(grants).toEqual([
      { kind: 'queue', name: 'stock-restock', by: 'grantSendMessages' },
      { kind: 'topic', name: 'stock-notices', by: 'grantPublish' },
      { kind: 'queue', name: 'stock-write-off', by: 'PolicyStatement' },
      { kind: 'queue', any: 'arn:aws:sqs:*:*:*', by: 'PolicyStatement' },
    ]);
  });
});

describe('what a CDK function is granted through its role and Grant.addToPrincipal (P289)', () => {
  it("reads the grants and statements of a role it is handed, its inline policies and policies attached to it, and Grant.addToPrincipal", () => {
    const deployment = stack(`
    const role = new iam.Role(this, 'MoveRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: { publish: new iam.PolicyDocument({ statements: [new iam.PolicyStatement({ actions: ['sns:Publish'], resources: ['arn:aws:sns:eu-west-1:111122223333:stock-notices'] })] }) },
    });
    const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const writeOff = new sqs.Queue(this, 'WriteOff', { queueName: 'stock-write-off' });
    const audit = new sqs.Queue(this, 'Audit', { queueName: 'stock-audit' });
    const later = new sqs.Queue(this, 'Later', { queueName: 'stock-later' });
    restock.grantSendMessages(role);
    role.addToPolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [writeOff.queueArn] }));
    new iam.Policy(this, 'AuditPolicy', { roles: [role], statements: [new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [audit.queueArn] })] });
    iam.Grant.addToPrincipal({ grantee: move, actions: ['sqs:SendMessage'], resourceArns: [later.queueArn] });`);
    const grants = (deployment.functions[0]?.grants ?? []).map(({ kind, name, by }) => `${kind} ${name ?? '?'} ${by}`);
    expect(grants).toEqual([
      'queue stock-restock grantSendMessages',
      'queue stock-later PolicyStatement',
      'queue stock-write-off PolicyStatement',
      'topic stock-notices PolicyStatement',
      'queue stock-audit PolicyStatement',
    ]);
  });
});

describe('what a CDK function is granted through managed policies, groups and composite principals (P299)', () => {
  const grantsOf = (deployment: Deployment): string[] =>
    (deployment.functions[0]?.grants ?? []).map(({ kind, name, any, unread, by }) => `${kind} ${name ?? any ?? `open: ${unread ?? '?'}`} ${by}`);

  it("reads a role's managed policies: one AWS keeps by its name or ARN, one the app creates by its statements, one of the account left open", () => {
    const deployment = stack(`
    const notices = new sns.Topic(this, 'Notices', { topicName: 'stock-notices' });
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const own = new iam.ManagedPolicy(this, 'Own', { statements: [new iam.PolicyStatement({ actions: ['sns:Publish'], resources: [notices.topicArn] })] });
    own.addStatements(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [restock.queueArn] }));
    const role = new iam.Role(this, 'MoveRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'), own],
    });
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSQSFullAccess'));
    role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'Tables', 'arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess'));
    role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyName(this, 'Shared', 'stock-shared-policy'));
    const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });`);
    const open = 'open: the managed policy stock-shared-policy is kept in the account, and its statements are not in the app stock-shared-policy';
    expect(grantsOf(deployment)).toEqual([
      'queue AmazonSQSFullAccess AmazonSQSFullAccess',
      'table AmazonDynamoDBFullAccess AmazonDynamoDBFullAccess',
      ...['queue', 'topic', 'bus', 'stream', 'table', 'bucket', 'function', 'workflow'].map((kind) => `${kind} ${open}`),
      'topic stock-notices PolicyStatement',
      'queue stock-restock PolicyStatement',
    ]);
  });

  it("reads what is added through a function's own role and a managed policy attached to it", () => {
    const deployment = stack(`${FN}
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const audit = new sqs.Queue(this, 'Audit', { queueName: 'stock-audit' });
    move.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSNSFullAccess'));
    move.role!.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [restock.queueArn] }));
    new iam.ManagedPolicy(this, 'AuditPolicy', { roles: [move.role!], statements: [new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [audit.queueArn] })] });`);
    expect(grantsOf(deployment)).toEqual(['topic AmazonSNSFullAccess AmazonSNSFullAccess', 'queue stock-restock PolicyStatement', 'queue stock-audit PolicyStatement']);
  });

  it('reads the grants of a user whose access key the function is deployed with, and of the groups that user is in', () => {
    const deployment = stack(`
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const notices = new sns.Topic(this, 'Notices', { topicName: 'stock-notices' });
    const audit = new sqs.Queue(this, 'Audit', { queueName: 'stock-audit' });
    const unrelated = new sqs.Queue(this, 'Unrelated', { queueName: 'stock-unrelated' });
    const operators = new iam.Group(this, 'Operators');
    const others = new iam.Group(this, 'Others');
    const user = new iam.User(this, 'Mover');
    operators.addUser(user);
    const key = new iam.AccessKey(this, 'MoverKey', { user });
    restock.grantSendMessages(user);
    notices.grantPublish(operators);
    operators.addToPolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [audit.queueArn] }));
    operators.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));
    unrelated.grantSendMessages(others);
    const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', environment: { KEY_ID: key.accessKeyId } });`);
    expect(grantsOf(deployment)).toEqual([
      'queue stock-restock grantSendMessages',
      'topic stock-notices grantPublish',
      'bucket AmazonS3FullAccess AmazonS3FullAccess',
      'queue stock-audit PolicyStatement',
    ]);
  });

  it("reads a user whose access key is kept in a secret the function's environment names", () => {
    const deployment = stack(`
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const user = new iam.User(this, 'Mover');
    const key = new iam.AccessKey(this, 'MoverKey', { user });
    const secret = new cdk.aws_secretsmanager.Secret(this, 'MoverSecret', { secretObjectValue: { secret: key.secretAccessKey } });
    restock.grantSendMessages(user);
    const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', environment: { KEY_SECRET: secret.secretArn } });`);
    expect(grantsOf(deployment)).toEqual(['queue stock-restock grantSendMessages']);
  });

  it('reads a role assumed by a composite principal, and a grant to a composite principal on each member', () => {
    const deployment = stack(`
    const role = new iam.Role(this, 'MoveRole', { assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal('lambda.amazonaws.com'), new iam.ServicePrincipal('states.amazonaws.com')) });
    const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });
    const other = new iam.Role(this, 'OtherRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const later = new sqs.Queue(this, 'Later', { queueName: 'stock-later' });
    const both = new iam.CompositePrincipal(other);
    both.addPrincipals(role);
    restock.grantSendMessages(both);
    iam.Grant.addToPrincipal({ grantee: new iam.CompositePrincipal(other, move), actions: ['sqs:SendMessage'], resourceArns: [later.queueArn] });`);
    expect(grantsOf(deployment)).toEqual(['queue stock-restock grantSendMessages', 'queue stock-later PolicyStatement']);
  });
});

describe('what a CDK function is granted through a secret value wrapping an access key and a role imported by its ARN (P306)', () => {
  const grantsOf = (deployment: Deployment): string[] =>
    (deployment.functions[0]?.grants ?? []).map(({ kind, name, any, unread, by }) => `${kind} ${name ?? any ?? `open: ${unread ?? '?'}`} ${by}`);
  const KINDS = ['queue', 'topic', 'bus', 'stream', 'table', 'bucket', 'function', 'workflow'];

  it("follows an access key's id a secret holds wrapped in SecretValue.unsafePlainText to the user whose key it is", () => {
    for (const wrap of ['unsafePlainText', 'plainText']) {
      const deployment = stack(`
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const user = new iam.User(this, 'Mover');
    const key = new iam.AccessKey(this, 'MoverKey', { user });
    const secret = new cdk.aws_secretsmanager.Secret(this, 'MoverSecret', { secretObjectValue: { id: cdk.SecretValue.${wrap}(key.accessKeyId) } });
    restock.grantSendMessages(user);
    const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', environment: { KEY_SECRET: secret.secretArn } });`);
      expect(grantsOf(deployment)).toEqual(['queue stock-restock grantSendMessages']);
    }
  });

  it('leaves every kind open for a role imported by its ARN, and reads what the app attaches to it', () => {
    const deployment = stack(`
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const audit = new sqs.Queue(this, 'Audit', { queueName: 'stock-audit' });
    const notices = new sns.Topic(this, 'Notices', { topicName: 'stock-notices' });
    const role = iam.Role.fromRoleArn(this, 'MoveRole', 'arn:aws:iam::111122223333:role/stock-mover');
    role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [restock.queueArn] }));
    role.attachInlinePolicy(new iam.Policy(this, 'AuditPolicy', { statements: [new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [audit.queueArn] })] }));
    notices.grantPublish(role);
    const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });`);
    const open = 'open: the role arn:aws:iam::111122223333:role/stock-mover is imported by its ARN, and the policies the account attaches to it are not in the app MoveRole';
    expect(grantsOf(deployment)).toEqual([...KINDS.map((kind) => `${kind} ${open}`), 'topic stock-notices grantPublish', 'queue stock-restock PolicyStatement', 'queue stock-audit PolicyStatement']);
  });

  it('reads nothing the app attaches to a role imported as one that takes nothing', () => {
    const deployment = stack(`
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const role = iam.Role.fromRoleArn(this, 'MoveRole', 'arn:aws:iam::111122223333:role/stock-mover', { mutable: false });
    role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [restock.queueArn] }));
    restock.grantSendMessages(role);
    const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });`);
    // The statement added to the role is dropped; the grant goes onto the queue's own
    // policy, the stack's account not being written and so not the role's (P316).
    const grants = grantsOf(deployment);
    expect(grants.filter((each) => !each.includes('open: the role arn:aws:iam::111122223333:role/stock-mover is imported by its ARN'))).toEqual([
      "queue stock-restock grantSendMessages, on the queue's own policy",
    ]);
    expect(grants).toHaveLength(KINDS.length + 1);
  });
});

describe("a grant to a role imported as one that takes nothing, written into the resource's own policy (P316)", () => {
  const grantsOf = (deployment: Deployment): string[] =>
    (deployment.functions[0]?.grants ?? []).filter((each) => each.unread === undefined).map(({ kind, name, by }) => `${kind} ${name ?? '?'} ${by}`);
  const ROLE = "const role = iam.Role.fromRoleArn(this, 'MoveRole', 'arn:aws:iam::111122223333:role/stock-mover', { mutable: false });";
  const MOVE = "const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });";

  it('reads a grant of a queue, a topic, a bucket and a function the app creates, and none of a table or a queue it imports', () => {
    const deployment = stack(`${ROLE}
    ${MOVE}
    new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' }).grantSendMessages(role);
    new sns.Topic(this, 'Notices', { topicName: 'stock-notices' }).grantPublish(role);
    new cdk.aws_s3.Bucket(this, 'Labels', { bucketName: 'stock-labels' }).grantPut(role);
    new lambda.Function(this, 'Count', { functionName: 'stock-count', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'count.handler' }).grantInvoke(role);
    new cdk.aws_dynamodb.Table(this, 'Ledger', { tableName: 'stock-ledger', partitionKey: { name: 'id', type: cdk.aws_dynamodb.AttributeType.STRING } }).grantWriteData(role);
    sqs.Queue.fromQueueArn(this, 'Elsewhere', 'arn:aws:sqs:eu-west-1:444455556666:stock-elsewhere').grantSendMessages(role);`);
    expect(grantsOf(deployment)).toEqual([
      "queue stock-restock grantSendMessages, on the queue's own policy",
      "topic stock-notices grantPublish, on the topic's own policy",
      "bucket stock-labels grantPut, on the bucket's own policy",
      "function stock-count grantInvoke, on the function's own policy",
    ]);
  });

  it("reads none where the resource's stack is in the role's account, nor where its account is read only once the app runs", () => {
    for (const account of ["'111122223333'", 'process.env.CDK_DEFAULT_ACCOUNT']) {
      const deployment = stack(`${ROLE}
    const same = new cdk.Stack(scope, 'Same', { env: { account: ${account}, region: 'eu-west-1' } });
    new sqs.Queue(same, 'Restock', { queueName: 'stock-restock' }).grantSendMessages(role);
    ${MOVE}`);
      expect(grantsOf(deployment)).toEqual([]);
    }
    const other = stack(`${ROLE}
    const away = new cdk.Stack(scope, 'Away', { env: { account: '999988887777', region: 'eu-west-1' } });
    new sqs.Queue(away, 'Restock', { queueName: 'stock-restock' }).grantSendMessages(role);
    ${MOVE}`);
    expect(grantsOf(other)).toEqual(["queue stock-restock grantSendMessages, on the queue's own policy"]);
  });
});

describe("a grant of a bus, a table or a stream to a role that takes nothing, by the version of the CDK (P322)", () => {
  const grantsOf = (deployment: Deployment): string[] =>
    (deployment.functions[0]?.grants ?? [])
      .filter((each) => each.unread === undefined || !each.unread.includes('the policies the account attaches'))
      .map(({ kind, name, unread, by }) => `${kind} ${name ?? `open: ${unread ?? '?'}`} ${by}`);
  const ROLE = (options: string): string => `const role = iam.Role.fromRoleArn(this, 'MoveRole', 'arn:aws:iam::111122223333:role/stock-mover', ${options});`;
  const MOVE = "const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });";
  const TABLE_AND_STREAM = `new cdk.aws_dynamodb.Table(this, 'Ledger', { tableName: 'stock-ledger', partitionKey: { name: 'id', type: cdk.aws_dynamodb.AttributeType.STRING } }).grantWriteData(role);
    new cdk.aws_kinesis.Stream(this, 'Moves', { streamName: 'stock-moves' }).grantWrite(role);`;
  const pinned = (version: string): Record<string, string> => ({
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/aws-cdk-lib': { version } } }),
  });
  const asked = (version: string): Record<string, string> => ({ 'package.json': JSON.stringify({ dependencies: { 'aws-cdk-lib': version } }) });

  it("reads a table's and a stream's grant on its own policy where the version installed writes it there, and none where it does not", () => {
    const body = `${ROLE('{ mutable: false }')}\n    ${MOVE}\n    ${TABLE_AND_STREAM}`;
    expect(grantsOf(stack(body, pinned('2.230.0')))).toEqual([
      "table stock-ledger grantWriteData, on the table's own policy",
      "stream stock-moves grantWrite, on the stream's own policy",
    ]);
    expect(grantsOf(stack(body, pinned('2.190.0')))).toEqual(["stream stock-moves grantWrite, on the stream's own policy"]);
    expect(grantsOf(stack(body, asked('2.170.0')))).toEqual([]);
    expect(grantsOf(stack(body, asked('~2.150.0')))).toEqual([]);
  });

  it("reads a table created with a resource policy's grant from 2.144.0, and leaves a range the version may fall either side of unread", () => {
    const body = `${ROLE('{ mutable: false }')}\n    ${MOVE}
    new cdk.aws_dynamodb.Table(this, 'Ledger', { tableName: 'stock-ledger', partitionKey: { name: 'id', type: cdk.aws_dynamodb.AttributeType.STRING }, resourcePolicy: new iam.PolicyDocument({ statements: [] }) }).grantWriteData(role);
    new cdk.aws_kinesis.Stream(this, 'Moves', { streamName: 'stock-moves' }).grantWrite(role);`;
    expect(grantsOf(stack(body, asked('^2.150.0')))).toEqual([
      "table stock-ledger grantWriteData, on the table's own policy",
      "stream open: a grant to a role that takes nothing is written into the stream's own policy from aws-cdk-lib 2.180.0, and aws-cdk-lib ^2.150.0 (package.json) does not settle which the app is built with grantWrite",
    ]);
    expect(grantsOf(stack(`${ROLE('{ mutable: false }')}\n    ${MOVE}\n    ${TABLE_AND_STREAM}`))).toEqual([
      "table open: a grant to a role that takes nothing is written into the table's own policy from aws-cdk-lib 2.222.0, and no file of the repository pins the version the app is built with grantWriteData",
      "stream open: a grant to a role that takes nothing is written into the stream's own policy from aws-cdk-lib 2.180.0, and no file of the repository pins the version the app is built with grantWrite",
    ]);
  });

  it("reads a bus's grantPutEventsTo on its policy only where the role asks for its grants on the resource, a statement id is handed and the flag is on", () => {
    const files = (flag: boolean): Record<string, string> => ({
      'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts', context: { '@aws-cdk/aws-events:requireEventBusPolicySid': flag } }),
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n\npackages:\n\n  aws-cdk-lib@2.190.0:\n    resolution: {integrity: sha512-x}\n",
    });
    const bus = (options: string, sid: string): string =>
      `${ROLE(options)}\n    ${MOVE}\n    new cdk.aws_events.EventBus(this, 'Moves', { eventBusName: 'stock-moves' }).grantPutEventsTo(role${sid});`;
    expect(grantsOf(stack(bus('{ mutable: false, addGrantsToResources: true }', ", 'StockMover'"), files(true)))).toEqual([
      "bus stock-moves grantPutEventsTo, on the bus's own policy",
    ]);
    expect(grantsOf(stack(bus('{ mutable: false, addGrantsToResources: true }', ", 'StockMover'"), files(false)))).toEqual([]);
    expect(grantsOf(stack(bus('{ mutable: false, addGrantsToResources: true }', ''), files(true)))).toEqual([]);
    expect(grantsOf(stack(bus('{ mutable: false }', ", 'StockMover'"), files(true)))).toEqual([]);
  });

  it("leaves a bus's grant unread where the statement id it is handed may be none, and takes one a deployment publishes as given (P328)", () => {
    const files: Record<string, string> = {
      'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts', context: { '@aws-cdk/aws-events:requireEventBusPolicySid': true } }),
      'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/aws-cdk-lib': { version: '2.190.0' } } }),
    };
    const bus = (sid: string): string =>
      `${ROLE('{ mutable: false, addGrantsToResources: true }')}\n    ${MOVE}\n    new cdk.aws_events.EventBus(this, 'Moves', { eventBusName: 'stock-moves' }).grantPutEventsTo(role, ${sid});`;
    const [fromEnv] = grantsOf(stack(bus('process.env.MOVER_SID'), files));
    expect(fromEnv).toMatch(/^bus open: the bus's policy takes the grant only with a statement id, and the one it is handed is not read: .*MOVER_SID.* grantPutEventsTo$/);
    expect(grantsOf(stack(bus('null'), files))).toEqual([]);
    expect(grantsOf(stack(bus("''"), files))).toEqual(["bus stock-moves grantPutEventsTo, on the bus's own policy"]);
    expect(grantsOf(stack(bus("cdk.Fn.importValue('mover-sid')"), files))).toEqual(["bus stock-moves grantPutEventsTo, on the bus's own policy"]);
  });

  it("leaves a bus's grant unread where its statement id is a context value no file sets, held or handed straight, and reads one a file sets (P332)", () => {
    const files = (context: Record<string, unknown> = {}): Record<string, string> => ({
      'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts', context: { '@aws-cdk/aws-events:requireEventBusPolicySid': true, ...context } }),
      'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/aws-cdk-lib': { version: '2.190.0' } } }),
    });
    const bus = (before: string, sid: string): string =>
      `${ROLE('{ mutable: false, addGrantsToResources: true }')}\n    ${MOVE}\n    ${before}\n    new cdk.aws_events.EventBus(this, 'Moves', { eventBusName: 'stock-moves' }).grantPutEventsTo(role, ${sid});`;
    const chosen = /^bus open: the bus's policy takes the grant only with a statement id, and the one it is handed is the context value moverSid, which no file sets: the deployment gives it when the app is synthesized \(-c moverSid=\.\.\.\) or leaves it out: given, the grant is written into the policy; left out, it is dropped grantPutEventsTo$/;
    for (const [before, sid] of [
      ['', "this.node.tryGetContext('moverSid')"],
      ["const sid = this.node.tryGetContext('moverSid');", 'sid'],
      ["const props = { sid: this.node.tryGetContext('moverSid') };", 'props.sid'],
      ["const pick = (given: string) => given;", "pick(this.node.tryGetContext('moverSid'))"],
    ]) {
      const [read, ...more] = grantsOf(stack(bus(before as string, sid as string), files()));
      expect(read).toMatch(chosen);
      expect(more).toEqual([]);
    }
    expect(grantsOf(stack(bus('', "this.node.tryGetContext('moverSid')"), files({ moverSid: 'StockMover' })))).toEqual(["bus stock-moves grantPutEventsTo, on the bus's own policy"]);
    expect(grantsOf(stack(bus('', "this.node.tryGetContext('moverSid') ?? 'StockMover'"), files()))).toEqual(["bus stock-moves grantPutEventsTo, on the bus's own policy"]);
  });

  it('reads a variable a context value no file sets gives as chosen when the app is run, written in the record or added (P332)', () => {
    const deployment = stack(`const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset('src'), handler: 'move.handler', environment: { STAGE: this.node.tryGetContext('stage'), REGION: this.node.tryGetContext('region') ?? 'eu-west-1' } });
    move.addEnvironment('TIER', this.node.tryGetContext('tier'));`);
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['STAGE']?.unread?.text).toBe('the context value stage, which no file sets: the deployment gives it when the app is synthesized (-c stage=...) or leaves it out');
    expect(environment['TIER']?.unread?.text).toBe('the context value tier, which no file sets: the deployment gives it when the app is synthesized (-c tier=...) or leaves it out');
    expect(environment['REGION']).toMatchObject({ text: 'eu-west-1' });
  });

  it('reads a resource name a context value no file sets gives as chosen when the app is run, at any depth of the record, and keeps a stage chosen as before (P336)', () => {
    const deployment = stack(`${FN}
    const restock = new sqs.Queue(this, 'Restock', { queueName: this.node.tryGetContext('restockQueue') });
    const props = { topicName: this.node.tryGetContext('notices') };
    const notices = new sns.Topic(this, 'Notices', props);
    restock.grantSendMessages(move);
    notices.grantPublish(move);`);
    expect(grantsOf(deployment)).toEqual([
      'queue open: the context value restockQueue, which no file sets: the deployment gives it when the app is synthesized (-c restockQueue=...) or leaves it out grantSendMessages',
      'topic open: the context value notices, which no file sets: the deployment gives it when the app is synthesized (-c notices=...) or leaves it out grantPublish',
    ]);
    const set = stack(`${FN}
    new sqs.Queue(this, 'Restock', { queueName: this.node.tryGetContext('restockQueue') }).grantSendMessages(move);`, { 'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts', context: { restockQueue: 'stock-restock' } }) });
    expect(grantsOf(set)).toEqual(['queue stock-restock grantSendMessages']);
  });

  it("puts a grant on the resource for a role asking for it in the stack's own account, and takes a role of another account than its stack's as one that takes nothing", () => {
    const same = stack(`const here = new cdk.Stack(scope, 'Here', { env: { account: '111122223333' } });
    const role = iam.Role.fromRoleArn(here, 'MoveRole', 'arn:aws:iam::111122223333:role/stock-mover', { mutable: false, addGrantsToResources: true });
    new sqs.Queue(here, 'Restock', { queueName: 'stock-restock' }).grantSendMessages(role);
    const move = new lambda.Function(here, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });`);
    expect(grantsOf(same)).toEqual(["queue stock-restock grantSendMessages, on the queue's own policy"]);
    const away = stack(
      `const away = new cdk.Stack(scope, 'Away', { env: { account: '999988887777' } });
    const role = iam.Role.fromRoleArn(away, 'MoveRole', 'arn:aws:iam::111122223333:role/stock-mover');
    const audit = new sqs.Queue(away, 'Audit', { queueName: 'stock-audit' });
    role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [audit.queueArn] }));
    new cdk.aws_dynamodb.Table(away, 'Ledger', { tableName: 'stock-ledger', partitionKey: { name: 'id', type: cdk.aws_dynamodb.AttributeType.STRING } }).grantWriteData(role);
    new cdk.aws_events.EventBus(away, 'Moves', { eventBusName: 'stock-moves' }).grantPutEventsTo(role);
    const move = new lambda.Function(away, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler', role });`,
      pinned('2.230.0'),
    );
    expect(grantsOf(away)).toEqual(["table stock-ledger grantWriteData, on the table's own policy"]);
  });
});
