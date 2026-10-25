import { httpClientSchema, type HttpClientConfig } from '@flowatlas/core';
import { Node, Project, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { describedRequestOf } from './http-clients.js';

const client = (written: Record<string, unknown>): HttpClientConfig => httpClientSchema.parse(written);

const callsIn = (code: string): CallExpression[] => {
  const file = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } }).createSourceFile(
    'a.ts',
    `declare class ApiClient { [member: string]: (...args: any[]) => any; }\ndeclare const api: ApiClient;\n${code}`,
  );
  return file.getDescendants().filter((node): node is CallExpression => Node.isCallExpression(node));
};

const at = { file: 'a.ts', line: 3, symbol: 'api.x' };

const read = (code: string, clients: HttpClientConfig[], builtIn?: string) => {
  const [call] = callsIn(code);
  if (call === undefined) throw new Error('no call');
  return describedRequestOf(call, clients, at, builtIn);
};

describe('a described client', () => {
  it('takes the verb from the method name, and the address and body from where it says', () => {
    const decided = read("api.post('/orders', order)", [
      client({ receiverType: 'ApiClient', method: ['get', 'post'], url: [{ kind: 'argument', index: 0 }], body: [{ kind: 'argument', index: 1 }] }),
    ]);
    expect(decided.request?.verb).toBe('POST');
    expect(decided.request?.url?.getText()).toBe("'/orders'");
    expect(decided.request?.body?.getText()).toBe('order');
    expect(decided.request?.evidence).toBe('checked');
  });

  it('reads the verb from a place in the call, or takes a fixed one', () => {
    const verbAt = client({ receiverType: 'ApiClient', method: 'call', verbAt: [{ kind: 'argument', index: 0 }], url: [{ kind: 'argument', index: 1 }] });
    expect(read("api.call('delete', '/orders/1')", [verbAt]).request?.verb).toBe('DELETE');
    expect(read("api.call(verb, '/orders/1')", [verbAt]).request?.verb).toBeNull();
    const fixed = client({ receiverType: 'ApiClient', method: 'send', verb: 'put', url: [{ kind: 'argument-property', index: 0, key: 'path' }] });
    const decided = read("api.send({ path: '/orders/1' })", [fixed]);
    expect(decided.request?.verb).toBe('PUT');
    expect(decided.request?.url?.getText()).toBe("'/orders/1'");
  });

  it('applies only where the call writes what the description requires', () => {
    const posting = client({
      receiverType: 'ApiClient',
      method: 'call',
      verb: 'POST',
      url: [{ kind: 'argument', index: 1 }],
      where: [{ at: { kind: 'argument', index: 0 }, equals: 'POST' }],
    });
    expect(read("api.call('POST', '/x')", [posting]).request).toBeDefined();
    expect(read("api.call('GET', '/x')", [posting]).request).toBeUndefined();
  });

  it('leaves a call the reader already knows to it, and says a pattern is shadowed', () => {
    const pattern = client({ receiverType: 'ApiClient', method: 'get', url: [{ kind: 'argument', index: 0 }], describedBy: 'pattern:get' });
    const decided = read("api.get('/x')", [pattern], 'the built-in reading of the request');
    expect(decided.request).toBeUndefined();
    expect(decided.rows.map((row) => row.reason)).toEqual(['pattern-shadowed']);
  });

  it('reads neither of two patterns on one call', () => {
    const one = client({ receiverType: 'ApiClient', method: 'get', url: [{ kind: 'argument', index: 0 }], describedBy: 'pattern:one' });
    const two = client({ receiverType: 'ApiClient', method: 'get', url: [{ kind: 'argument', index: 0 }], describedBy: 'pattern:two' });
    const decided = read("api.get('/x')", [one, two]);
    expect(decided.request).toBeUndefined();
    expect(decided.rows[0]).toMatchObject({ reason: 'pattern-ambiguous', meta: { rules: ['one', 'two'] } });
  });

  it('matches a receiver made by a factory, and a function by its name', () => {
    const [made] = callsIn("declare function useApi(): any;\nconst handle = useApi();\nhandle.send({ path: '/books' });").filter((call) => call.getText().startsWith('handle.'));
    const byFactory = client({ factory: 'useApi', method: 'send', verb: 'GET', url: [{ kind: 'argument-property', index: 0, key: 'path' }] });
    expect(made === undefined ? undefined : describedRequestOf(made, [byFactory], at, undefined).request?.verb).toBe('GET');
    const [fn] = callsIn("function request(method: string, url: string) {}\nrequest('PATCH', '/books/1');").filter((call) => call.getText().startsWith('request('));
    const byName = client({ function: 'request', verbAt: [{ kind: 'argument', index: 0 }], url: [{ kind: 'argument', index: 1 }] });
    expect(fn === undefined ? undefined : describedRequestOf(fn, [byName], at, undefined).request?.verb).toBe('PATCH');
  });
});
