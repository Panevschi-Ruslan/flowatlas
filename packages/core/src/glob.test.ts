import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileGlob, expandGlob, isGlob } from './glob.js';

describe('the glob grammar', () => {
  // [pattern, path, matches]
  const TABLE: ReadonlyArray<readonly [string, string, boolean]> = [
    // `*` is a run within one segment.
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['*', 'a', true],
    ['*', 'a/b', false],
    // `?` is one character within one segment.
    ['src/a?.ts', 'src/ab.ts', true],
    ['src/a?.ts', 'src/a.ts', false],
    ['src/a?.ts', 'src/abc.ts', false],
    ['src/a?b', 'src/a/b', false],
    // `**` at the start.
    ['**/x.ts', 'x.ts', true],
    ['**/x.ts', 'a/b/x.ts', true],
    ['**/x.ts', 'a/bx.ts', false],
    // `**` in the middle matches zero segments too.
    ['src/**/x.ts', 'src/x.ts', true],
    ['src/**/x.ts', 'src/a/x.ts', true],
    ['src/**/x.ts', 'src/a/b/x.ts', true],
    ['src/**/x.ts', 'srcx.ts', false],
    ['src/**/x.ts', 'lib/src/x.ts', false],
    // `**` at the end is everything under, and the directory itself.
    ['src/public/**', 'src/public/a/b.ts', true],
    ['src/public/**', 'src/public/a.ts', true],
    ['src/public/**', 'src/public', true],
    ['src/public/**', 'src/publicity/a.ts', false],
    ['**', 'a/b/c', true],
    ['src/**/**/x', 'src/x', true],
    // `**` inside a segment is two `*`.
    ['src/a**b', 'src/axyb', true],
    ['src/a**b', 'src/a/b', false],
    // Everything else is literal.
    ['src/a.ts', 'src/abts', false],
    ['src/[id].ts', 'src/[id].ts', true],
    ['src/[id].ts', 'src/i.ts', false],
    ['src/{a,b}.ts', 'src/a.ts', false],
    ['src/(group)/*.ts', 'src/(group)/a.ts', true],
  ];

  it.each(TABLE)('%s against %s is %s', (pattern, path, matches) => {
    expect(compileGlob(pattern).test(path)).toBe(matches);
  });

  it('reads a backslash as a separator, in the pattern and in the path', () => {
    expect(compileGlob('src\\**\\x.ts').test('src/a/x.ts')).toBe(true);
    expect(compileGlob('src/*/x.ts').test('src\\a\\x.ts')).toBe(true);
  });

  it('calls a pattern a glob when it holds * or ?', () => {
    expect(isGlob('src/a.ts')).toBe(false);
    expect(isGlob('src/*.ts')).toBe(true);
    expect(isGlob('src/a?.ts')).toBe(true);
    expect(isGlob('src/[id].ts')).toBe(false);
  });
});

describe('expandGlob', () => {
  const root = mkdtempSync(join(tmpdir(), 'flowatlas-glob-'));
  for (const file of ['a.d.ts', 'ab.d.ts', 'nested/c.d.ts', 'nested/deep/d.d.ts', 'node_modules/x/e.d.ts', '.git/f.d.ts']) {
    mkdirSync(join(root, 'shapes', file, '..'), { recursive: true });
    writeFileSync(join(root, 'shapes', file), '');
  }

  it('walks a glob a segment at a time, sorted, skipping node_modules and .git', () => {
    expect(expandGlob(root, 'shapes/**/*.d.ts')).toEqual(
      ['a.d.ts', 'ab.d.ts', 'nested/c.d.ts', 'nested/deep/d.d.ts'].map((file) => join(root, 'shapes', file)),
    );
    expect(expandGlob(root, 'shapes/*.d.ts')).toEqual([join(root, 'shapes/a.d.ts'), join(root, 'shapes/ab.d.ts')]);
  });

  it('reads ? as one character, as an accepted rule does', () => {
    expect(expandGlob(root, 'shapes/a?.d.ts')).toEqual([join(root, 'shapes/ab.d.ts')]);
  });

  it('keeps a plain path whether or not it is there, and finds nothing for a glob over nothing', () => {
    expect(expandGlob(root, 'shapes/missing.d.ts')).toEqual([join(root, 'shapes/missing.d.ts')]);
    expect(expandGlob(root, 'nowhere/**/*.d.ts')).toEqual([]);
  });
});
