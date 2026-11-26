import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { PLATFORM_HEADERS } from './built-query.js';
import { defaultHeadersWritten, headersAHookAdds, joinHookHeaders, type HookHanded } from './hook-headers.js';
import { responseHeadersRead, type AnswerHanded } from './response-headers.js';

/** The function handed to `use(...)` in `body`. */
const hookIn = (body: string) => {
  const source = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    'a.ts',
    `declare const use: (fn: unknown) => void;\ndeclare const sign: (x: unknown) => void;\ndeclare const tenant: string;\nconst TENANT = 'X-Tenant';\n${body}`,
  );
  const call = source.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'use');
  const [argument] = call?.getArguments() ?? [];
  if (argument === undefined) throw new Error('no use(...)');
  return argument;
};

const adds = (body: string, handed: HookHanded = 'options') => headersAHookAdds(hookIn(body), handed, [PLATFORM_HEADERS]);

describe('the headers a function a client runs before each request adds (P265)', () => {
  it.each([
    ['a key assigned', "use((config) => { config.headers['X-Tenant'] = tenant; return config; });", ['x-tenant']],
    ['a property assigned, and a constant key', 'use((config) => { config.headers.Authorization = tenant; config.headers[TENANT] = tenant; return config; });', ['authorization', 'x-tenant']],
    ['`set` on the headers', "use((config) => { config.headers.set('X-Trace', '1'); return config; });", ['x-trace']],
    ['the headers spread into new ones', "use((config) => { config.headers = { ...config.headers, 'X-Tenant': tenant }; return config; });", ['x-tenant']],
    ['the options answered with', "use((config) => ({ ...config, headers: { ...config.headers, 'X-Tenant': tenant } }));", ['x-tenant']],
    ['`Object.assign` on the headers', "use((config) => { Object.assign(config.headers, { 'X-Tenant': tenant }); return config; });", ['x-tenant']],
    ['a name holding the headers', "use((config) => { const headers = config.headers; headers['X-Tenant'] = tenant; return config; });", ['x-tenant']],
    ['nothing done to them', 'use((config) => { config.baseURL = "/api"; return config; });', []],
  ])('reads %s', (_, body, keys) => {
    expect(adds(body)).toEqual({ keys, unread: false });
  });

  it.each([
    ['a context: `options.headers`', "use(({ options }) => { options.headers.set('X-Tenant', tenant); });", 'context', ['x-tenant']],
    ['a context by name', "use((ctx) => { ctx.options.headers.set('X-Tenant', tenant); });", 'context', ['x-tenant']],
    ['the request itself', "use((request) => { request.headers.set('X-Tenant', tenant); });", 'request', ['x-tenant']],
    ['the request, in an arrow', "use((request) => request.headers.set('X-Tenant', tenant));", 'request', ['x-tenant']],
  ] as const)('reads %s', (_, body, handed, keys) => {
    expect(adds(body, handed)).toEqual({ keys, unread: false });
  });

  it.each([
    ['a key written as code', 'use((config) => { config.headers[tenant] = "1"; return config; });'],
    ['a header set under a condition', "use((config) => { if (tenant) config.headers['X-Tenant'] = tenant; return config; });"],
    ['after an early return', "use((config) => { if (!tenant) return config; config.headers['X-Tenant'] = tenant; return config; });"],
    ['a header removed', "use((config) => { delete config.headers['X-Old']; return config; });"],
    ['the options handed on', 'use((config) => { sign(config); return config; });'],
    ['the headers handed on', 'use((config) => { sign(config.headers); return config; });'],
    ['options answered with that are not the ones handed in', 'use((config) => ({ url: config.url }));'],
    ['a callback reading the options', "use((config) => { [1].forEach(() => { config.headers['X'] = '1'; }); return config; });"],
    ['below the headers', "use((config) => { config.headers.common['X'] = '1'; return config; });"],
  ])('says %s is not read', (_, body) => {
    expect(adds(body).unread).toBe(true);
  });

  it('says headers written in place of the request’s own replace them', () => {
    expect(adds("use((config) => { config.headers = { 'X-Only': '1' }; return config; });")).toEqual({ keys: ['x-only'], unread: false, replaces: true });
    // Two functions, one replacing: which runs last is not read.
    expect(joinHookHeaders([{ keys: ['a'], unread: false }, { keys: ['b'], unread: false, replaces: true }])).toEqual({ keys: ['a', 'b'], unread: true });
    expect(joinHookHeaders([{ keys: ['a'], unread: false }, { keys: [], unread: false }])).toEqual({ keys: ['a'], unread: false });
  });
});

/** The answer to `ask()` in `body`, read for its headers. */
const readIn = (body: string, handed: AnswerHanded = 'promise') => {
  const source = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    'a.ts',
    `declare const ask: () => any;\ndeclare const keep: (x: unknown) => void;\ndeclare const name: string;\nconst TOTAL = 'X-Total';\n${body}`,
  );
  const call = source.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'ask');
  if (call === undefined) throw new Error('no ask()');
  return responseHeadersRead(call, handed);
};

describe('the headers a caller reads off the answer (P265)', () => {
  it.each([
    ['`get` on an awaited answer, lower-cased', "async function f() { const res = await ask(); keep(res.headers.get('X-Total')); }", ['x-total']],
    ['a key of a client’s headers, as written', "async function f() { const res = await ask(); keep(res.headers['x-total']); keep(res.headers['X-Page']); }", ['X-Page', 'x-total']],
    ['a constant name, and `has`', 'async function f() { const res = await ask(); keep(res.headers.has(TOTAL)); }', ['x-total']],
    ['`then`', "function f() { ask().then((res) => keep(res.headers.get('x-total'))); }", ['x-total']],
    ['the headers destructured', "async function f() { const { headers } = await ask(); keep(headers['x-total']); }", ['x-total']],
    ['in place', "async function f() { keep((await ask()).headers.get('x-total')); }", ['x-total']],
    ['a name holding the headers', "async function f() { const res = await ask(); const h = res.headers; keep(h.get('x-total')); }", ['x-total']],
  ])('reads %s', (_, body, keys) => {
    expect(readIn(body)).toEqual({ keys, unread: false });
  });

  it('reads an observed answer through `subscribe`, `pipe` and `firstValueFrom`', () => {
    expect(readIn("function f() { ask().subscribe((res) => keep(res.headers.get('X-Total'))); }", 'observable')).toEqual({ keys: ['x-total'], unread: false });
    expect(readIn("function f() { ask().pipe(map((res) => res.headers.get('x-total'))); }\ndeclare const map: any;", 'observable')).toEqual({ keys: ['x-total'], unread: false });
    expect(readIn("async function f() { const res = await firstValueFrom(ask()); keep(res.headers.get('x-total')); }\ndeclare const firstValueFrom: any;", 'observable')).toEqual({ keys: ['x-total'], unread: false });
  });

  it('says a name written as code, or the headers handed on, and nothing where none is read', () => {
    expect(readIn('async function f() { const res = await ask(); keep(res.headers.get(name)); }')).toEqual({ keys: [], unread: true });
    expect(readIn("async function f() { const res = await ask(); keep(res.headers); keep(res.headers.get('x-total')); }")).toEqual({ keys: ['x-total'], unread: true });
    expect(readIn('async function f() { const res = await ask(); keep(res.data); return res; }')).toBeUndefined();
  });

  it('reads an answer handed back from the function the request is made in, where each caller holds it (P276)', () => {
    // A service returns the observable; the component subscribes.
    expect(
      readIn("class Invoices { page() { return ask(); } }\nclass List { constructor(private invoices: Invoices) {} load() { this.invoices.page().subscribe((res) => keep(res.headers.get('X-Total'))); } }", 'observable'),
    ).toEqual({ keys: ['x-total'], unread: false });
    // Through operators that hand the answer on as it is.
    expect(
      readIn("declare const tap: any; declare const catchError: any;\nfunction page() { return ask().pipe(tap(() => 1), catchError(() => 2)); }\nfunction load() { page().subscribe((res) => keep(res.headers.get('x-total'))); }", 'observable'),
    ).toEqual({ keys: ['x-total'], unread: false });
    // A promise, returned awaited, read where the caller awaits it.
    expect(readIn("const fetchPage = async () => { return await ask(); };\nasync function load() { const res = await fetchPage(); keep(res.headers['x-total']); }")).toEqual({ keys: ['x-total'], unread: false });
    // An operator that changes the answer stops the reading.
    expect(readIn("declare const map: any;\nfunction page() { return ask().pipe(map((res) => res.body)); }\nfunction load() { page().subscribe((res) => keep(res.headers.get('x-total'))); }", 'observable')).toBeUndefined();
  });
});

/** What the first write under `defaults.headers` in `body` adds. */
const defaultsIn = (body: string) => {
  const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', `declare const api: any;\ndeclare const token: string;\nconst NAME = 'X-Const';\n${body}`);
  const node = [...source.getDescendantsOfKind(SyntaxKind.BinaryExpression), ...source.getDescendantsOfKind(SyntaxKind.DeleteExpression)].find((each) => each.getText().includes('.defaults.headers'));
  if (node === undefined) throw new Error('no write');
  const written = defaultHeadersWritten(node);
  return written === undefined ? undefined : { owner: written.owner.getText(), headers: written.headers };
};

describe("a client's default headers (P276)", () => {
  it.each([
    ['a key under `common`', "api.defaults.headers.common['X-Tenant'] = token;", ['x-tenant']],
    ['a property under `common`', 'api.defaults.headers.common.Authorization = token;', ['authorization']],
    ['a key of the headers themselves', "api.defaults.headers['X-Client'] = 'shop';", ['x-client']],
    ['a constant key', 'api.defaults.headers.common[NAME] = token;', ['x-const']],
    ['a whole set', "api.defaults.headers.common = { 'X-One': '1', 'X-Two': '2' };", ['x-one', 'x-two']],
  ])('reads %s', (_, body, keys) => {
    expect(defaultsIn(body)).toEqual({ owner: 'api', headers: { keys, unread: false } });
  });

  it.each([
    ['a name written as code', 'api.defaults.headers.common[token] = token;'],
    ['a write under a condition', "if (token) api.defaults.headers.common['X-Tenant'] = token;"],
    ['a removal', "delete api.defaults.headers.common['X-Tenant'];"],
    ['a header kept for one verb', "api.defaults.headers.post['X-Tenant'] = token;"],
    ['a set that cannot be read', 'api.defaults.headers.common = { ...api.defaults.headers.common, [token]: token };'],
  ])('says %s is unread', (_, body) => {
    expect(defaultsIn(body)?.headers).toEqual({ keys: [], unread: true });
  });

  it('reads nothing that is not under `defaults.headers`', () => {
    expect(defaultsIn('api.defaults.headersTimeout = 1;')).toBeUndefined();
  });
});
