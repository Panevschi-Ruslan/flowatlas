import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { builtQueryInAddress, builtQueryOf, PLATFORM_HEADERS, PLATFORM_QUERY, writtenHeaderNames, type QueryBuilder } from './built-query.js';

/** A class whose `set` hands back a new one, filled from `{ fromObject }` or `{ fromString }`. */
const IMMUTABLE: QueryBuilder = { class: 'Params', object: 'fromObject', text: 'fromString', adds: ['set', 'append'], immutable: true };
const BUILDERS = [PLATFORM_QUERY, IMMUTABLE];

/** The value handed to `send(...)` in `body`, read as a query. */
const queryIn = (body: string) => {
  const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', `declare const send: (q: unknown) => void;\ndeclare class Params { constructor(o?: unknown); set(k: string, v: unknown): Params; append(k: string, v: unknown): Params; }\n${body}`);
  const call = source.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'send');
  const [argument] = call?.getArguments() ?? [];
  if (argument === undefined) throw new Error('no send(...)');
  return argument;
};

describe('a query built in code (P258)', () => {
  it.each([
    ['an object handed in place', "send(new URLSearchParams({ status: 'open', limit: '10' }));", ['limit', 'status']],
    ['the text of a query', "send(new URLSearchParams('page=1&sort=asc'));", ['page', 'sort']],
    ['a list of pairs', "send(new URLSearchParams([['a', '1'], ['b', '2']]));", ['a', 'b']],
    ['adds to a name in its scope', "function f(q: string) { const p = new URLSearchParams({ q }); p.append('page', '1'); p.set('sort', 'asc'); send(p); }", ['page', 'q', 'sort']],
    ['its text', "function f() { const p = new URLSearchParams(); p.set('a', '1'); send(p.toString()); }", ['a']],
    ['a chain of a class that hands back a new one', "send(new Params().set('a', 1).append('b', 2));", ['a', 'b']],
    ['what is assigned back, and only that', "function f() { let p = new Params({ fromObject: { a: 1 } }); p = p.set('b', 2); p.set('ignored', 3); send(p); }", ['a', 'b']],
    ['`fromString`', "send(new Params({ fromString: 'x=1&y=2' }));", ['x', 'y']],
  ])('reads %s', (_, body, keys) => {
    expect(builtQueryOf(queryIn(body), BUILDERS)).toEqual({ keys });
  });

  it('says nothing of the keys where one is not a literal, and nothing at all of a value that is no built query', () => {
    expect(builtQueryOf(queryIn("function f(k: string) { const p = new URLSearchParams(); p.append(k, '1'); send(p); }"), BUILDERS)).toEqual({ unread: true });
    expect(builtQueryOf(queryIn('function f(o: Record<string, string>) { send(new URLSearchParams(o)); }'), BUILDERS)).toEqual({ unread: true });
    expect(builtQueryOf(queryIn("send({ a: 1 });"), BUILDERS)).toBeUndefined();
  });

  it('reads one built into an address, after its `?`', () => {
    const address = (body: string) => builtQueryInAddress(queryIn(body), BUILDERS);
    expect(address("function f() { const p = new URLSearchParams({ status: 'open' }); send(`/orders?${p}`); }")).toEqual({ keys: ['status'] });
    expect(address("send('/orders?' + new URLSearchParams({ page: '2' }).toString());")).toEqual({ keys: ['page'] });
    expect(address("function f(id: string) { const p = new URLSearchParams({ a: '1' }); send(`/orders/${id}`); }")).toBeUndefined();
  });

  it('reads the names of headers, lower-cased, written in place or built', () => {
    expect(writtenHeaderNames(queryIn("send({ 'X-Tenant': 't', Accept: 'json' });"), [PLATFORM_HEADERS])).toEqual(['accept', 'x-tenant']);
    expect(writtenHeaderNames(queryIn("function f() { const h = new Headers(); h.set('X-Trace', '1'); send(h); }"), [PLATFORM_HEADERS])).toEqual(['x-trace']);
    expect(writtenHeaderNames(queryIn('function f(h: Record<string, string>) { send(h); }'), [PLATFORM_HEADERS])).toBeUndefined();
  });
});

describe('a key or an address held in a constant (P262)', () => {
  it.each([
    ['a constant', "const PAGE = 'page'; function f() { const p = new URLSearchParams(); p.set(PAGE, '1'); send(p); }", ['page']],
    ['a member of an object written `as const`', "const KEYS = { sort: 'sort' } as const; send(new Params().set(KEYS.sort, 'asc'));", ['sort']],
    ['a member of an enum of strings', "enum Key { Limit = 'limit' } function f() { const p = new URLSearchParams(); p.append(Key.Limit, '5'); send(p); }", ['limit']],
    ['a pair whose key is a constant', "const Q = 'q'; send(new URLSearchParams([[Q, 'tea']]));", ['q']],
    ['the text of a query in a constant', "const TEXT = 'a=1&b=2'; send(new URLSearchParams(TEXT));", ['a', 'b']],
    ['an object whose key is computed from a constant', "const Q = 'q'; send(new URLSearchParams({ [Q]: 'tea', limit: '5' }));", ['limit', 'q']],
  ])('reads %s', (_, body, keys) => {
    expect(builtQueryOf(queryIn(body), BUILDERS)).toEqual({ keys });
  });

  it('leaves a name that may hold any string unread, as a key or computed into an object', () => {
    expect(builtQueryOf(queryIn("function f() { let key = 'page'; const p = new URLSearchParams(); p.set(key, '1'); send(p); }"), BUILDERS)).toEqual({ unread: true });
    expect(builtQueryOf(queryIn("function f(key: string) { send(new URLSearchParams({ [key]: '1' })); }"), BUILDERS)).toEqual({ unread: true });
  });

  it('reads an address whose text before the query is a constant, or the end of a `+` chain', () => {
    const address = (body: string) => builtQueryInAddress(queryIn(body), BUILDERS);
    expect(address("const SEARCH = '/api/search?'; function f() { const p = new URLSearchParams({ q: 'x' }); send(SEARCH + p.toString()); }")).toEqual({ keys: ['q'] });
    expect(address("function f(base: string) { const p = new URLSearchParams({ q: 'x' }); send(base + '/api/search?' + p); }")).toEqual({ keys: ['q'] });
  });
});
