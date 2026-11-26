import { Project, SyntaxKind, type CallExpression, type Node as TsNode } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { locatedSlots } from './adapters/locator.js';
import { loopOver, loopVariableOf, recordEntriesOf } from './loop-elements.js';

/** The elements a loop hands its variables (P271). */
const sourceOf = (text: string) =>
  new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } }).createSourceFile('a.ts', text);

/** What the variable `name` holds, per element, as `name` or `=value`. */
const taken = (text: string, name = 'name'): string[] | string => {
  const file = sourceOf(text);
  const use = file.getDescendantsOfKind(SyntaxKind.Identifier).filter((each) => each.getText() === name).at(-1) as TsNode;
  const declaration = loopVariableOf(use);
  if (declaration === undefined) return 'not a loop variable';
  const loop = loopOver(declaration);
  if (loop === undefined) return 'no loop';
  if ('why' in loop) return loop.why;
  return loop.elements.map((element) => {
    const held = element.get(declaration);
    return held?.name ?? (held?.value === undefined ? '?' : `=${held.value.getText()}`);
  });
};

describe('loopOver', () => {
  it('reads the keys, values and entries of a record written out, past a spread', () => {
    const record = `const base = { a: 1 }; const handlers = { ...base, 'b-c': 2, [\`d\`]: 3 } as const;`;
    expect(taken(`${record} for (const name of Object.keys(handlers)) use(name);`)).toEqual(['a', 'b-c', 'd']);
    expect(taken(`${record} Object.values(handlers).forEach((name) => use(name));`)).toEqual(['=1', '=2', '=3']);
    expect(taken(`${record} for (const [name, fn] of Object.entries(handlers)) use(fn);`, 'fn')).toEqual(['=1', '=2', '=3']);
    expect(taken(`${record} for (const name in handlers) use(name);`)).toEqual(['a', 'b-c', 'd']);
  });

  it('reads a list written out, its spreads, an enum and what keeps its elements', () => {
    expect(taken(`const more = ['c']; const list = ['a', 'b', ...more]; list.filter(Boolean).map((name) => use(name));`)).toEqual(['a', 'b', 'c']);
    expect(taken(`enum Queue { mail = 'mail-queue', images = 'image-queue' } for (const name of Object.values(Queue)) use(name);`)).toEqual([
      'mail-queue',
      'image-queue',
    ]);
  });

  it('says why where the list is not written out, and is nothing for a plain variable', () => {
    expect(taken(`declare const names: string[]; for (const name of names) use(name);`)).toContain('not a list written out');
    expect(taken(`const name = 'a'; use(name);`)).toBe('not a loop variable');
  });

  it('reads an enum’s members as a record', () => {
    const file = sourceOf(`enum Queue { mail = 'mail-queue' } const at = Queue;`);
    const entries = recordEntriesOf(file.getVariableDeclarationOrThrow('at').getInitializerOrThrow());
    expect('why' in entries ? entries.why : entries.entries.map((entry) => entry.key)).toEqual(['mail']);
  });
});

describe('every element of a list made by mapping another (P271)', () => {
  it('is what the callback answers', () => {
    const file = sourceOf(`declare function send(list: unknown[]): void; function each(job: string, rows: number[]) { send(rows.map((row) => ({ name: job, row }))); }`);
    const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'send') as CallExpression;
    const slots = locatedSlots(call, { kind: 'argument-path', index: 0, path: ['*', 'name'] });
    expect(slots.map((slot) => (slot === undefined ? '-' : `${slot.reached}:${slot.expression.getText()}`))).toEqual(['true:job']);
  });
});
