import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compactAnswer } from '../compact.js';
import { endLineReader, withEndLine } from './end-lines.js';

/** Where the code a row names ends (P393), read from a fixture's checkout. */
const ROOT = resolve(import.meta.dirname, '../../../..');
const STOCK = join(ROOT, 'fixtures', 'callers-walked-to-ways-in', 'stock-api');
const endOf = endLineReader({ repoDir: (service) => (service === 'stock-api' ? STOCK : undefined) });
const FILE = 'src/products/products.controller.ts';

describe('where a row of code ends', () => {
  it('reads a method past the inline type of its parameter, from its decorator', () => {
    expect(endOf({ type: 'method', repo: 'stock-api', file: FILE, line: 23 })).toBe(52);
    expect(endOf({ type: 'method', repo: 'stock-api', file: FILE, line: 18 })).toBe(21);
  });

  it('says none for what is no declaration with a body, a repository not checked out here or a file that is not there', () => {
    expect(endOf({ type: 'entry', repo: 'stock-api', file: FILE, line: 23 })).toBeUndefined();
    expect(endOf({ type: 'method', repo: 'elsewhere', file: FILE, line: 23 })).toBeUndefined();
    expect(endOf({ type: 'method', repo: 'stock-api', file: 'src/gone.ts', line: 1 })).toBeUndefined();
    expect(endOf(undefined)).toBeUndefined();
  });

  it('puts it beside a row that says its line, and into that line when compact', () => {
    const node = { id: 'stock-api#src/products/products.controller.ts:ProductsController.one', type: 'method' as const, label: 'ProductsController.one', repo: 'stock-api', file: FILE, line: 18 };
    const row = withEndLine({ id: node.id, loc: `${FILE}:18` }, node, endOf);
    expect(row).toEqual({ id: node.id, loc: `${FILE}:18`, endLine: 21 });
    expect(withEndLine({ id: node.id }, node, endOf)).toEqual({ id: node.id });
    expect(compactAnswer({ rows: [row] })).toEqual({ rows: [{ id: node.id, line: '18-21' }] });
    // Where the id does not hold the file, the range goes on `loc`.
    expect(compactAnswer({ rows: [{ id: 'gap:x', loc: `${FILE}:18`, endLine: 21 }] })).toEqual({ rows: [{ id: 'gap:x', loc: `${FILE}:18-21` }] });
  });
});
