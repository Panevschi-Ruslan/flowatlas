import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, type CallPattern } from '@flowatlas/core';
import { Node, Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { afterAll, describe, expect, it } from 'vitest';
import { appliesAt, readAddress } from '../address.js';
import { functionEvidence, methodMatches, receiverEvidence, type ReceiverEvidence } from '../call-site.js';
import { isResolved } from '../channel-name.js';
import { awsBrokerAdapters, eventChannel, queueChannel, topicChannel } from './aws.js';
import { createCustomBrokerAdapter } from './index.js';
import type { BrokerSpec } from './types.js';

/**
 * The SDK's clients, declared the way their packages declare them, as far as a
 * call is concerned. Installed in an in-memory `node_modules`, so a receiver's
 * package is the checker's answer; left out, it is the source's.
 */
const STUBS: Record<string, string> = {
  '@aws-sdk/client-eventbridge': `
export declare class PutEventsCommand { constructor(input: { Entries: { EventBusName?: string; Source?: string; DetailType?: string; Detail?: string }[] }); }
export declare class EventBridgeClient { constructor(config: object); send(command: unknown): Promise<unknown>; }
export declare class EventBridge extends EventBridgeClient { putEvents(input: { Entries: object[] }): Promise<unknown>; }`,
  '@aws-sdk/client-sqs': `
export declare class SendMessageCommand { constructor(input: { QueueUrl?: string; MessageBody?: string }); }
export declare class SendMessageBatchCommand { constructor(input: { QueueUrl?: string; Entries: { Id: string; MessageBody?: string }[] }); }
export declare class ReceiveMessageCommand { constructor(input: { QueueUrl?: string }); }
export declare class SQSClient { constructor(config: object); send(command: unknown): Promise<unknown>; }`,
  '@aws-sdk/client-sns': `
export declare class PublishCommand { constructor(input: { TopicArn?: string; Message?: string }); }
export declare class PublishBatchCommand { constructor(input: { TopicArn?: string; PublishBatchRequestEntries: { Id: string; Message?: string }[] }); }
export declare class SNSClient { constructor(config: object); send(command: unknown): Promise<unknown>; }`,
  'aws-sdk': `
declare class Request<T> { promise(): Promise<T>; }
export declare class SQS { sendMessage(input: { QueueUrl: string; MessageBody: string }): Request<unknown>; }
export declare class SNS { publish(input: { TopicArn?: string; Message: string }): Request<unknown>; }
declare const AWS: { SQS: typeof SQS; SNS: typeof SNS };
export default AWS;`,
};

const project = (installed: boolean, source: string): SourceFile => {
  const files = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { esModuleInterop: true, strict: true },
  });
  if (installed) {
    for (const [name, declarations] of Object.entries(STUBS)) {
      files.createSourceFile(
        `/node_modules/${name}/package.json`,
        JSON.stringify({ name, version: '0.0.0', types: 'index.d.ts' }),
      );
      files.createSourceFile(`/node_modules/${name}/index.d.ts`, declarations);
    }
  }
  return files.createSourceFile('/src/a.ts', `declare const process: { env: Record<string, string | undefined> };\n${source}`);
};

interface Read {
  readonly adapter: string;
  readonly evidence: ReceiverEvidence;
  readonly names: string[];
  readonly payloads: (string | undefined)[];
}

/** What the descriptions read at the one call to `method`: the pattern the pass would take, and its addresses. */
const readCall = (file: SourceFile, method: string, specs: readonly BrokerSpec[] = awsBrokerAdapters): Read | undefined => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((each) => Node.isPropertyAccessExpression(each.getExpression()) && each.getExpression().getText().endsWith(`.${method}`)) as
    | CallExpression
    | undefined;
  if (call === undefined) throw new Error(`no .${method}()`);
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) throw new Error('not a method call');
  for (const spec of specs) {
    for (const pattern of spec.producerPatterns as CallPattern[]) {
      if (!methodMatches(callee.getName(), pattern.method)) continue;
      const evidence = receiverEvidence(callee.getExpression(), pattern);
      if (evidence === undefined || !appliesAt(call, pattern)) continue;
      const elements = readAddress(
        call,
        pattern.address ?? [{ at: pattern.channel ?? [] }],
        pattern.payload,
        {},
        parseConfig({}),
        call.getText(),
      );
      return {
        adapter: spec.name,
        evidence,
        names: elements.flatMap((element) => (isResolved(element.resolution) ? [...element.resolution.names] : [])),
        payloads: elements.map((element) => element.payload?.getText()),
      };
    }
  }
  return undefined;
};

describe('the channel grammar', () => {
  it('names each service and the default bus explicitly', () => {
    expect(queueChannel('returns')).toBe('sqs/returns');
    expect(topicChannel('borrower-notifications')).toBe('sns/borrower-notifications');
    expect(eventChannel(undefined, 'library.loans', 'LoanCreated')).toBe('eventbridge/default/library.loans/LoanCreated');
  });
});

describe('a command sent to a client', () => {
  it('reads every entry of a PutEvents as an event of its own, on its own bus', () => {
    const file = project(
      true,
      `import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
declare const hold: { holdId: string };
const events = new EventBridgeClient({});
const command = new PutEventsCommand({ Entries: [
  { Source: 'library.holds', DetailType: 'HoldPlaced', Detail: JSON.stringify(hold) },
  { EventBusName: 'arn:aws:events:eu-west-1:111122223333:event-bus/library', Source: 'library.holds', DetailType: 'HoldQueued' },
] });
events.send(command);`,
    );
    expect(readCall(file, 'send')).toEqual({
      adapter: 'aws-eventbridge',
      evidence: 'checked',
      names: [eventChannel(undefined, 'library.holds', 'HoldPlaced'), eventChannel('library', 'library.holds', 'HoldQueued')],
      payloads: ['hold', undefined],
    });
  });

  it('reads a queue by the name inside its URL', () => {
    const file = project(
      true,
      `import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
const sqs = new SQSClient({});
sqs.send(new SendMessageCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/returns', MessageBody: JSON.stringify({ itemId: 'a' }) }));`,
    );
    expect(readCall(file, 'send')).toMatchObject({ adapter: 'aws-sqs', names: [queueChannel('returns')] });
  });

  it('reads a batch to one queue as one address carrying the first entry', () => {
    const file = project(
      true,
      `import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
declare const a: { itemId: string };
const sqs = new SQSClient({});
sqs.send(new SendMessageBatchCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/returns', Entries: [{ Id: '1', MessageBody: JSON.stringify(a) }] }));`,
    );
    expect(readCall(file, 'send')).toMatchObject({ names: [queueChannel('returns')], payloads: ['a'] });
  });

  it('reads a topic by the name inside its ARN', () => {
    const file = project(
      true,
      `import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
const sns = new SNSClient({});
sns.send(new PublishCommand({ TopicArn: 'arn:aws:sns:eu-west-1:111122223333:borrower-notifications', Message: 'due' }));`,
    );
    expect(readCall(file, 'send')).toMatchObject({ adapter: 'aws-sns', names: [topicChannel('borrower-notifications')] });
  });

  // Receiving goes through the same `send`. It is another operation, not a
  // publish whose queue could not be read, so nothing describes it.
  it('reads nothing at a command that does not publish', () => {
    const file = project(
      true,
      `import { ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
const sqs = new SQSClient({});
sqs.send(new ReceiveMessageCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/returns' }));`,
    );
    expect(readCall(file, 'send')).toBeUndefined();
  });

  it('reads nothing at a send of a class this repository declares', () => {
    const file = project(
      true,
      `class SendMessageCommand { constructor(readonly input: { QueueUrl: string }) {} }
class Mailer { send(message: SendMessageCommand): void {} }
new Mailer().send(new SendMessageCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/returns' }));`,
    );
    expect(readCall(file, 'send')).toBeUndefined();
  });
});

describe('a client whose methods take the input', () => {
  it('reads the aggregated client of version 3', () => {
    const file = project(
      true,
      `import { EventBridge } from '@aws-sdk/client-eventbridge';
new EventBridge({}).putEvents({ Entries: [{ Source: 'library.loans', DetailType: 'LoanRenewed' }] });`,
    );
    expect(readCall(file, 'putEvents')).toMatchObject({
      names: [eventChannel(undefined, 'library.loans', 'LoanRenewed')],
    });
  });

  it('reads version 2, with promise() after it', () => {
    const file = project(
      true,
      `import AWS from 'aws-sdk';
const sqs = new AWS.SQS();
sqs.sendMessage({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/reminders', MessageBody: '{}' }).promise();`,
    );
    expect(readCall(file, 'sendMessage')).toMatchObject({ adapter: 'aws-sqs', evidence: 'checked', names: [queueChannel('reminders')] });
  });
});

/**
 * A fresh clone: nothing installed, every client `any` to the checker, and the
 * import beside the construction the only statement of what it is.
 */
describe('a client of a package that is not installed', () => {
  it('is read from its construction and its import, and says so', () => {
    const file = project(
      false,
      `import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
const sns = new SNSClient({});
sns.send(new PublishCommand({ TopicArn: 'arn:aws:sns:eu-west-1:111122223333:withdrawals', Message: 'gone' }));`,
    );
    expect(readCall(file, 'send')).toMatchObject({ evidence: 'stated', names: [topicChannel('withdrawals')] });
  });

  it('is read from a class property and from a namespace import of version 2', () => {
    const file = project(
      false,
      `import * as AWS from 'aws-sdk';
class Notices {
  private readonly sns = new AWS.SNS();
  withdraw() { return this.sns.publish({ TopicArn: 'arn:aws:sns:eu-west-1:111122223333:withdrawals', Message: 'gone' }).promise(); }
}`,
    );
    expect(readCall(file, 'publish')).toMatchObject({ adapter: 'aws-sns', evidence: 'stated', names: [topicChannel('withdrawals')] });
  });

  it('is read from a parameter annotated with the client', () => {
    const file = project(
      false,
      `import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
export const queue = (sqs: SQSClient) => sqs.send(new SendMessageCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/shelving', MessageBody: '{}' }));`,
    );
    expect(readCall(file, 'send')).toMatchObject({ evidence: 'stated', names: [queueChannel('shelving')] });
  });

  it('is read under the name the package exports it by', () => {
    const file = project(
      false,
      `import { SendMessageCommand, SQSClient as Queue } from '@aws-sdk/client-sqs';
new Queue({}).send(new SendMessageCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/shelving', MessageBody: '{}' }));`,
    );
    expect(readCall(file, 'send')).toMatchObject({ evidence: 'stated', names: [queueChannel('shelving')] });
  });

  it('is read through an import from another module of the repository', () => {
    const file = project(
      false,
      `import { PublishCommand } from '@aws-sdk/client-sns';
import { sns } from './clients';
sns.send(new PublishCommand({ TopicArn: 'arn:aws:sns:eu-west-1:111122223333:withdrawals', Message: 'gone' }));`,
    );
    file
      .getProject()
      .createSourceFile('/src/clients.ts', `import { SNSClient } from '@aws-sdk/client-sns';\nexport const sns = new SNSClient({});`);
    expect(readCall(file, 'send')).toMatchObject({ evidence: 'stated', names: [topicChannel('withdrawals')] });
  });

  it('is not read from a client that names no package', () => {
    const file = project(
      false,
      `declare const sqs: any;
sqs.send(new SendMessageCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/shelving' }));`,
    );
    expect(readCall(file, 'send')).toBeUndefined();
  });
});

/**
 * The SDK described the way a person would describe it, through the schema
 * that validates a configuration: the same locators, the same parts, the same
 * channel. What a person cannot say is which package the client is from, so
 * the class's name alone identifies it.
 */
describe('the same operation described in configuration', () => {
  it('reads the channel the built-in description reads', () => {
    const described = createCustomBrokerAdapter(
      parseConfig({
        adapters: {
          broker: {
            custom: [
              {
                name: 'queues',
                channelKind: 'queue',
                producers: [
                  {
                    receiverType: 'SQSClient',
                    method: 'send',
                    address: [
                      { literal: 'sqs' },
                      {
                        at: [{ kind: 'constructed-argument-path', class: 'SendMessageCommand', path: ['QueueUrl'] }],
                        forms: ['^https?://[^/]+/[^/]+/([^/?#]+)/?$'],
                      },
                    ],
                    payload: [{ kind: 'constructed-argument-path', class: 'SendMessageCommand', path: ['MessageBody'] }],
                    kind: 'message',
                  },
                ],
              },
            ],
          },
        },
      }).adapters.broker.custom[0]!,
    );
    const source = `import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
declare const item: { itemId: string };
new SQSClient({}).send(new SendMessageCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/returns', MessageBody: JSON.stringify(item) }));`;
    const builtIn = readCall(project(true, source), 'send');
    const fromConfiguration = readCall(project(true, source), 'send', [described]);
    expect(fromConfiguration?.names).toEqual(builtIn?.names);
    expect(fromConfiguration?.payloads).toEqual(['item']);
  });

  // The wrapper written as a function: the command is built by the caller and
  // handed over, so the call of the function is where the channel is written.
  it('reads a helper function by the name it is declared with', () => {
    const described = createCustomBrokerAdapter(
      parseConfig({
        adapters: {
          broker: {
            custom: [
              {
                name: 'helpers',
                producers: [
                  {
                    function: 'publishEvent',
                    address: [
                      { literal: 'eventbridge' },
                      {
                        at: [{ kind: 'constructed-argument-path', class: 'PutEventsCommand', path: ['Entries', '*', 'EventBusName'] }],
                        absent: 'default',
                      },
                      { at: [{ kind: 'constructed-argument-path', class: 'PutEventsCommand', path: ['Entries', '*', 'Source'] }] },
                      { at: [{ kind: 'constructed-argument-path', class: 'PutEventsCommand', path: ['Entries', '*', 'DetailType'] }] },
                    ],
                  },
                ],
              },
            ],
          },
        },
      }).adapters.broker.custom[0]!,
    );
    const file = project(
      false,
      `import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { publishEvent as publish } from './publish';
publish(new PutEventsCommand({ Entries: [{ Source: 'library.holds', DetailType: 'HoldCancelled' }] }));`,
    );
    file.getProject().createSourceFile('/src/publish.ts', `export const publishEvent = async (command: unknown) => command;`);
    const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'publish');
    const [pattern] = described.producerPatterns;
    expect(pattern?.calledAs).toBe('function');
    expect(functionEvidence(call!.getExpression(), pattern!.method)).toBe('checked');
    const [element] = readAddress(call!, pattern!.address ?? [], undefined, {}, parseConfig({}), '');
    expect(element?.resolution).toMatchObject({ names: [eventChannel(undefined, 'library.holds', 'HoldCancelled')] });
  });

  it('refuses a producer that is both a function and a method', () => {
    expect(() =>
      parseConfig({
        adapters: { broker: { custom: [{ name: 'x', producers: [{ function: 'f', receiverType: 'R', method: 'm' }] }] } },
      }),
    ).toThrow(/either a function/);
  });

  it('refuses a producer that names neither', () => {
    expect(() =>
      parseConfig({ adapters: { broker: { custom: [{ name: 'x', producers: [{ method: 'm' }] }] } } }),
    ).toThrow(/receiverType/);
  });

  it('refuses a form that is not a regular expression', () => {
    expect(() =>
      parseConfig({
        adapters: {
          broker: {
            custom: [
              {
                name: 'queues',
                producers: [{ receiverType: 'Q', method: 'send', address: [{ at: [{ kind: 'argument', index: 0 }], forms: ['('] }] }],
              },
            ],
          },
        },
      }),
    ).toThrow(/regular expression/);
  });
});

describe('detection', () => {
  const root = mkdtempSync(join(tmpdir(), 'flowatlas-aws-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const sns = awsBrokerAdapters.find((spec) => spec.name === 'aws-sns') as BrokerSpec;

  it('reads the root manifest', () => {
    expect(sns.detect({ dependencies: { '@aws-sdk/client-sns': '3' } })).toBe(true);
    expect(sns.detect({ dependencies: { express: '4' } })).toBe(false);
  });

  // A repository of functions keeps a manifest per function and declares the
  // client only there.
  it('reads a manifest kept beside one function', () => {
    mkdirSync(join(root, 'functions', 'notify'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'library', dependencies: { express: '4' } }));
    writeFileSync(
      join(root, 'functions', 'notify', 'package.json'),
      JSON.stringify({ name: 'notify', dependencies: { '@aws-sdk/client-sns': '3' } }),
    );
    expect(sns.detect({ dependencies: { express: '4' } }, undefined, root)).toBe(true);
  });

  it('does not read what is installed', () => {
    const other = mkdtempSync(join(tmpdir(), 'flowatlas-aws-'));
    mkdirSync(join(other, 'node_modules', 'x'), { recursive: true });
    writeFileSync(
      join(other, 'node_modules', 'x', 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { '@aws-sdk/client-sns': '3' } }),
    );
    expect(sns.detect({}, undefined, other)).toBe(false);
    rmSync(other, { recursive: true, force: true });
  });
});
