import { parseConfig, type AddressPart, type CallPattern } from '@flowatlas/core';
import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { addressOf, collapsed, nameWithin, readAddress } from './address.js';
import { isResolved } from './channel-name.js';

const config = parseConfig({});

const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile(
    'a.ts',
    `declare const process: { env: Record<string, string | undefined> };\n${source}`,
  );

const callTo = (file: SourceFile, method: string): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((item) => item.getExpression().getText().endsWith(`.${method}`));
  if (call === undefined) throw new Error(`no .${method}() in the source`);
  return call;
};

const entry = (field: string): AddressPart => ({
  at: [{ kind: 'constructed-argument-path', class: 'Put', path: ['Entries', '*', field] }],
});

/** A bus, a source and a kind of event: an address in three parts, one per entry. */
const EVENT: readonly AddressPart[] = [
  { literal: 'bus' },
  { ...entry('Bus'), absent: 'default', forms: ['^arn:bus/(.+)$'] },
  entry('Source'),
  entry('Type'),
];

const DETAIL = [{ kind: 'constructed-argument-path', class: 'Put', path: ['Entries', '*', 'Detail'] }] as const;

const read = (source: string, parts: readonly AddressPart[] = EVENT) =>
  readAddress(callTo(parse(source), 'send'), parts, DETAIL, {}, config, 'the call');

const names = (source: string, parts?: readonly AddressPart[]): string[][] =>
  read(source, parts).map((element) => (isResolved(element.resolution) ? [...element.resolution.names] : []));

describe('an address written in parts', () => {
  it('joins the parts with a slash, the stated word first', () => {
    expect(
      names(`client.send(new Put({ Entries: [{ Bus: 'library', Source: 'loans', Type: 'LoanCreated' }] }));`),
    ).toEqual([['bus/library/loans/LoanCreated']]);
  });

  it('reads one address per entry, each part at its own entry', () => {
    expect(
      names(`client.send(new Put({ Entries: [
  { Source: 'holds', Type: 'HoldPlaced' },
  { Bus: 'library', Source: 'holds', Type: 'HoldQueued' },
] }));`),
    ).toEqual([['bus/default/holds/HoldPlaced'], ['bus/library/holds/HoldQueued']]);
  });

  it('fills a part nothing writes with what the description says the library does', () => {
    expect(names(`client.send(new Put({ Entries: [{ Source: 'loans', Type: 'LoanCreated' }] }));`)).toEqual([
      ['bus/default/loans/LoanCreated'],
    ]);
  });

  it('reads a part through the longer spelling it is written inside', () => {
    expect(
      names(`client.send(new Put({ Entries: [{ Bus: 'arn:bus/library', Source: 'loans', Type: 'LoanCreated' }] }));`),
    ).toEqual([['bus/library/loans/LoanCreated']]);
  });

  // Half an address joins nothing it should: a part that is written and
  // cannot be read leaves the whole address unread, and never takes the default.
  it('leaves the address unread when one part is written and cannot be read', () => {
    const [element] = read(`declare const bus: string;
client.send(new Put({ Entries: [{ Bus: bus, Source: 'loans', Type: 'LoanCreated' }] }));`);
    expect(element?.resolution).toEqual({ unresolved: 'channel-const-unresolved', text: 'bus' });
  });

  it('refuses a part nothing writes when the description gives no default', () => {
    const [element] = read(`client.send(new Put({ Entries: [{ Source: 'loans' }] }));`);
    expect(element?.resolution).toEqual({ unresolved: 'channel-dynamic', text: 'the call' });
  });

  it('reads every combination of a part that can be several names', () => {
    expect(
      names(`declare const type: 'Created' | 'Renewed';
client.send(new Put({ Entries: [{ Source: 'loans', Type: \`Loan\${type}\` }] }));`),
    ).toEqual([['bus/default/loans/LoanCreated', 'bus/default/loans/LoanRenewed']]);
  });
});

describe('a part the deployment names', () => {
  it('names the variable, and says what the address is waiting on', () => {
    const [element] = read(
      `client.send(new Put({ Entries: [{ Bus: process.env.AUDIT_BUS, Source: 'loans', Type: 'LoanAudited' }] }));`,
    );
    expect(element?.resolution).toMatchObject({ unresolved: 'channel-from-environment', variable: 'AUDIT_BUS' });
    expect(element?.awaiting).toEqual([
      'bus',
      { environment: 'AUDIT_BUS', forms: ['^arn:bus/(.+)$'] },
      'loans',
      'LoanAudited',
    ]);
  });

  // Something else is unread as well, so one variable would not complete it,
  // and a reader of the deployment must not be told it would.
  it('says nothing is awaited when another part is built at run time too', () => {
    const [element] = read(`declare let type: string;
client.send(new Put({ Entries: [{ Bus: process.env.AUDIT_BUS, Source: 'loans', Type: type }] }));`);
    expect(element?.awaiting).toBeUndefined();
  });
});

describe('the message at each element', () => {
  const payloads = (source: string): (string | undefined)[] => read(source).map((element) => element.payload?.getText());

  it('reads what is stringified rather than the string', () => {
    expect(
      payloads(`declare const loan: { loanId: string };
client.send(new Put({ Entries: [{ Source: 'loans', Type: 'LoanCreated', Detail: JSON.stringify(loan) }] }));`),
    ).toEqual(['loan']);
  });

  it('sees through a constant holding the string', () => {
    expect(
      payloads(`declare const loan: { loanId: string };
const detail = JSON.stringify(loan);
client.send(new Put({ Entries: [{ Source: 'loans', Type: 'LoanCreated', Detail: detail }] }));`),
    ).toEqual(['loan']);
  });

  // An invocation's payload is bytes, made from the text by whichever call is to hand.
  it('reads what the bytes of a payload are made from', () => {
    expect(
      payloads(`declare const loan: { loanId: string };
client.send(new Put({ Entries: [
  { Source: 'loans', Type: 'A', Detail: Buffer.from(JSON.stringify(loan)) },
  { Source: 'loans', Type: 'B', Detail: new TextEncoder().encode(JSON.stringify(loan)) },
  { Source: 'loans', Type: 'C', Detail: Uint8Array.from(JSON.stringify(loan), (character) => character.charCodeAt(0)) },
] }));`),
    ).toEqual(['loan', 'loan', 'loan']);
  });

  it('reads each entry its own message', () => {
    expect(
      payloads(`declare const hold: { holdId: string };
client.send(new Put({ Entries: [
  { Source: 'holds', Type: 'HoldPlaced', Detail: JSON.stringify(hold) },
  { Source: 'holds', Type: 'HoldQueued', Detail: JSON.stringify({ holdId: hold.holdId }) },
] }));`),
    ).toEqual(['hold', '{ holdId: hold.holdId }']);
  });

  // Where the walk stopped is the type of something else, not of the message.
  it('reads no message where the entries are not written out', () => {
    expect(payloads(`declare const entries: unknown[];
client.send(new Put({ Entries: entries }));`)).toEqual([undefined]);
  });
});

describe('the address a description states, in each spelling', () => {
  const pattern = (overrides: Partial<CallPattern>): CallPattern => ({ method: 'send', channelArg: 0, ...overrides });

  it('reads channelArg as a one-part address', () => {
    expect(addressOf(pattern({ channelArg: 1 }))).toEqual([{ at: [{ kind: 'argument', index: 1 }] }]);
  });

  it('reads channel as a one-part address', () => {
    const channel = [{ kind: 'receiver' }] as const;
    expect(addressOf(pattern({ channelArg: -1, channel }))).toEqual([{ at: channel }]);
  });

  it('takes address over both', () => {
    const address = [{ literal: 'x' }];
    expect(addressOf(pattern({ channel: [{ kind: 'receiver' }], address }))).toBe(address);
  });

  it('reads a one-part address exactly as a channel was read before there were parts', () => {
    const file = parse(`declare const id: string;
bus.send(\`order:\${id}:created\`);`);
    expect(collapsed(readAddress(callTo(file, 'send'), addressOf(pattern({})), undefined, {}, config, ''))).toEqual({
      name: 'order:*:created',
      names: ['order:*:created'],
      via: 'template',
    });
  });
});

describe('a name inside a longer spelling', () => {
  const QUEUE = ['^https?://[^/]+/[^/]+/([^/?#]+)/?$'];

  it('takes the first group of the first form that matches', () => {
    expect(nameWithin('https://sqs.eu-west-1.amazonaws.com/111122223333/returns', QUEUE)).toBe('returns');
  });

  it('reads a pattern the same way, the part it leaves open dropped', () => {
    expect(nameWithin('https://sqs.*.amazonaws.com/*/returns', QUEUE)).toBe('returns');
  });

  it('leaves a name no form matches as it is written', () => {
    expect(nameWithin('returns', QUEUE)).toBe('returns');
  });
});
