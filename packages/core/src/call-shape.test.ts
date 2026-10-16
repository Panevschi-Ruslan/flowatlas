import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { callShapeOf, callsOnLine, siteNodeAt } from './call-shape.js';

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
