import { Project } from 'ts-morph';
import { describe, expect, it, vi } from 'vitest';
import { lineAndColumnAt, startLineOf } from './line-numbers.js';

describe('line numbers by lookup', () => {
  // Every way a line can end, and a line separator the compiler counts and ts-morph does not.
  const TEXT = '/** a */\r\nq(1);\rq(2);\n\n  r( q(3));\r\n// end\nnew Q(q(4)) \r\r\n x';

  it('gives the line a node starts on as ts-morph does, whatever ends the lines', () => {
    const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', TEXT);
    const nodes = source.getDescendants();
    expect(nodes.length).toBeGreaterThan(10);
    for (const node of nodes) expect(startLineOf(node), node.getKindName()).toBe(node.getStartLineNumber());
  });

  it('gives the line and column of every position as ts-morph does', () => {
    const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('b.ts', TEXT);
    for (let pos = 0; pos <= TEXT.length; pos += 1) {
      expect(lineAndColumnAt(source, pos), `at ${pos}`).toEqual(source.getLineAndColumnAtPos(pos));
    }
  });

  it('reads a file once, and again only once its text changes', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const source = project.createSourceFile('/c.ts', 'a;\nb;\n');
    const spy = vi.spyOn(source, 'getFullText');
    const [first, second] = source.getStatements();
    expect([startLineOf(first!), startLineOf(second!), lineAndColumnAt(source, 3).line]).toEqual([1, 2, 2]);
    expect(spy).toHaveBeenCalledTimes(1);
    project.getFileSystem().writeFileSync('/c.ts', '\n\na;\nb;\n');
    source.refreshFromFileSystemSync();
    spy.mockClear();
    const [moved] = source.getStatements();
    expect([startLineOf(moved!), startLineOf(moved!)]).toEqual([3, 3]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
