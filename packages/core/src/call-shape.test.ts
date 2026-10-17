import { Project, SyntaxKind, type CallExpression, type Node, type SourceFile } from 'ts-morph';
import { describe, expect, it, vi } from 'vitest';
import { isMigrationFile } from './bounded-loop.js';
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

describe('loops bounded on purpose (P89)', () => {
  const boundedOf = (body: string, options = {}) => {
    const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('e.ts', body);
    const call = source
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((c) => c.getExpression().getText() === 'q');
    if (call === undefined) throw new Error('no call to q');
    return callShapeOf(call, options).loop?.bounded;
  };

  it.each([
    ['chunk', 'a constant step', 'const SIZE = 25; async function f(ids) { for (let i = 0; i < ids.length; i += SIZE) await q(ids.slice(i, i + SIZE)); }'],
    ['chunk', 'a step written i = i + N', 'async function f(ids) { for (let i = 0; i < ids.length; i = i + 10) await q(i); }'],
    ['chunk', 'a slice cut off each time round', 'async function f(ids, i) { while (i < ids.length) { await q(ids.slice(i, i + 50)); i += 50; } }'],
    ['chunk', 'a splice from the front', 'async function f(ids) { while (ids.length > 0) await q(ids.splice(0, 100)); }'],
    ['chunk', 'a for-of over chunk()', 'declare function chunk<T>(xs: T[], n: number): T[][]; async function f(ids) { for (const part of chunk(ids, 10)) await q(part); }'],
    ['chunk', 'a map over a const bound to batches()', 'declare function batches<T>(xs: T[]): T[][]; function f(ids) { const parts = batches(ids); return parts.map((p) => q(p)); }'],
    ['page', 'while (hasMore)', 'async function f() { let hasMore = true; while (hasMore) { const r = await q(); hasMore = r.more; } }'],
    ['page', 'skip and take handed to the query', 'async function f(skip = 0) { while (skip >= 0) { const rows = await q({ skip, take: 100 }); skip = rows.length ? skip + 100 : -1; } }'],
    ['page', 'while (true) that stops on a short page', 'async function f() { for (;;) { const rows = await q(); if (rows.length < 100) break; } }'],
    ['cursor', 'do … while (token)', 'async function f() { let token; do { const r = await q({ NextToken: token }); token = r.NextToken; } while (token); }'],
    ['cursor', 'while (cursor !== undefined)', 'async function f(cursor) { while (cursor !== undefined) cursor = (await q(cursor)).next; }'],
    ['retry', 'a constant number of tries, left on success', 'const MAX_ATTEMPTS = 3; async function f() { for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) { try { await q(); break; } catch {} } }'],
    ['retry', 'while (attempt < MAX) with a return after a check', 'async function f() { let attempt = 0; while (attempt < 5) { const r = await q(); if (r.ok) return r; attempt += 1; } }'],
    ['literal', 'a for-of over an array literal', "async function f() { for (const kind of ['a', 'b', 'c']) await q(kind); }"],
    ['literal', 'a const bound to an array literal', "const REGIONS = ['north', 'south'] as const; function f() { REGIONS.forEach((r) => q(r)); }"],
    ['literal', 'Object.keys of an object literal', 'const LIMITS = { a: 1, b: 2 }; async function f() { for (const k of Object.keys(LIMITS)) await q(k); }'],
    ['literal', 'an enum', 'enum Region { North, South } async function f() { for (const r in Region) await q(r); }'],
    ['literal', 'Object.values of an enum', "enum Kind { A = 'a', B = 'b' } function f() { return Object.values(Kind).map((k) => q(k)); }"],
  ])('reads %s from %s', (by, _, body) => {
    expect(boundedOf(body)).toBe(by);
  });

  it('reads a project chunking helper the configuration names', () => {
    const body = 'declare function inGroups<T>(xs: T[]): T[][]; async function f(ids) { for (const g of inGroups(ids)) await q(g); }';
    expect(boundedOf(body)).toBeUndefined();
    expect(boundedOf(body, { boundedCalls: ['inGroups'] })).toBe('chunk');
  });

  it.each([
    ['a step of one', 'async function f(ids) { for (let i = 0; i < ids.length; i += 1) await q(ids[i]); }'],
    ['a step that is a parameter', 'async function f(ids, step) { for (let i = 0; i < ids.length; i += step) await q(ids.slice(i, i + step)); }'],
    ['a retry whose bound is a parameter', 'async function f(max) { for (let attempt = 0; attempt < max; attempt++) { try { await q(); break; } catch {} } }'],
    ['a constant count with no exit', 'async function f() { for (let i = 0; i < 3; i++) await q(i); }'],
    ['a variable array', 'async function f(kinds: string[]) { for (const kind of kinds) await q(kind); }'],
    ['a let bound to an array literal', "async function f() { let kinds = ['a']; for (const kind of kinds) await q(kind); }"],
    ['while (cond) with no cursor or page key', 'async function f(cond) { while (cond) { await q({ id: 1 }); cond = false; } }'],
    ['an index walk with skip and take', 'async function f(ids) { for (let i = 0; i < ids.length; i++) await q({ where: { id: ids[i] }, skip: 0, take: 1 }); }'],
    ['a while (true) with no short page', 'async function f() { while (true) { await q(); } }'],
    ['a break inside a nested switch', 'async function f() { for (let a = 0; a < 3; a++) { switch (a) { case 1: break; } await q(); } }'],
  ])('reads nothing from %s', (_, body) => {
    expect(boundedOf(body)).toBeUndefined();
  });
});

describe('isMigrationFile (P89)', () => {
  const sourceOf = (text: string) => new Project({ useInMemoryFileSystem: true }).createSourceFile('m.ts', text);

  it('takes a file under a migrations directory', () => {
    expect(isMigrationFile('src/migrations/1700-backfill.ts')).toBe(true);
    expect(isMigrationFile('db/Migration/seed.ts')).toBe(true);
    expect(isMigrationFile('src/orders/migrations.ts')).toBe(false);
  });

  it('takes a class implementing MigrationInterface, or a module exporting up and down', () => {
    const migration = sourceOf('export class Backfill implements MigrationInterface { up() {} down() {} }');
    expect(isMigrationFile('src/a.ts', migration, { interfaces: ['MigrationInterface'] })).toBe(true);
    expect(isMigrationFile('src/a.ts', migration)).toBe(false);
    expect(isMigrationFile('src/b.ts', sourceOf('export async function up() {} export async function down() {}'))).toBe(true);
    expect(isMigrationFile('src/c.ts', sourceOf('export async function up() {}'))).toBe(false);
  });
});
