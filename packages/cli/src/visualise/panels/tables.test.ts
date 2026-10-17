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
    expect(textOf(document.getElementById('walk-title'))).toBe('Every crossing');
    const rows = document.querySelectorAll('#walk tbody tr');
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.querySelectorAll('td').map(textOf);
    expect(cells[0]).toMatch(/^gateway orders\.client\.ts:20/);
    expect(cells[1]).toBe('orders');
    expect(cells[3]).toMatch(/^http_calls · /);
  });

  it('ranks the busiest methods and says how they are ranked', () => {
    const { page, document } = mountPage(data, { upTo: createTables });
    createTables(page).drawBusiest();
    expect(textOf(document.getElementById('walk-title'))).toBe('Busiest methods');
    expect(textOf(document.querySelector('#walk .hint'))).toMatch(/^Ranked the way flowatlas hotspots ranks them/);
    const names = document.querySelectorAll('#walk .busiest-table tbody tr td.mono').map(textOf);
    expect(names.length).toBeGreaterThan(0);
  });

  it('keeps Changes empty and its tab hidden when the page was written without --diff', () => {
    const { page, document } = mountPage(data, { upTo: createTables });
    createTables(page).drawChanges();
    expect(document.getElementById('walk')!.childNodes).toHaveLength(0);
    expect(document.getElementById('tab-changes')!.hidden).toBe(true);
  });
});
