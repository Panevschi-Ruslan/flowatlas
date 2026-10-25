import { describe, expect, it, vi } from 'vitest';
import type { PackedGraph } from '../pack.js';
import { createTables } from './tables.js';
import { textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

/** Crossings, Busiest and Changes (P103). */
describe('the table tabs', () => {
  const data = testPack('tables');

  it('lists every crossing, from where to which route, and how far it is trusted', () => {
    const { page, document } = mountPage(data, { upTo: createTables });
    createTables(page).drawCrossings();
    expect(textOf(document.getElementById('view-title'))).toBe('Every crossing');
    const rows = document.querySelectorAll('#tab-sheet tbody tr');
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.querySelectorAll('td').map(textOf);
    expect(cells[0]).toMatch(/^gateway orders\.client\.ts:20/);
    expect(cells[1]).toBe('orders');
    // The edge in words, its type in the tooltip; trust said only when it is not read from code (P101).
    const how = rows[0]!.querySelectorAll('td')[3]!;
    expect(textOf(how.querySelector('span'))).toBe('requests');
    expect(how.querySelector('span')!.getAttribute('title')).toBe('http_calls');
    const trust = data.dicts.confidences[data.edges.find((e) => data.dicts.edgeTypes[e[2]!] === 'http_calls')![3]!];
    expect(how.querySelectorAll('.trust')).toHaveLength(trust === 'static' ? 0 : 1);
    expect(textOf(document.querySelector('#tab-sheet thead'))).not.toContain('Trust');
  });

  it('ranks the busiest methods and says how they are ranked', () => {
    const { page, document } = mountPage(data, { upTo: createTables });
    createTables(page).drawBusiest();
    expect(textOf(document.getElementById('view-title'))).toBe('Busiest methods');
    expect(textOf(document.querySelector('#tab-sheet .hint'))).toMatch(/^Ranked the way flowatlas hotspots ranks them/);
    const names = document.querySelectorAll('#tab-sheet .busiest-table tbody tr td.mono').map(textOf);
    expect(names.length).toBeGreaterThan(0);
  });

  it('keeps Changes empty and its tab hidden when the page was written without --diff', () => {
    const { page, document } = mountPage(data, { upTo: createTables });
    createTables(page).drawChanges();
    expect(document.getElementById('tab-sheet')!.childNodes).toHaveLength(0);
    expect(document.getElementById('tab-changes')!.hidden).toBe(true);
  });

  /** `data` with its one crossing copied until there are `count`, so the table is long. */
  const withCrossings = (count: number): PackedGraph => {
    const crossing = data.edges.find((e) => data.dicts.edgeTypes[e[2]!] === 'http_calls')!;
    return { ...data, edges: [...data.edges, ...Array.from({ length: count - 1 }, () => [...crossing])] };
  };

  it('draws the first hundred crossings at once and the rest while the browser is idle (P102)', () => {
    vi.useFakeTimers();
    try {
      const { page, document } = mountPage(withCrossings(350), { upTo: createTables });
      const tables = createTables(page);
      tables.drawCrossings();
      const rows = () => document.querySelectorAll('#tab-sheet tbody tr').length;
      expect(rows()).toBe(tables.CROSSINGS_CHUNK);
      vi.advanceTimersToNextTimer();
      expect(rows()).toBe(200);
      vi.runAllTimers();
      expect(rows()).toBe(350);
      // Built once: opening the tab again draws the same rows at once.
      const sheet = document.querySelector('#tab-sheet .sheet');
      tables.drawBusiest();
      tables.drawCrossings();
      expect(document.querySelector('#tab-sheet .sheet')).toBe(sheet);
      expect(rows()).toBe(350);
    } finally {
      vi.useRealTimers();
    }
  });
});
