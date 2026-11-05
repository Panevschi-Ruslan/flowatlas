import { describe, expect, it } from 'vitest';
import { PATH_DEPTHS, shortestWays } from './shortest-ways.js';

/** A graph of named nodes, as `[from, to]` pairs: an edge is its index. */
const graphOf = (pairs: ReadonlyArray<readonly [string, string]>) => {
  const moves = (u: string, forward: boolean): Array<readonly [string, number]> =>
    pairs.flatMap(([from, to], edge) => (forward ? (from === u ? [[to, edge] as const] : []) : to === u ? [[from, edge] as const] : []));
  const named = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return { moves, named };
};

/** a → b → d and a → c → d: two shortest paths, and a longer way round through e. */
const DIAMOND = graphOf([
  ['a', 'b'],
  ['a', 'c'],
  ['b', 'd'],
  ['c', 'd'],
  ['a', 'e'],
  ['e', 'f'],
  ['f', 'd'],
]);

describe('the shortest ways from one node to another (P229)', () => {
  it('keeps every node on a shortest path and counts the paths', () => {
    const ways = shortestWays({ from: 'a', to: 'd', ...DIAMOND });
    expect(ways).toMatchObject({ found: true, length: 2, paths: 2, left: 0 });
    expect(ways.kept).toEqual(['a', 'b', 'c', 'd']);
    expect(ways.steps.map((step) => `${step.from}>${step.to}`)).toEqual(['a>b', 'a>c', 'b>d', 'c>d']);
    expect(ways.layer.get('d')).toBe(2);
    expect(ways.parent.get('d')).toBe('b');
  });

  it('follows the edges the way they run, and says how much it searched when none does', () => {
    const ways = shortestWays({ from: 'd', to: 'a', ...DIAMOND });
    expect(ways).toMatchObject({ found: false, length: null, paths: 0, searched: 1, kept: [] });
  });

  it('answers "are these joined at all" when the caller moves either way', () => {
    const either = { ...DIAMOND, moves: (u: string) => [...DIAMOND.moves(u, true), ...DIAMOND.moves(u, false)] };
    expect(shortestWays({ from: 'd', to: 'a', ...either })).toMatchObject({ found: true, length: 2 });
  });

  it('looks no further than the depth', () => {
    const line = graphOf([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
    ]);
    expect(shortestWays({ from: 'a', to: 'd', ...line, depth: 2 }).found).toBe(false);
    expect(shortestWays({ from: 'a', to: 'd', ...line, depth: 3 }).found).toBe(true);
    expect(PATH_DEPTHS).toEqual([6, 12, 24]);
  });

  it('past the cap keeps one whole path first, so a cut leaves no gap', () => {
    const wide = graphOf([
      ['a', 'x1'],
      ['a', 'x2'],
      ['a', 'x3'],
      ['x1', 'z'],
      ['x2', 'z'],
      ['x3', 'z'],
    ]);
    const ways = shortestWays({ from: 'a', to: 'z', ...wide, cap: 3 });
    expect(ways.kept).toEqual(['a', 'x1', 'z']);
    expect(ways).toMatchObject({ paths: 3, left: 2 });
    expect(ways.steps.map((step) => `${step.from}>${step.to}`)).toEqual(['a>x1', 'x1>z']);
  });

  it('is a path of no steps from a node to itself', () => {
    expect(shortestWays({ from: 'a', to: 'a', ...DIAMOND })).toMatchObject({ found: true, length: 0, paths: 1, kept: ['a'] });
  });
});
