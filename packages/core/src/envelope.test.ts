import { Project, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { ELEMENT, envelopePath, messageTypeAt, type Envelope } from './envelope.js';

const SOURCE = `
interface Loan { loanId: string }
interface Hold { itemId: string }
interface Wrapped<D> { detail: D }
interface Batch { Records: Array<{ body: string; meta: { note: string } }> }

export const forOf = async (event: Batch) => {
  for (const record of event.Records) JSON.parse(record.body) as Loan;
};
export const mapped = (event: Batch) => event.Records.map((record) => JSON.parse(record.body ?? '{}') as Loan);
export const destructured = (event: Batch) => {
  for (const { body } of event.Records) { const loan: Loan = JSON.parse(body); }
};
export const indexed = ({ Records }: Batch) => (JSON.parse(Records[0].body) as Loan);
export const twoAnswers = (event: Batch) => {
  for (const record of event.Records) { JSON.parse(record.body) as Loan; JSON.parse(record.body) as Hold; }
};
export const untyped = (event: Batch) => event.Records.map((record) => JSON.parse(record.body));
export const otherPath = (event: Batch) => event.Records.map((record) => JSON.parse(record.meta.note) as Loan);
export const value = (event: Wrapped<Loan>) => event.detail.loanId;
export const whole = (event: Loan) => event.loanId;
`;

const TEXT: Envelope = { at: ['Records', ELEMENT, 'body'], text: true };
const DETAIL: Envelope = { at: ['detail'], text: false };
const WHOLE: Envelope = { at: [], text: false };

describe('the message a function takes out of what it is handed', () => {
  let file: SourceFile;
  const read = (name: string, envelope: Envelope): string | undefined => {
    const fn = file.getVariableDeclarationOrThrow(name).getInitializerOrThrow();
    return messageTypeAt(fn, envelope)?.getText(fn);
  };

  beforeAll(() => {
    file = new Project({ useInMemoryFileSystem: true }).createSourceFile('handlers.ts', SOURCE);
  });

  it('reads text at a path through loops, callbacks, destructuring and indexes', () => {
    for (const name of ['forOf', 'mapped', 'destructured', 'indexed']) expect(read(name, TEXT), name).toBe('Loan');
  });

  it('answers nothing for two different parses, an untyped one, or text at another path', () => {
    expect(read('twoAnswers', TEXT)).toBeUndefined();
    expect(read('untyped', TEXT)).toBeUndefined();
    expect(read('otherPath', TEXT)).toBeUndefined();
  });

  it('reads a value at a path, or the whole parameter, off the declared type', () => {
    expect(read('value', DETAIL)).toBe('Loan');
    expect(read('whole', WHOLE)).toBe('Loan');
    expect(read('whole', DETAIL)).toBeUndefined();
  });

  it('spells a path the way the report spells a field', () => {
    expect(envelopePath(TEXT.at)).toBe('Records[].body');
    expect(envelopePath(['Records', ELEMENT, 'Sns', 'Message'])).toBe('Records[].Sns.Message');
    expect(envelopePath([])).toBe('');
  });
});
