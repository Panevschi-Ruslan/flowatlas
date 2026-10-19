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

  it('wraps a failures line whole chips at a time, the row as many lines taller, the chips in its tooltip (P137)', () => {
    const id = 'entry:orders:http:POST:/orders';
    const undeclared = [500, 502, 503].map((status, n) => ({ status, count: n + 1 }));
    const traced = {
      ...data,
      observed: { entries: {}, joins: {}, failures: { [id]: {
        hits: 9, window: { from: '2026-01-01', to: '2026-01-02' }, declaredSeen: [], declaredNeverSeen: [], undeclared,
      } } },
    } as any;
    const heightAt = (width: number): { height: string; title: string; fails: any } => {
      const { page, document } = mountPage(traced, { upTo: createWays });
      // The list as wide as a phone's leaves it, or not laid out yet.
      Object.defineProperty(document.getElementById('entries'), 'clientWidth', { value: width });
      createWays(page).drawEntries();
      const row = document.querySelectorAll('#entries button.row').find((b: any) => b.title.startsWith('POST /orders\n'))!;
      return { height: (row.parentNode as any).style.height, title: (row as any).title, fails: row.querySelector('.row-fails') };
    };
    const wide = heightAt(1200);
    expect(wide.height).toBe('80px');
    expect(wide.fails).not.toBeNull();
    expect(textOf(wide.fails)).toContain('500 ×1 not declared');
    expect(wide.title).toBe('POST /orders\nseen failing with 500 ×1 not declared · 502 ×2 not declared · 503 ×3 not declared');
    // 300px of list: the lead, then a chip a line - each 24px - rather than one cut mid-word.
    expect(heightAt(300).height).toBe(`${80 + 3 * 24}px`);
    expect(heightAt(0).height).toBe('80px');
  });

  it('says beside a way in’s time that its traffic differs from its code, as the Steps header does (P113)', () => {
    const id = 'entry:orders:http:POST:/orders';
    const traced = {
      ...data,
      observed: { entries: { [id]: { hits: 4, p95: 120 } }, joins: {}, drift: { [id]: [2, ['request note', '200 owner']] } },
    } as any;
    const { page, document } = mountPage(traced, { upTo: createWays });
    createWays(page).drawEntries();
    const at = traced.entryIds[id];
    const row = document.querySelector(`#entries button.row[data-entry="${at}"]`)!;
    const meta = row.querySelector('.row-meta')!;
    expect(textOf(meta)).toMatch(/p95 120 ms · traffic differs: 2 fields/);
    expect(meta.querySelector('.row-drift')!.getAttribute('title')).toContain('request note, 200 owner');
    expect(page.entryHeadHtml(at)).toContain('<span class="fail-chip is-drift"');
    expect(page.entryHeadHtml(at)).toContain('traffic differs: 2 fields');
    expect(document.querySelectorAll('#entries .row-drift')).toHaveLength(1);
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
