import { describe, expect, it } from 'vitest';
import { rankByReach, waysInOf } from './row-reach.js';

const row = (name: string, waysIn?: number, kind = 'finding') => ({
  name,
  kind,
  meta: waysIn === undefined ? null : { waysIn },
});

describe('rows ranked by how far they are reached (P89)', () => {
  it('puts the rows that record ways in most first, in the places they held', () => {
    const rows = [row('a', 1), row('plain'), row('b', 3), row('c', 2)];
    expect(rankByReach(rows, waysInOf).map((r) => r.name)).toEqual(['b', 'plain', 'c', 'a']);
  });

  it('keeps rows reached alike in their order, unless a tie-breaker orders them (P130)', () => {
    const rows = [row('note', 1, 'note'), row('finding', 1), row('busy note', 2, 'note')];
    expect(rankByReach(rows, waysInOf).map((r) => r.name)).toEqual(['busy note', 'note', 'finding']);
    const notesLast = (a: { kind: string }, b: { kind: string }): number =>
      Number(a.kind === 'note') - Number(b.kind === 'note');
    expect(rankByReach(rows, waysInOf, notesLast).map((r) => r.name)).toEqual(['busy note', 'finding', 'note']);
  });
});
