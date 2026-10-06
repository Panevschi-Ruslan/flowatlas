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
