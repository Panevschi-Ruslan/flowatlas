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

  it('narrows to what the search names and the kind picked', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const { drawEntries, entrySearch, kindSelect } = createWays(page);
    entrySearch.value = 'orders';
    drawEntries();
    expect(document.querySelectorAll('#entries button.row').map((row) => textOf(row.querySelector('.row-name'))))
      .toEqual(['POST /orders', 'POST /orders']);
    entrySearch.value = '';
    kindSelect.value = 'event';
    drawEntries();
    expect(document.querySelectorAll('#entries button.row')).toHaveLength(1);
  });

  it('picks a way in and opens it on the tab that is open', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const opened: string[] = [];
    page.showView = (name: string) => opened.push(name);
    const { drawEntries } = createWays(page);
    drawEntries();
    document.querySelectorAll('#entries button.row')[1]!.dispatchEvent(new FakeEvent('click'));
    expect(page.store.get('current')).toBe(page.entryIx[1]);
    expect(opened).toEqual(['walk']);
    expect(document.querySelectorAll('#entries button.row')[1]!.getAttribute('aria-current')).toBe('true');
  });
});
