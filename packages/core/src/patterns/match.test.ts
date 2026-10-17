import { Node, Project, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isParsed, parsePattern } from './parse.js';
import { matchPatternAt } from './match.js';
import { precedenceOf, precedenceRows } from './precedence.js';

const callIn = (code: string): CallExpression => {
  const file = new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', code);
  const call = file.getFirstDescendant((node) => Node.isCallExpression(node));
  if (call === undefined || !Node.isCallExpression(call)) throw new Error('no call');
  return call;
};

const fit = (pattern: string, code: string, types?: { want: string[]; is: string | undefined }) => {
  const parsed = parsePattern(pattern);
  if (!isParsed(parsed)) throw new Error(parsed.error);
  return matchPatternAt(parsed, callIn(code), types === undefined ? {} : { receiverTypes: types.want, receiverTypeOf: () => types.is });
};

describe('matchPatternAt', () => {
  it('fits a call and says what each hole caught, keys in any order', () => {
    const found = fit('$BUS.emit({ topic: $C, data: $P })', "bus.emit({ data: book, topic: 'book.added', extra: 1 })");
    expect(found.matched).toBe(true);
    expect(found.captures).toEqual({ $BUS: 'bus', $C: "'book.added'", $P: 'book' });
  });

  it('names the first part that does not fit: the method', () => {
    const found = fit('$BUS.emit($C)', 'bus.flush()');
    expect(found.matched).toBe(false);
    expect(found.steps.at(-1)).toMatchObject({ part: 'method', ok: false });
  });

  it('names the receiver type when it is the part that does not fit', () => {
    const found = fit('$BUS.emit($C)', "bus.emit('x')", { want: ['ShopBus'], is: 'OtherBus' });
    expect(found.steps.at(-1)).toMatchObject({ part: 'receiver type', ok: false, detail: 'OtherBus' });
  });

  it('holds a literal to what the call writes', () => {
    expect(fit("$A.call('POST', $U)", "api.call('GET', '/x')").steps.at(-1)).toMatchObject({ part: 'argument 0 of call()', ok: false });
    expect(fit("$A.call('POST', $U)", "api.call('POST', '/x')").matched).toBe(true);
  });

  it('walks a chain and a run of arguments', () => {
    const found = fit('$C.queue($Q).add($$$REST)', "client.queue('mail').add('send', job, opts)");
    expect(found.matched).toBe(true);
    expect(found.captures).toMatchObject({ $Q: "'mail'", '$$$REST': "'send', job, opts" });
  });
});

describe('precedenceOf', () => {
  const written = { describedBy: undefined, name: 'a' };
  const one = { describedBy: 'pattern:one', name: 'b' };
  const two = { describedBy: 'pattern:two', name: 'c' };
  const by = (each: { describedBy: string | undefined }) => each.describedBy;

  it('reads every written description and shadows the patterns', () => {
    const choice = precedenceOf([one, written], by);
    expect(choice).toEqual({ chosen: [written], shadowed: ['pattern:one'], ambiguous: [] });
    expect(precedenceRows(choice, { file: 'a.ts', line: 3, symbol: 'f -> bus.emit' }, 'a written bus').map((row) => [row.reason, row.level])).toEqual([
      ['pattern-shadowed', 'info'],
    ]);
  });

  it('reads one pattern alone, and none of two', () => {
    expect(precedenceOf([one], by).chosen).toEqual([one]);
    const choice = precedenceOf([one, two], by);
    expect(choice).toEqual({ chosen: [], shadowed: [], ambiguous: ['pattern:one', 'pattern:two'] });
    expect(precedenceRows(choice, { file: 'a.ts', line: 3, symbol: 's' }, undefined)[0]).toMatchObject({ reason: 'pattern-ambiguous', meta: { rules: ['one', 'two'] } });
  });
});
