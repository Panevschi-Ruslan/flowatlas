import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkReader } from './index.js';

/** What a CDK app grants a function (P272). */
const stack = (body: string): Deployment => {
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
    const grants = grantsOf(deployment);
    expect(grants).toHaveLength(KINDS.length);
    expect(grants.every((each) => each.includes('open: the role arn:aws:iam::111122223333:role/stock-mover is imported by its ARN'))).toBe(true);
  });
});
