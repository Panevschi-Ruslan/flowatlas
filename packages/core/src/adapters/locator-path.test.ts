import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { locatedExpressions, locatedSlots, locatorApplies, type NameLocator } from './locator.js';

/**
 * A path through an argument, and through what a class is constructed with.
 *
 * The shape a client that sends commands is written in: the name two and three
 * keys inside the input, often inside a list, and the input handed to a
 * constructor in the call or in a constant a statement earlier.
 */
const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);

const callTo = (file: SourceFile, method: string): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((item) => item.getExpression().getText().endsWith(`.${method}`));
  if (call === undefined) throw new Error(`no .${method}() in the source`);
  return call;
};

/** Each slot as text: what it reached, where it stopped, or nothing written. */
const slots = (site: CallExpression, locator: NameLocator): (string | undefined)[] =>
  locatedSlots(site, locator).map((slot) =>
    slot === undefined ? undefined : `${slot.reached ? '' : 'stopped at '}${slot.expression.getText()}`,
  );

const DETAIL_TYPE: NameLocator = {
  kind: 'constructed-argument-path',
  class: 'PutCommand',
  path: ['Entries', '*', 'DetailType'],
};

describe('a path through what a class is constructed with', () => {
  it('reads a command built in the call that sends it', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [{ DetailType: 'LoanCreated' }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads a command built in a constant and sent a statement later', () => {
    const file = parse(`const command = new PutCommand({ Entries: [{ DetailType: 'LoanCreated' }] });
client.send(command);`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads a class reached through a namespace', () => {
    const file = parse(`client.send(new sdk.PutCommand({ Entries: [{ DetailType: 'LoanCreated' }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads one slot per element of a list, in order', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [
  { DetailType: 'HoldPlaced' },
  { DetailType: 'HoldQueued' },
] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'HoldPlaced'", "'HoldQueued'"]);
  });

  it('follows records and lists kept in constants', () => {
    const file = parse(`const entry = { DetailType: 'LoanCreated' };
const input = { Entries: [entry] } as const;
client.send(new PutCommand(input));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('follows a shorthand property to the constant it copies', () => {
    const file = parse(`const Entries = [{ DetailType: 'LoanCreated' }];
client.send(new PutCommand({ Entries }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  // The name at the end is handed over as written: whether it is a literal, a
  // constant or a member of a shared enum is for the reader of names to say.
  it('hands the name over as written, not as the value it is bound to', () => {
    const file = parse(`const LOAN_CREATED = 'LoanCreated';
client.send(new PutCommand({ Entries: [{ DetailType: LOAN_CREATED }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(['LOAN_CREATED']);
  });

  // Kept rather than dropped, so a sibling path over the same list stays on the
  // same index: the second entry's bus is the second entry's.
  it('keeps an element that does not write the key, as nothing written', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [
  { DetailType: 'HoldPlaced' },
  { Bus: 'library', DetailType: 'HoldQueued' },
] }));`);
    const bus: NameLocator = { kind: 'constructed-argument-path', class: 'PutCommand', path: ['Entries', '*', 'Bus'] };
    expect(slots(callTo(file, 'send'), bus)).toEqual([undefined, "'library'"]);
  });

  it('stops at a list that is not written out, and says where', () => {
    const file = parse(`client.send(new PutCommand({ Entries: entries.map((each) => each) }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(['stopped at entries.map((each) => each)']);
  });

  it('stops at a spread element of a list', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [...more] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(['stopped at ...more']);
  });

  // A spread may be where the key comes from, so the key is not absent: calling
  // it absent would let a description fill in a default for a value written
  // somewhere else.
  it('stops at a spread written after the key could have been', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [{ ...defaults }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(['stopped at defaults']);
  });

  it('reads a key written after a spread, which wins', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [{ ...defaults, DetailType: 'LoanCreated' }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads a quoted key as the key it spells', () => {
    const file = parse(`client.send(new PutCommand({ 'Entries': [{ "DetailType": 'LoanCreated' }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads a later argument of the constructor', () => {
    const file = parse(`bus.put(new LibraryEvent('library.loans', { type: 'LoanCreated' }));`);
    expect(
      slots(callTo(file, 'put'), { kind: 'constructed-argument-path', class: 'LibraryEvent', index: 1, path: ['type'] }),
    ).toEqual(["'LoanCreated'"]);
  });

  it('reads the constructor argument itself when the path is empty', () => {
    const file = parse(`bus.put(new LibraryEvent('LoanCreated'));`);
    expect(
      slots(callTo(file, 'put'), { kind: 'constructed-argument-path', class: 'LibraryEvent', path: [] }),
    ).toEqual(["'LoanCreated'"]);
  });

  it('reads nothing written when the constructor is given nothing', () => {
    const file = parse(`bus.put(new LibraryEvent());`);
    expect(
      slots(callTo(file, 'put'), { kind: 'constructed-argument-path', class: 'LibraryEvent', path: ['type'] }),
    ).toEqual([undefined]);
  });
});

describe('a path through a plain argument', () => {
  it('reads it the same way', () => {
    const file = parse(`client.putEvents({ Entries: [{ DetailType: 'LoanRenewed' }] });`);
    expect(
      slots(callTo(file, 'putEvents'), { kind: 'argument-path', index: 0, path: ['Entries', '*', 'DetailType'] }),
    ).toEqual(["'LoanRenewed'"]);
  });

  it('reaches nothing when the argument is not there', () => {
    const file = parse(`client.putEvents();`);
    expect(slots(callTo(file, 'putEvents'), { kind: 'argument-path', index: 0, path: ['Entries'] })).toEqual([]);
  });

  it('stops at an argument that is not a record', () => {
    const file = parse(`client.putEvents(input);`);
    expect(slots(callTo(file, 'putEvents'), { kind: 'argument-path', index: 0, path: ['Entries'] })).toEqual([
      'stopped at input',
    ]);
  });

  it('hands every element to the first-match reading as well', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [{ DetailType: 'A' }, { DetailType: 'B' }] }));`);
    expect(locatedExpressions(callTo(file, 'send'), [DETAIL_TYPE]).map((node) => node.getText())).toEqual([
      "'A'",
      "'B'",
    ]);
  });
});

describe('a locator that names the class it reads', () => {
  const PUT: NameLocator = { kind: 'constructed-argument-path', class: 'PutCommand', path: ['Name'] };

  it('applies to a call handed that class', () => {
    const file = parse(`client.send(new PutCommand({ Name: 'a' }));`);
    expect(locatorApplies(callTo(file, 'send'), PUT)).toBe(true);
  });

  it('does not apply to a call handed another, and reaches nothing there', () => {
    const file = parse(`client.send(new ReceiveCommand({ Name: 'a' }));`);
    expect(locatorApplies(callTo(file, 'send'), PUT)).toBe(false);
    expect(locatedSlots(callTo(file, 'send'), PUT)).toEqual([]);
  });

  // Of the shape, with its address not written here: the caller reports it,
  // rather than reading the call as some other operation.
  it('applies to a value the checker says is one, and stops at it', () => {
    const file = parse(`class PutCommand { constructor(readonly input: { Name: string }) {} }
const forward = (command: PutCommand) => client.send(command);`);
    const site = callTo(file, 'send');
    expect(locatorApplies(site, PUT)).toBe(true);
    expect(slots(site, PUT)).toEqual(['stopped at command']);
  });

  // With nothing installed the checker knows no such class, and the annotation
  // is the one statement left of what the value is.
  it('applies to a value annotated with the class when the class is declared nowhere', () => {
    const file = parse(`const forward = (command: sdk.PutCommand) => client.send(command);`);
    const site = callTo(file, 'send');
    expect(locatorApplies(site, PUT)).toBe(true);
    expect(slots(site, PUT)).toEqual(['stopped at command']);
  });

  it('applies everywhere for every other kind of locator', () => {
    const file = parse(`client.send('a');`);
    expect(locatorApplies(callTo(file, 'send'), { kind: 'argument', index: 0 })).toBe(true);
  });
});

describe('a key of every node of a tree, and records built further in (P286)', () => {
  const QUEUES: NameLocator = { kind: 'argument-tree', index: 0, key: 'queueName', children: 'children' };

  it('reads the root first and each child after its parent', () => {
    const file = parse(`flows.add({ queueName: 'close', children: [
  { queueName: 'archive', children: [{ queueName: 'compress' }] },
  { queueName: 'notify' },
] });`);
    expect(slots(callTo(file, 'add'), QUEUES)).toEqual(["'close'", "'archive'", "'compress'", "'notify'"]);
  });

  it('reads each tree of a list, and stops at a list of children not written out', () => {
    const file = parse(`declare const later: unknown[];
flows.addBulk([{ queueName: 'a' }, { queueName: 'b', children: later }]);`);
    expect(slots(callTo(file, 'addBulk'), { ...QUEUES, path: ['*'] })).toEqual(["'a'", "'b'", 'stopped at later']);
  });

  it('reads a key through a record spread in from what a method of the class builds', () => {
    const file = parse(`class Jobs {
  run(type: string) { return flows.add({ ...this.node(type), children: [] }); }
  private node(kind: string) { return { name: 'job', queueName: kind }; }
}`);
    // The method's parameter is what the call hands it: `run`'s own `type`.
    expect(slots(callTo(file, 'add'), QUEUES)).toEqual(['type']);
  });

  it('reads a queue made by a class a condition chooses, set in another method', () => {
    const file = parse(`class Client {
  private queue: Queue;
  open(topic: string) {
    const Made = paid ? PaidQueue : Queue;
    this.queue = new Made(topic);
  }
  add(job: string) { return this.queue.add(job); }
}`);
    expect(slots(callTo(file, 'add'), { kind: 'receiver-constructed-path', class: 'Queue', path: [] })).toEqual(['topic']);
  });

  it('reads each record a function may answer, awaited', () => {
    const file = parse(`async function build(kind: boolean) {
  if (kind) return { type: 'a' };
  return { type: 'b' };
}
async function run() { queue.send(await build(true)); }`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(["'a'", "'b'"]);
  });
});

describe('a tree built in a loop, lists filled by push, an element by its place (P290)', () => {
  const QUEUES: NameLocator = { kind: 'argument-tree', index: 0, key: 'queueName', children: 'children' };

  it('reads a tree a let holds, reassigned in a loop, once for each record it is given', () => {
    const file = parse(`function chain(...jobs: { type: string }[]) {
  let last;
  for (const job of jobs) {
    last = { name: 'job', queueName: job.type, children: last ? [last] : [] };
  }
  return flows.add(last);
}`);
    // The child is the record the loop built before: read once, not again under itself.
    expect(slots(callTo(file, 'add'), QUEUES)).toEqual(['job.type']);
  });

  it('reads each value a let is given, and not one also changed in place', () => {
    const given = parse(`let kind = 'a';
if (later) kind = 'b';
queue.send([kind]);`);
    expect(slots(callTo(given, 'send'), { kind: 'argument-path', index: 0, path: ['*'] })).toEqual(['kind']);
    const counted = parse(`let kind = 'a';
kind += 'b';
queue.send({ type: kind });`);
    expect(slots(callTo(counted, 'send'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(['kind']);
    const chosen = parse(`let record = { type: 'a' };
if (later) record = { type: 'b' };
queue.send(record);`);
    expect(slots(callTo(chosen, 'send'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(["'a'", "'b'"]);
    const changed = parse(`let record = { type: 'a' };
[record] = others;
queue.send(record);`);
    expect(slots(callTo(changed, 'send'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(['stopped at record']);
  });

  it('reads the elements a list is written with and those pushed onto it, spread lists included', () => {
    const file = parse(`function more() { return [{ type: 'c' }]; }
const jobs = [{ type: 'a' }];
jobs.push({ type: 'b' });
jobs.push(...more());
queue.send(jobs);`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['*', 'type'] })).toEqual(["'a'", "'b'", "'c'"]);
  });

  it('reads every list a method may answer spread into a list, one it fills with push included', () => {
    const file = parse(`class OrderUpdater {
  private receipts(changed: boolean) {
    const jobs = [];
    if (changed) jobs.push({ type: 'receipt' });
    return jobs;
  }
  private notices(any: boolean) {
    if (!any) return [];
    return [{ type: 'notice' }];
  }
  run() {
    const jobs = [];
    jobs.push(...this.receipts(true));
    jobs.push(...this.notices(false));
    queue.send(jobs);
  }
}`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['*', 'type'] })).toEqual(["'receipt'", "'notice'"]);
  });

  it('reads the children of a flow mapped by a method, each child as the method builds it', () => {
    const file = parse(`class Jobs {
  run(parent: { type: string }, children: { type: string }[]) {
    return flows.add({ ...this.node(parent), children: children.map((child) => this.node(child)) });
  }
  private node(job: { type: string }) { return { name: 'job', queueName: job.type }; }
}`);
    expect(slots(callTo(file, 'add'), QUEUES)).toEqual(['job.type', 'job.type']);
  });

  it('reads each branch of a condition a list is chosen by, a list of none none', () => {
    const file = parse(`queue.send(urgent ? [{ type: 'a' }, { type: 'b' }] : []);`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['*', 'type'] })).toEqual(["'a'", "'b'"]);
  });

  it('reads an element by its place, where nothing spread in before it moves it', () => {
    const file = parse(`queue.send([{ type: 'a' }, { type: 'b' }]);
queue.publish([...others, { type: 'b' }]);`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['1', 'type'] })).toEqual(["'b'"]);
    expect(slots(callTo(file, 'publish'), { kind: 'argument-path', index: 0, path: ['1', 'type'] })).toEqual([
      "stopped at [...others, { type: 'b' }]",
    ]);
  });
});
