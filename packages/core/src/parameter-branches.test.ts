import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { branchTestsOf, takenAlong, testsAVerb } from './parameter-branches.js';

/** The calls written in one file: a helper's requests by their callee, and its callers by the name they call. */
const project = (text: string) => {
  const file = new Project({ useInMemoryFileSystem: true }).createSourceFile('forward.ts', text);
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression);
  const request = (callee: string): CallExpression => {
    const found = calls.find((each) => each.getExpression().getText() === callee);
    if (found === undefined) throw new Error(`no call ${callee}`);
    return found;
  };
  const callers = (name: string): CallExpression[] => calls.filter((each) => each.getExpression().getText() === name);
  return { request, callers };
};

const HELPER = `
  declare const http: { get(u: string): void; delete(u: string): void; post(u: string, b?: unknown): void };
  export const forward = (method: string, url: string, body?: unknown) =>
    method === 'GET' ? http.get(url) : method === 'DELETE' ? http.delete(url) : http.post(url, body);
  declare const verb: string;
  forward('POST', '/notes/1/export');
  forward('DELETE', '/notes/1');
  forward(verb, '/notes/1/flag');
`;

/** P401: a request inside a helper is credited only to the callers that take its branch. */
describe('the branches a helper makes a request under', () => {
  it('takes each branch only at the callers handing its verb, and says when a caller hands one not read', () => {
    const { request, callers } = project(HELPER);
    const [post, del, unread] = callers('forward') as [CallExpression, CallExpression, CallExpression];
    const taken = (callee: string) => {
      const call = request(callee);
      const tests = branchTestsOf(call);
      return [post, del, unread].map((caller) => takenAlong(call, tests, [caller]));
    };
    expect(taken('http.get')).toEqual([false, false, 'unread']);
    expect(taken('http.delete')).toEqual([false, true, 'unread']);
    expect(taken('http.post')).toEqual([true, false, 'unread']);
    expect(testsAVerb(branchTestsOf(request('http.post')))).toBe(true);
  });

  it('reads an if, a switch and a test of something else the caller hands in', () => {
    const { request, callers } = project(`
      declare const http: { get(u: string): void; put(u: string): void; patch(u: string): void };
      export function send(kind: string, url: string, cached: boolean) {
        if (cached) return;
        switch (kind) {
          case 'replace':
            return http.put(url);
          case 'change':
            return http.patch(url);
        }
        return http.get(url);
      }
      send('change', '/a', false);
      send('replace', '/a', true);
    `);
    const [change, replace] = callers('send') as [CallExpression, CallExpression];
    const patch = request('http.patch');
    expect(branchTestsOf(patch).map((each) => each.test.getText())).toEqual(["case 'change':\n            return http.patch(url);"]);
    expect(takenAlong(patch, branchTestsOf(patch), [change])).toBe(true);
    expect(takenAlong(patch, branchTestsOf(patch), [replace])).toBe(false);
    expect(testsAVerb(branchTestsOf(patch))).toBe(false);
  });

  it('asks nothing of a request under no test of a parameter', () => {
    const { request } = project(`
      declare const http: { get(u: string): void };
      declare const ready: boolean;
      export const read = (url: string) => (ready ? http.get(url) : undefined);
    `);
    expect(branchTestsOf(request('http.get'))).toEqual([]);
  });
});
