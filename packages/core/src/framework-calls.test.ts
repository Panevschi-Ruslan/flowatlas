import { Node, Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { frameworkCallOf, frameworkCallSaid } from './framework-calls.js';
import { tableDispatchOf } from './handler-tables.js';

describe('a hook the framework calls (P399)', () => {
  it('reads the mark a reader writes, and says it as a way in', () => {
    const call = frameworkCallOf({ meta: { frameworkCalls: { hook: 'onModuleInit', when: 'startup' } } });
    expect(call).toEqual({ hook: 'onModuleInit', when: 'startup' });
    expect(call === undefined ? undefined : frameworkCallSaid(call)).toBe('startup (onModuleInit)');
    expect(frameworkCallOf({ meta: { frameworkCalls: { hook: 'x', when: 'sometime' } } })).toBeUndefined();
    expect(frameworkCallOf({})).toBeUndefined();
  });
});

describe('what a table call is chosen by (P399)', () => {
  const selectionAt = (text: string, called: string) => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const file = project.createSourceFile('bot.ts', text);
    const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === called);
    const callee = call?.getExpression();
    if (call === undefined || callee === undefined || !Node.isPropertyAccessExpression(callee)) throw new Error(`no call ${called}`);
    const selection = tableDispatchOf(callee.getExpression(), callee.getName(), call)?.selection;
    return selection === undefined ? undefined : { member: selection.member, test: selection.test, subject: selection.subject?.getText() };
  };

  it('names the member, the test and the value tested, for each test it reads', () => {
    const table = `const routes = [{ prefix: 'a_', key: 'a', re: /^a/, run: () => 1 }];`;
    expect(selectionAt(`${table} function on(data: string) { routes.find((r) => data.startsWith(r.prefix))?.run(); }`, 'routes.find((r) => data.startsWith(r.prefix))?.run')).toEqual({
      member: 'prefix',
      test: 'prefix',
      subject: 'data',
    });
    expect(selectionAt(`${table} function on(text: string) { routes.find((r) => r.key === text)?.run(); }`, 'routes.find((r) => r.key === text)?.run')).toEqual({
      member: 'key',
      test: 'equals',
      subject: 'text',
    });
    expect(selectionAt(`${table} function on(u: { data: string }) { routes.find((r) => r.re.test(u.data))?.run(); }`, 'routes.find((r) => r.re.test(u.data))?.run')).toEqual({
      member: 're',
      test: 'pattern',
      subject: 'u.data',
    });
    expect(selectionAt(`${table} function on() { routes[0]?.run(); }`, 'routes[0]?.run')).toBeUndefined();
  });
});
