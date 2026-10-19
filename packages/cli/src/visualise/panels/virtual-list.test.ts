import { describe, expect, it } from 'vitest';
import { createWays } from './ways.js';
import { createVirtualList } from './virtual-list.js';
import { FakeEvent, installDocument, textOf } from './test-dom.js';
import { mountPage, testPack, withWays } from './test-page.js';

/** A long list drawn a window at a time (P102). */
describe('the virtual list', () => {
  const list = (count: number, rowHeight: number | ((i: number) => number) = 20, keep = (): number | null => null) => {
    const window = installDocument('<ul id="l"></ul>');
    const el = window.document.getElementById('l')! as any;
    Object.defineProperty(el, 'clientHeight', { value: 400 });
    const { virtualList } = createVirtualList();
    const rows = virtualList(el, {
      count, rowHeight, keep, overscan: 5,
      render: (i: number) => { const li = window.document.createElement('li'); li.textContent = 'row ' + i; return li as any; },
    });
    return { el, rows };
  };

  it('keeps 2,000 rows to the few in sight, over a spacer as tall as all of them', () => {
    const { el, rows } = list(2000);
    const drawn = el.querySelectorAll('li.v-row');
    expect(drawn.length).toBeLessThan(100);
    expect(drawn.length).toBe(400 / 20 + 1 + 5);
    expect(el.querySelector('.v-size').style.height).toBe('40000px');
    expect(rows.drawn()[0]).toBe(0);
    // Each says where it is in the whole, for a screen reader.
    expect(drawn[3].getAttribute('aria-posinset')).toBe('4');
    expect(drawn[3].getAttribute('aria-setsize')).toBe('2000');
    expect(drawn[3].style.top).toBe('60px');
  });

  it('draws the slice the list is scrolled to, in order', () => {
    const { el, rows } = list(2000);
    el.scrollTop = 20 * 1000;
    el.dispatchEvent(new FakeEvent('scroll'));
    const drawn = rows.drawn();
    expect(drawn[0]).toBe(995);
    expect(drawn.at(-1)).toBe(1000 + 20 + 5);
    expect(el.querySelectorAll('li.v-row').map((li: any) => textOf(li))[0]).toBe('row 995');
    expect(el.querySelectorAll('li.v-row').length).toBeLessThan(100);
  });

  it('places rows of two heights by their sums', () => {
    const { el } = list(100, (i) => (i % 2 === 0 ? 20 : 40));
    expect(el.querySelector('.v-size').style.height).toBe(String(50 * 20 + 50 * 40) + 'px');
    expect(el.querySelector('li[data-at="3"]').style.top).toBe('80px');
    expect(el.querySelector('li[data-at="3"]').style.height).toBe('40px');
  });

  it('keeps the picked row drawn wherever the list is, and scrolls to one asked for', () => {
    const { el, rows } = list(2000, 20, () => 1500);
    expect(rows.drawn()).toContain(1500);
    expect(rows.drawn()).toContain(0);
    rows.scrollTo(1800);
    expect(el.scrollTop).toBe(1801 * 20 - 400);
    expect(rows.drawn()).toContain(1800);
    expect(rows.drawn()).toContain(1500);
    expect(rows.rowEl(10)).not.toBeNull();
    expect(el.scrollTop).toBe(200);
  });

  it('draws nothing but the spacer for no rows, and anew on update', () => {
    const { el, rows } = list(0);
    expect(el.querySelectorAll('li.v-row')).toHaveLength(0);
    rows.update(3);
    expect(el.querySelectorAll('li.v-row')).toHaveLength(3);
    expect(rows.size()).toBe(3);
  });
});

/** The Ways in list on a project with thousands of them (P102). */
describe('the ways in, virtualised', () => {
  const data = withWays(testPack('ways-many'), 2000);

  it('holds 2,000 ways in with under a hundred rows drawn, the count saying all of them, and no cut', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const { drawEntries } = createWays(page);
    drawEntries();
    expect(page.entryIx.length).toBeGreaterThan(2000);
    expect(document.querySelectorAll('#entries button.row').length).toBeLessThan(100);
    expect(textOf(document.getElementById('entry-count'))).toBe(`${page.entryIx.length.toLocaleString()} of ${page.entryIx.length.toLocaleString()}`);
    expect(document.querySelector('#entries .cut')).toBeNull();
    expect(document.querySelector('#entries li.v-row')!.getAttribute('aria-setsize')).toBe(String(page.entryIx.length));
  });

  it('keeps the picked way in drawn and reachable however far away it is, and scrolls to it', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const { drawEntries } = createWays(page);
    const far = page.entryIx[page.entryIx.length - 1];
    page.store.set('current', far);
    drawEntries();
    const picked = document.querySelector('#entries [aria-current="true"]')!;
    expect(picked).not.toBeNull();
    expect(picked.getAttribute('data-entry')).toBe(String(far));
    expect(document.getElementById('entries')!.scrollTop).toBeGreaterThan(0);
    // The one row Tab reaches is the picked one.
    expect(document.querySelectorAll('#entries button.row').filter((b: any) => b.getAttribute('tabindex') === '0')
      .map((b: any) => b.getAttribute('data-entry'))).toEqual([String(far)]);
  });

  it('moves between rows with the arrows, Home and End, drawing a row the window had not', () => {
    const { page, document } = mountPage(data, { upTo: createWays });
    const { drawEntries } = createWays(page);
    page.store.set('current', page.entryIx[0]);
    drawEntries();
    const first = document.querySelector('#entries li[data-at="0"] button')!;
    first.focus();
    first.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement!.closest('li')!.getAttribute('data-at')).toBe('1');
    document.activeElement!.dispatchEvent(new FakeEvent('keydown', { key: 'End' }));
    const last = String(page.entryIx.length - 1);
    expect(document.activeElement!.closest('li')!.getAttribute('data-at')).toBe(last);
    expect(document.activeElement!.getAttribute('tabindex')).toBe('0');
    document.activeElement!.dispatchEvent(new FakeEvent('keydown', { key: 'Home' }));
    expect(document.activeElement!.closest('li')!.getAttribute('data-at')).toBe('0');
  });
});
