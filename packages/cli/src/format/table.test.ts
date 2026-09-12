import { describe, expect, it } from 'vitest';
import { moreRows, renderTable, section } from './table.js';

interface Row {
  name: string;
  count: number;
}

const rows: Row[] = [
  { name: 'orders', count: 4 },
  { name: 'a-very-long-service', count: 12 },
];

const columns = [
  { header: 'service', value: (row: Row) => row.name },
  { header: 'n', value: (row: Row) => String(row.count), align: 'right' as const },
];

describe('printing a table', () => {
  it('sizes each column to the widest thing in it, heading included', () => {
    expect(renderTable(rows, columns)).toEqual([
      'service               n',
      'orders                4',
      'a-very-long-service  12',
    ]);
  });

  it('prints nothing at all for no rows, so a caller can say "none" itself', () => {
    expect(renderTable([], columns)).toEqual([]);
  });

  it('says how many rows were left out rather than trailing off', () => {
    expect(moreRows(7)).toBe('… 7 more rows');
  });

  it('marks an empty section as empty instead of leaving a bare heading', () => {
    expect(section('channels', [])).toEqual(['channels: none']);
    expect(section('channels', ['one'])).toEqual(['channels:', '  one']);
  });
});
