import { describe, expect, it } from 'vitest';
import { createWays } from './ways.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

/** The Ways in list on the left (P103). */
describe('the ways in', () => {
  const data = testPack('ways');

  it('lists every way in, with its service and kind, and offers each kind', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const { drawEntries, kindSelect } = createWays(page);
    drawEntries();
    const rows = document.querySelectorAll('#entries button.row');
    expect(rows).toHaveLength(page.entryIx.length);
    expect(textOf(rows[0]!)).toContain('event order.created');
    expect(textOf(rows[0]!)).toContain('billing · event');
    expect(textOf(document.getElementById('entry-count'))).toBe(`${page.entryIx.length} of ${page.entryIx.length}`);
    expect(kindSelect.querySelectorAll('option').map((o: any) => o.value)).toEqual(['', 'bot_callback', 'event', 'http']);
    expect(document.querySelectorAll('#entries a.to-graph')).toHaveLength(page.entryIx.length);
  });

  it('narrows to what the search handed it and the kind picked, and says so in a chip that clears it', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const { drawEntries, filterWays, kindSelect } = createWays(page);
    expect(document.getElementById('search')).toBeNull();
    filterWays('orders');
    expect(document.querySelectorAll('#entries button.row').map((row) => textOf(row.querySelector('.row-name'))))
      .toEqual(['POST /orders', 'POST /orders']);
    const chip = document.getElementById('list-filter')!;
    expect(chip.hidden).toBe(false);
    expect(textOf(chip)).toContain('filtered: orders');
    chip.querySelector('[data-filter-clear]')!.click();
    expect(chip.hidden).toBe(true);
    expect(document.querySelectorAll('#entries button.row')).toHaveLength(page.entryIx.length);
    kindSelect.value = 'event';
    drawEntries();
    expect(document.querySelectorAll('#entries button.row')).toHaveLength(1);
  });

  it('keeps a way in picked that the filter hides, and says so with a way to clear it', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const { filterWays } = createWays(page);
    page.store.set('current', page.entryIx.find((i: number) => !String(page.nodes[i]![1]).includes('orders') &&
      !page.repoName(i).includes('orders')));
    filterWays('orders');
    expect(page.store.get('current')).not.toBeNull();
    const chip = document.getElementById('list-filter')!;
    expect(textOf(chip)).toContain('picked way in hidden by the filter');
    chip.querySelectorAll('[data-filter-clear]')[1]!.click();
    expect(chip.hidden).toBe(true);
  });

  it('picks a way in and opens its steps, from any tab but the graph', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const opened: string[] = [];
    page.showView = (name: string) => opened.push(name);
    const { drawEntries } = createWays(page);
    drawEntries();
    document.querySelectorAll('#entries button.row')[1]!.dispatchEvent(new FakeEvent('click'));
    expect(page.store.get('current')).toBe(page.entryIx[1]);
    expect(opened).toEqual(['steps']);
    expect(document.querySelectorAll('#entries button.row')[1]!.getAttribute('aria-current')).toBe('true');
  });
});
