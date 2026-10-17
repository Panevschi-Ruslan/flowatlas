import { describe, expect, it } from 'vitest';
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
});
