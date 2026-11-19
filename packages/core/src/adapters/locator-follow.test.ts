import { Project, SyntaxKind, type CallExpression, type Node as TsNode, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { locatedSlots, type LocatorContext, type NameLocator } from './locator.js';

/**
 * What a path walks through on its way to a name (P268): a record a factory
 * builds, a member a lookup chooses, an element of a list, the values a `Map`
 * is given - and where it stops, the parameter that decides what it reads.
 */
const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } }).createSourceFile('a.ts', source);

const callTo = (file: SourceFile, method: string): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((item) => item.getExpression().getText().endsWith(`.${method}`));
  if (call === undefined) throw new Error(`no .${method}() in the source`);
  return call;
};

const slots = (site: CallExpression, locator: NameLocator, context: LocatorContext = {}): (string | undefined)[] =>
  locatedSlots(site, locator, context).map((slot) =>
    slot === undefined ? undefined : `${slot.reached ? '' : 'stopped at '}${slot.expression.getText()}`,
  );

const DETAIL_TYPE: NameLocator = { kind: 'constructed-argument-path', class: 'PutEventsCommand', path: ['Entries', '*', 'DetailType'] };
const BUS: NameLocator = { kind: 'constructed-argument-path', class: 'PutEventsCommand', path: ['Entries', '*', 'EventBusName'] };

const FACTORIES = `const BUS = 'shop-events';
const events = {
  Placed: (data: any) => ({ EventBusName: BUS, DetailType: 'Placed', Detail: JSON.stringify({ id: data.id }) }),
  Shipped(data: any) {
    const detail = { id: data.id };
    return { EventBusName: BUS, DetailType: 'Shipped', Detail: JSON.stringify(detail) };
  },
};
`;

describe('a record a factory builds', () => {
  it('reads the member a written key chooses, and what it answers', () => {
    const file = parse(`${FACTORIES}client.send(new PutEventsCommand({ Entries: [events['Placed']({ id: 1 })] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'Placed'"]);
    expect(slots(callTo(file, 'send'), BUS)).toEqual(['BUS']);
  });

  it('reads a member called by its name, a method written in the record', () => {
    const file = parse(`${FACTORIES}const entry = events.Shipped({ id: 1 });
client.send(new PutEventsCommand({ Entries: [entry] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'Shipped'"]);
  });

  it('reads a function called by its name, its parameters bound to what it is called with', () => {
    const file = parse(`const entryFor = (type: string) => ({ EventBusName: 'shop-events', DetailType: type });
client.send(new PutEventsCommand({ Entries: [entryFor('Refunded')] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'Refunded'"]);
  });

  it('stops at a member a parameter chooses, and names the parameter', () => {
    const file = parse(`${FACTORIES}export function emit(name: keyof typeof events, data: any) {
  const entry = events[name](data);
  return client.send(new PutEventsCommand({ Entries: [entry] }));
}`);
    const [slot] = locatedSlots(callTo(file, 'send'), DETAIL_TYPE);
    expect(slot?.reached).toBe(false);
    expect(slot?.expression.getText()).toBe('entry');
    expect(slot?.selector?.getName()).toBe('name');
  });

  it('reads that member where a caller binds the parameter', () => {
    const file = parse(`${FACTORIES}export function emit(name: keyof typeof events, data: any) {
  const entry = events[name](data);
  return client.send(new PutEventsCommand({ Entries: [entry] }));
}
emit('Shipped', { id: 2 });`);
    const site = callTo(file, 'send');
    const [slot] = locatedSlots(site, DETAIL_TYPE);
    const caller = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => call.getExpression().getText() === 'emit');
    const handed = caller?.getArguments()[0] as TsNode;
    const bound = new Map<TsNode, TsNode>([[slot?.selector as TsNode, handed]]);
    expect(slots(site, DETAIL_TYPE, { bound })).toEqual(["'Shipped'"]);
  });

  it('stops at a record a parameter is, and names the parameter', () => {
    const file = parse(`export const put = (entry: any) => client.send(new PutEventsCommand({ Entries: [entry] }));`);
    const [slot] = locatedSlots(callTo(file, 'send'), DETAIL_TYPE);
    expect(slot?.selector?.getName()).toBe('entry');
  });
});

describe('an element of a list', () => {
  const STREAM: NameLocator = { kind: 'constructed-argument-path', class: 'PutRecordCommand', path: ['StreamName'] };

  it('reads what the callback of a map answers, for each element a loop takes', () => {
    const file = parse(`export const forward = async (changes: any[]) => {
  const records = changes.filter((change) => change.kept).map((change) => {
    const image = change.image;
    return { StreamName: 'changes', Data: image };
  });
  for (const record of records) await kinesis.send(new PutRecordCommand(record));
};`);
    expect(slots(callTo(file, 'send'), STREAM)).toEqual(["'changes'"]);
  });

  it('reads an element a callback is handed', () => {
    const file = parse(`[{ StreamName: 'changes' }].forEach((record) => kinesis.send(new PutRecordCommand(record)));`);
    expect(slots(callTo(file, 'send'), STREAM)).toEqual(["'changes'"]);
  });

  it('reads the one value a Map is given, through its values', () => {
    const QUEUE: NameLocator = { kind: 'constructed-argument-path', class: 'SendMessageBatchCommand', path: ['QueueUrl'] };
    const file = parse(`const batches = new Map<string, any>();
batches.set('all', { QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/1/audit', Entries: [] });
for (const batch of Array.from(batches.values())) sqs.send(new SendMessageBatchCommand(batch));`);
    expect(slots(callTo(file, 'send'), QUEUE)).toEqual(["'https://sqs.eu-west-1.amazonaws.com/1/audit'"]);
  });

  it('reads a list of several elements as one address per element (P272)', () => {
    const file = parse(`for (const record of [{ StreamName: 'a' }, { StreamName: 'b' }]) kinesis.send(new PutRecordCommand(record));`);
    expect(slots(callTo(file, 'send'), STREAM)).toEqual(["'a'", "'b'"]);
  });

  it('reads a name that is an element of a list of several as each element (P272)', () => {
    const file = parse(`const A = 'orders';
const B = 'refunds';
for (const name of [A, B]) kinesis.send(new PutRecordCommand({ StreamName: name }));`);
    expect(slots(callTo(file, 'send'), STREAM)).toEqual(['A', 'B']);
  });

  it('reads every value a Map is made with and given, and a Set made with several (P272)', () => {
    const file = parse(`const byKind = new Map([['a', 'orders'], ['b', 'refunds']]);
byKind.set('c', 'returns');
for (const name of byKind.values()) kinesis.send(new PutRecordCommand({ StreamName: name }));
const names = new Set(['x', 'y']);
names.forEach((each) => kinesis.put(new PutRecordCommand({ StreamName: each })));`);
    expect(slots(callTo(file, 'send'), STREAM)).toEqual(["'orders'", "'refunds'", "'returns'"]);
    expect(slots(callTo(file, 'put'), STREAM)).toEqual(["'x'", "'y'"]);
  });

  it('reads what a map callback answers for each of several elements (P272)', () => {
    const file = parse(`const streams = ['orders', 'refunds'].map((name) => ({ StreamName: name }));
for (const record of streams) kinesis.send(new PutRecordCommand(record));`);
    expect(slots(callTo(file, 'send'), STREAM)).toEqual(["'orders'", "'refunds'"]);
  });

  it('stops at a list with a spread nothing reads', () => {
    const file = parse(`declare const more: any[];
for (const record of [{ StreamName: 'a' }, ...more]) kinesis.send(new PutRecordCommand(record));`);
    expect(slots(callTo(file, 'send'), STREAM)).toEqual(['stopped at record']);
  });
});
