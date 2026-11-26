import { Node, Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isDispatchedTableMember, tableDispatchOf, tableDispatchOfName, tableTargetOf, type TableTarget } from './handler-tables.js';

/** The call written as `called` in a file of its own, the files beside it given too. */
const callIn = (text: string, called: string, others: Record<string, string> = {}): CallExpression => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  for (const [name, source] of Object.entries(others)) project.createSourceFile(name, source);
  const file = project.createSourceFile('bot.ts', text);
  const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === called);
  if (call === undefined) throw new Error(`no call ${called}`);
  return call;
};

const dispatchAt = (call: CallExpression) => {
  const callee = call.getExpression();
  if (Node.isPropertyAccessExpression(callee)) return tableDispatchOf(callee.getExpression(), callee.getName(), call);
  return tableDispatchOfName(callee, call);
};

const nameOf = (target: TableTarget | undefined): string | undefined => {
  if (target === undefined) return undefined;
  if (target.kind === 'method') return `method ${target.method.getName()}`;
  if (target.kind === 'function') return `function ${target.fn.name}`;
  return `inline ${target.owner?.getName() ?? '-'}`;
};

/** Each row as "<selectedBy> -> <target>". */
const said = (call: CallExpression): string[] =>
  (dispatchAt(call)?.rows ?? []).map((row) => `${row.selectedBy ?? '*'} -> ${nameOf(tableTargetOf(row.value))}`);

describe('a call through a table of handlers (P398)', () => {
  it('reads a field table selected by a prefix, each element an arrow calling a method', () => {
    const call = callIn(
      `class Bot {
        private readonly routes: ReadonlyArray<{ prefix: string; handler: (d: string) => Promise<void> }> = [
          { prefix: 'set_status_', handler: (d) => this.status(d) },
          { prefix: 'view_order_', handler: (d) => this.show(d) },
        ];
        async on(data: string) {
          const route = this.routes.find((r) => data.startsWith(r.prefix));
          if (route) await route.handler(data);
        }
        async status(_d: string) {}
        async show(_d: string) {}
      }`,
      'route.handler',
    );
    expect(said(call)).toEqual(['prefix set_status_ -> inline Bot', 'prefix view_order_ -> inline Bot']);
    expect(dispatchAt(call)).toMatchObject({ unread: 0, total: 2 });
  });

  it('reads a table a method returns, walked with for...of, holding a bound method and an imported function', () => {
    const call = callIn(
      `import { help } from './help';
      class Bot {
        private commands() {
          return [{ name: 'orders', run: this.orders.bind(this) }, { name: 'help', run: help }];
        }
        setup() { for (const command of this.commands()) command.run(); }
        orders() {}
      }`,
      'command.run',
      { 'help.ts': 'export const help = () => undefined;' },
    );
    expect(said(call)).toEqual(['* -> method orders', '* -> function help']);
  });

  it('keeps the rows it read and counts a spread of something not written out', () => {
    const call = callIn(
      `declare const loaded: () => Array<{ command: string; run: () => void }>;
      function stock() {}
      const COMMANDS = [{ command: 'stock', run: stock }, ...loaded()] as const;
      export function route(text: string) {
        const match = COMMANDS.find((entry) => entry.command === text);
        match?.run();
      }`,
      'match?.run',
    );
    expect(said(call)).toEqual(['equals stock -> function stock']);
    expect(dispatchAt(call)).toMatchObject({ unread: 1, total: 2 });
  });

  it('spreads a table written out into another, and reads a record through Object.values and an index', () => {
    const base = `function a() {} function b() {}
      const BASE = [{ key: 'a', run: a }];
      const ALL = [...BASE, { key: 'b', run: b }];
      const BY_KEY = { a: { run: a }, b: { run: b } };`;
    expect(said(callIn(`${base} ALL.forEach((each) => each.run());`, 'each.run'))).toEqual(['* -> function a', '* -> function b']);
    expect(said(callIn(`${base} for (const each of Object.values(BY_KEY)) each.run();`, 'each.run'))).toEqual(['* -> function a', '* -> function b']);
    expect(said(callIn(`${base} export const go = (k: 'a' | 'b') => BY_KEY[k].run();`, 'BY_KEY[k].run'))).toEqual(['* -> function a', '* -> function b']);
  });

  it('reads a destructured member and a regular expression selection', () => {
    const call = callIn(
      `function done() {}
      const ROUTES = [{ pattern: /^done:(\\w+)$/, handler: done }];
      export function on(text: string) {
        const route = ROUTES.find((r) => r.pattern.test(text));
        if (!route) return;
        const { handler } = route;
        handler();
      }`,
      'handler',
    );
    expect(said(call)).toEqual(['pattern /^done:(\\w+)$/ -> function done']);
  });

  it('is no table where the receiver is not an element of one written out', () => {
    expect(dispatchAt(callIn('declare const route: { handler(): void }; route.handler();', 'route.handler'))).toBeUndefined();
    expect(dispatchAt(callIn('const routes = new Map<string, () => void>(); for (const r of routes.values()) r();', 'r'))).toBeUndefined();
  });

  it('says a bound method in a table it dispatches is a reference, and one in a table handed elsewhere is not known to be', () => {
    const dispatched = callIn(
      `class Bot {
        private routes() { return [{ run: this.go.bind(this) }]; }
        setup() { for (const r of this.routes()) r.run(); }
        go() {}
      }`,
      'this.go.bind',
    );
    expect(isDispatchedTableMember(dispatched)).toBe(true);
    const handed = callIn(
      `declare function register(routes: Array<{ run: () => void }>): void;
      class Bot {
        setup() { register([{ run: this.go.bind(this) }]); }
        go() {}
      }`,
      'this.go.bind',
    );
    expect(isDispatchedTableMember(handed)).toBe(false);
  });
});
