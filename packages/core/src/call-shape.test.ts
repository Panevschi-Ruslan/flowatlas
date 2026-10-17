import { Project, SyntaxKind, type CallExpression, type Node, type SourceFile } from 'ts-morph';
import { describe, expect, it, vi } from 'vitest';
import { callIndexOf, callShapeOf, callsOnLine, siteNodeAt } from './call-shape.js';

const shapeOf = (body: string, name = 'q') => {
  const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', body);
  const call = source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((c) => c.getExpression().getText() === name);
  if (call === undefined) throw new Error(`no call to ${name}`);
  return callShapeOf(call);
};

describe('callShapeOf', () => {
  it.each([
    ['for-of', 'async function f(xs) { for (const x of xs) await q(x); }'],
    ['for-in', 'function f(o) { for (const k in o) q(k); }'],
    ['for', 'function f() { for (let i = 0; i < 3; i++) q(i); }'],
    ['while', 'function f() { while (q()) {} }'],
    ['do', 'function f() { do { q(); } while (true); }'],
    ['map', 'function f(xs) { return xs.map((x) => q(x)); }'],
    ['forEach', 'function f(xs) { xs.forEach(function (x) { q(x); }); }'],
    ['reduce', 'function f(xs) { return xs.reduce(async (a, x) => { await a; return q(x); }, null); }'],
  ])('finds a %s loop', (kind, body) => {
    expect(shapeOf(body).loop?.kind).toBe(kind);
  });

  it.each([
    ['the list a for-of walks', 'async function f() { for (const x of await q()) {} }'],
    ['a for initializer', 'function f() { for (let i = q(); i < 3; i++) {} }'],
    ['a function made in a loop and run later', 'function f(xs, out) { for (const x of xs) out.push(() => q(x)); }'],
    ['a plain call', 'function f() { return q(); }'],
  ])('finds no loop in %s', (_, body) => {
    expect(shapeOf(body).loop).toBeUndefined();
  });

  it.each(['all', 'allSettled', 'race', 'any'])('finds Promise.%s side by side', (by) => {
    expect(shapeOf(`function f() { return Promise.${by}([q(), r()]); }`).concurrent?.by).toBe(`Promise.${by}`);
  });

  it('finds a map inside Promise.all both in a loop and side by side', () => {
    const shape = shapeOf('function f(xs) { return Promise.all(xs.map((x) => q(x))); }');
    expect(shape.loop?.kind).toBe('map');
    expect(shape.concurrent?.by).toBe('Promise.all');
  });

  it('does not take a call before Promise.all, or a then callback, as side by side', () => {
    expect(shapeOf('async function f() { const a = await q(); return Promise.all([a]); }').concurrent).toBeUndefined();
    expect(shapeOf('function f() { return Promise.all([r()]).then(() => q()); }').concurrent).toBeUndefined();
  });
});

describe('siteNodeAt and callsOnLine', () => {
  const source = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    'b.ts',
    'class A {\n  m(xs) {\n    for (const x of xs) this.repo.find(x);\n  }\n}\n',
  );

  it('finds the call a leaf id names by its line and column', () => {
    const node = siteNodeAt(source, 3, 25);
    expect(node?.getText()).toBe('this.repo.find(x)');
    expect(node === undefined ? undefined : callShapeOf(node).loop?.kind).toBe('for-of');
  });

  it('finds the calls on a line by the name they are made by', () => {
    expect(callsOnLine(source, 3, 'find').map((c) => c.getText())).toEqual(['this.repo.find(x)']);
    expect(callsOnLine(source, 3, 'save')).toEqual([]);
  });
});

describe('the call index (P79)', () => {
  /** What `callsOnLine` answered before the index: a walk of the whole file per question. */
  const walked = (source: SourceFile, line: number, name: string): CallExpression[] =>
    source.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
      const callee = call.getExpression();
      const called = callee.isKind(SyntaxKind.Identifier)
        ? callee.getText()
        : callee.isKind(SyntaxKind.PropertyAccessExpression)
          ? callee.getName()
          : undefined;
      return call.getStartLineNumber() === line && called === name;
    });

  const same = (a: readonly Node[], b: readonly Node[]): boolean => a.length === b.length && a.every((n, i) => n === b[i]);

  const BODY = [
    'function f(a, b) {',
    '  return q(q(a), b.q(1).q(2), r(q(3)));',
    '}',
    'const x = q(',
    '  1,',
    '  q(2),',
    ');',
    'const y = [new Q(q(4)), q(5), new Q(6)];',
    '(() => q(7))();',
    '',
  ].join('\n');

  it('finds the calls a whole-file walk finds, in the same order', () => {
    const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('c.ts', BODY);
    for (let line = 1; line <= 10; line += 1) {
      for (const name of ['q', 'r', 'f', 'Q']) {
        expect(same(callsOnLine(source, line, name), walked(source, line, name)), `line ${line}, ${name}`).toBe(true);
      }
    }
    // Nested, chained and two of one name on a line: all four, outermost first.
    expect(callsOnLine(source, 2, 'q').map((c) => c.getText())).toEqual([
      'q(q(a), b.q(1).q(2), r(q(3)))',
      'q(a)',
      'b.q(1).q(2)',
      'b.q(1)',
      'q(3)',
    ]);
    // A call over several lines is on the line it starts on.
    expect(callsOnLine(source, 4, 'q').map((c) => c.getText().replace(/\s+/g, ''))).toEqual(['q(1,q(2),)']);
    expect(callsOnLine(source, 6, 'q').map((c) => c.getText())).toEqual(['q(2)']);
  });

  it('keeps the `new` expressions of a line apart from its calls', () => {
    const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('d.ts', BODY);
    const index = callIndexOf(source);
    expect(index.news(8).map((n) => n.getText())).toEqual(['new Q(q(4))', 'new Q(6)']);
    expect(index.calls(8).map((n) => n.getText())).toEqual(['q(4)', 'q(5)']);
    expect(index.news(2)).toEqual([]);
    expect(callIndexOf(source)).toBe(index);
  });

  /** How often a file's calls, or its `new` expressions, have been walked since the spy went on. */
  const walks = (spy: { mock: { calls: unknown[][] } }, kind: SyntaxKind): number =>
    spy.mock.calls.filter(([asked]) => asked === kind).length;

  it('walks a file once however many lines are asked about, and again only once its text changes', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const lines = 3000;
    const text = (name: string) => Array.from({ length: lines }, (_, i) => `${name}(${i});`).join('\n');
    const source = project.createSourceFile('/big.ts', text('q'));
    const spy = vi.spyOn(source, 'getDescendantsOfKind');

    // Checked after a few questions first, so a walk per question fails here and fast.
    for (let line = 1; line <= 10; line += 1) expect(callsOnLine(source, line, 'q')).toHaveLength(1);
    expect(walks(spy, SyntaxKind.CallExpression)).toBe(1);
    for (let line = 1; line <= lines; line += 1) expect(callsOnLine(source, line, 'q')).toHaveLength(1);
    for (let line = 1; line <= lines; line += 1) callIndexOf(source).calls(line);
    expect(walks(spy, SyntaxKind.CallExpression)).toBe(1);
    expect(walks(spy, SyntaxKind.NewExpression)).toBe(0);
    for (let line = 1; line <= lines; line += 1) callIndexOf(source).news(line);
    expect(walks(spy, SyntaxKind.NewExpression)).toBe(1);

    // Edited in place: the same wrapper, a new compiler node.
    source.replaceWithText(text('r'));
    expect(callsOnLine(source, 7, 'q')).toEqual([]);
    expect(callsOnLine(source, 7, 'r').map((c) => c.getText())).toEqual(['r(6)']);
    for (let line = 1; line <= lines; line += 1) callsOnLine(source, line, 'r');
    expect(walks(spy, SyntaxKind.CallExpression)).toBe(2);

    // Refreshed from disk, as a watch does: the wrapper is kept, the calls are the new text's.
    project.getFileSystem().writeFileSync('/big.ts', text('s'));
    source.refreshFromFileSystemSync();
    expect(project.getSourceFile('/big.ts')).toBe(source);
    expect(callsOnLine(source, 7, 's').map((c) => c.getText())).toEqual(['s(6)']);
    expect(callsOnLine(source, 7, 'r')).toEqual([]);
    expect(walks(spy, SyntaxKind.CallExpression)).toBe(3);
  });

  it('answers for the text a file holds now when an index is kept past a refresh', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const source = project.createSourceFile('/kept.ts', 'q(new A());\n');
    const kept = callIndexOf(source);
    expect(kept.calls(1).map((c) => c.getText())).toEqual(['q(new A())']);
    source.replaceWithText('r(new B());\n');
    expect(kept.calls(1).map((c) => c.getText())).toEqual(['r(new B())']);
    expect(kept.news(1).map((n) => n.getText())).toEqual(['new B()']);
  });
});
