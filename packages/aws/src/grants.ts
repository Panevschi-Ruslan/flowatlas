import { nameInForms, type DeployedKind } from '@flowatlas/core';
import { DEPLOYED_FORMS } from './deployed.js';

/**
 * What a permission lets a function send to, write to, invoke or start (P272).
 *
 * A function that does not say where it sends - a queue's URL looked up in a
 * cache the code fills when it runs - can still send only where its role lets
 * it. Every reader of a deployment meets that permission spelled as IAM
 * actions on resources, whether it is written as a statement, a policy
 * template that expands to statements, or a construct's grant that adds one;
 * the actions are stated once, here, as the kinds of thing each writes to.
 * Reading - receiving, describing, listing - is no send and is not here.
 */
export const WRITE_ACTIONS: { readonly [K in DeployedKind]: readonly string[] } = {
  queue: ['sqs:SendMessage', 'sqs:SendMessageBatch'],
  topic: ['sns:Publish', 'sns:PublishBatch'],
  bus: ['events:PutEvents'],
  table: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem', 'dynamodb:TransactWriteItems'],
  stream: ['kinesis:PutRecord', 'kinesis:PutRecords'],
  bucket: ['s3:PutObject', 's3:DeleteObject', 's3:DeleteObjectVersion'],
  function: ['lambda:InvokeFunction', 'lambda:InvokeAsync'],
  workflow: ['states:StartExecution', 'states:StartSyncExecution'],
};

/** An action as a pattern: IAM matches `*` and `?` in an action, case aside. */
const actionTest = (written: string): RegExp =>
  new RegExp(`^${written.split('').map((char) => (char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 'i');

/** The kinds of thing a list of actions, as a statement writes them, lets a function write to. */
export const kindsGranted = (actions: readonly string[]): DeployedKind[] => {
  const tests = actions.map(actionTest);
  return (Object.entries(WRITE_ACTIONS) as [DeployedKind, readonly string[]][])
    .filter(([, writes]) => writes.some((action) => tests.some((test) => test.test(action))))
    .map(([kind]) => kind);
};

/**
 * A resource of a statement that is every one of a kind rather than one
 * thing: `*`, or an ARN whose name part is a wildcard (`arn:aws:sqs:*`,
 * `arn:aws:sqs:eu-west-1:123456789012:*`, `arn:aws:dynamodb:*:*:table/*`).
 * A name with a wildcard inside it (`orders-*`) is several things too, and
 * none of them by name.
 */
export const isWildcardResource = (text: string): boolean => text.includes('*') || text.includes('?');

/** The service an ARN of each kind names in its third field. */
const SERVICE_OF: { readonly [K in DeployedKind]: string } = {
  queue: 'sqs',
  topic: 'sns',
  bus: 'events',
  table: 'dynamodb',
  stream: 'kinesis',
  bucket: 's3',
  function: 'lambda',
  workflow: 'states',
};

/**
 * What a resource written out grants of one kind (P272): one thing, by its
 * name; every one of the kind, as written; or nothing of the kind - another
 * service's ARN, or a part of one thing that is not written to (a table's
 * index or stream). A bucket is written to through its objects, so the ARN of
 * its objects (`arn:aws:s3:::uploads/*`) grants the bucket.
 */
export const grantedIn = (kind: DeployedKind, text: string): { readonly name: string } | { readonly any: string } | undefined => {
  if (text === '*') return { any: text };
  const arn = /^arn:[^:]*:([^:]*):/.exec(text);
  if (arn === null) return undefined;
  const service = arn[1] as string;
  if (service !== SERVICE_OF[kind] && !isWildcardResource(service)) return undefined;
  if (kind === 'bucket') {
    const bucket = /^arn:[^:]*:[^:]*:::([^/]+)(?:\/.*)?$/.exec(text)?.[1];
    if (bucket === undefined) return isWildcardResource(text) ? { any: text } : undefined;
    return isWildcardResource(bucket) ? { any: text } : { name: bucket };
  }
  if (kind === 'table') {
    const table = /^arn:[^:]*:[^:]*:[^:]*:[^:]*:table\/([^/]+)(\/.*)?$/.exec(text);
    if (table === null) return isWildcardResource(text) ? { any: text } : undefined;
    if (table[2] !== undefined) return undefined;
    return isWildcardResource(table[1] as string) ? { any: text } : { name: table[1] as string };
  }
  if (isWildcardResource(text)) return { any: text };
  const name = nameInForms(text, DEPLOYED_FORMS[kind]);
  return name === undefined ? undefined : { name };
};

/**
 * The managed policies AWS keeps that let a function write to everything of
 * a kind: a function given one of them can send anywhere of that kind, and a
 * grant of it bounds nothing.
 */
export const MANAGED_WRITE_POLICIES: Readonly<Record<string, readonly DeployedKind[]>> = {
  AmazonSQSFullAccess: ['queue'],
  AmazonSNSFullAccess: ['topic'],
  AmazonEventBridgeFullAccess: ['bus'],
  CloudWatchEventsFullAccess: ['bus'],
  AmazonKinesisFullAccess: ['stream'],
  AmazonDynamoDBFullAccess: ['table'],
  AmazonS3FullAccess: ['bucket'],
  AWSLambda_FullAccess: ['function'],
  AWSLambdaRole: ['function'],
  AWSStepFunctionsFullAccess: ['workflow'],
  AdministratorAccess: ['queue', 'topic', 'bus', 'stream', 'table', 'bucket', 'function', 'workflow'],
  PowerUserAccess: ['queue', 'topic', 'bus', 'stream', 'table', 'bucket', 'function', 'workflow'],
};

/** A managed policy's name, from its name or its ARN (`arn:aws:iam::aws:policy/service-role/AWSLambdaRole`). */
export const managedPolicyName = (text: string): string => text.slice(text.lastIndexOf('/') + 1);
