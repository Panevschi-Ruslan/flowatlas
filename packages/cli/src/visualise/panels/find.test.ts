import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFind } from './find.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** The one search over everything (P73, P103, P101). */
describe('the search over everything', () => {
  const data = testPack('find');
  const at = nodeAt(data);
  afterEach(() => { vi.restoreAllMocks(); });

  const type = (document: any, text: string) => {
    const input = document.getElementById('find')!;
    input.value = text;
    input.dispatchEvent(new FakeEvent('input'));
    return input;
  };

  it('lists what is called that, grouped, each a link to where it is, the nodes the Graph found among them', () => {
    const { page, document } = mountPage(data, { upTo: createFind });
    createFind(page);
    const out = document.getElementById('find-out')!;
    expect(out.hidden).toBe(true);
    type(document, 'invoice');
    expect(out.hidden).toBe(false);
    expect(out.querySelectorAll('h4').map(textOf)).toContain('Tables · 1');
    expect(out.querySelectorAll('h4').map(textOf).some((head) => head.startsWith('Nodes · '))).toBe(true);
    const links = out.querySelectorAll('a[data-hit]');
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((a: any) => /^#(graph|missing)\//.test(a.getAttribute('href')))).toBe(true);
    // The first is the one Enter goes to, and the last offers to filter the Ways in list.
    expect(document.getElementById('find')!.getAttribute('aria-activedescendant')).toBe('find-hit-0');
    expect(textOf(out.querySelector('.find-filter'))).toBe('Filter the Ways in list to ‘invoice’');
  });

  it('says a gap in words, its reason code in the tooltip, and still finds it by the code', () => {
    const { page, document } = mountPage(data, { upTo: createFind });
    createFind(page);
    const reason = page.reasons[data.rows[0]![4] as number];
    type(document, reason);
    const sub = document.querySelector('#find-out [title]')!;
    expect(sub.getAttribute('title')).toBe(reason);
    expect(textOf(sub)).not.toContain(reason);
  });

  it('says when nothing is called that, and on Escape clears and hands the keyboard back', () => {
    const { page, document } = mountPage(data);
    const out = document.getElementById('find-out')!;
    const tab = document.querySelector('.tab[data-view="steps"]')!;
    tab.focus();
    document.body.dispatchEvent(new FakeEvent('keydown', { key: '/' }));
    const input = document.getElementById('find')!;
    expect(document.activeElement).toBe(input);
    type(document, 'zzzz-nothing');
    expect(textOf(out.querySelector('.find-none'))).toBe('Nothing here is called that.');
    input.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(out.hidden).toBe(true);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(tab);
    void page;
  });

  it('is reached with / from anywhere but a field, where / is typed', () => {
    const { document } = mountPage(data);
    const input = document.getElementById('find')!;
    const field = document.getElementById('kind')!;
    field.focus();
    const typed = new FakeEvent('keydown', { key: '/' });
    field.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field);
    document.body.dispatchEvent(new FakeEvent('keydown', { key: '/' }));
    expect(document.activeElement).toBe(input);
  });

  it('picks a way in found on Steps, scrolls the list to it and marks both where it landed', () => {
    const { page, document } = mountPage(data);
    page.showView('steps');
    const scrolled: any[] = [];
    vi.spyOn(Object.getPrototypeOf(document.body), 'scrollIntoView').mockImplementation(function (this: any) { scrolled.push(this); });
    const v = at('entry:billing:event:order.created');
    page.goToFound({ label: 'event order.created', sub: 'billing', node: v });
    expect(page.store.get('current')).toBe(v);
    expect(page.store.get('view')).toBe('steps');
    const row = document.querySelector(`#entries [data-entry="${v}"]`)!;
    expect(row.classList.contains('is-found')).toBe(true);
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('#s-list [data-node]')!.classList.contains('is-found')).toBe(true);
    expect(scrolled.includes(row)).toBe(true);
  });

  it('focuses a node found on the Graph tab there, marked, through the keys', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    const v = at('billing#src/invoices/invoices.service.ts:InvoicesService.create');
    const input = type(document, 'invoicesservice');
    const nodes = document.querySelectorAll('#find-out a[data-hit]')
      .filter((a: any) => a.getAttribute('href') === `#graph/${page.keys.keyOf(v)}`);
    expect(nodes.length).toBeGreaterThan(0);
    // Down to that hit, then Enter.
    const target = Number(nodes[0]!.dataset.hit);
    for (let n = 0; n < target; n += 1) input.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    expect(page.state.focus).toBe(v);
    expect(document.getElementById('find-out')!.hidden).toBe(true);
    const drawn = document.querySelector(`#g-world .g-node[data-node="${v}"]`)!;
    expect(drawn.classList.contains('is-found')).toBe(true);
  });

  it('opens Not joined on the row of a gap found, marked', () => {
    const { page, document } = mountPage(data);
    const reason = data.unresolved[0]!.reason;
    page.goToFound({ label: 'a row', sub: '', node: -1, reason });
    expect(page.store.get('view')).toBe('missing');
    const row = document.querySelector(`#tab-sheet tr[data-reason="${reason}"]`)!;
    expect(row.classList.contains('is-found')).toBe(true);
  });

  it('opens anything else the tab open cannot show on the Graph, marked', () => {
    const { page, document } = mountPage(data);
    page.showView('busiest');
    const v = at('table:billing#Invoice');
    page.goToFound({ label: 'Invoice', sub: 'billing', node: v });
    expect(page.store.get('view')).toBe('graph');
    expect(page.state.focus).toBe(v);
    expect(document.querySelector(`#g-world .g-node[data-node="${v}"]`)!.classList.contains('is-found')).toBe(true);
  });

  it('filters the Ways in list to what was typed, from its last item', () => {
    const { page, document } = mountPage(data);
    type(document, 'orders');
    document.querySelector('#find-out .find-filter button')!.click();
    expect(document.getElementById('list-filter')!.hidden).toBe(false);
    const names = document.querySelectorAll('#entries button.row').map((row) => textOf(row.querySelector('.row-name')));
    expect(names.every((name) => name.includes('orders'))).toBe(true);
    void page;
  });

  it('picks the end of a path on the Graph tab, every hit then a node', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    const from = at('entry:gateway:http:POST:/orders');
    page.graph.go(from);
    document.getElementById('g-check-btn')!.click();
    document.getElementById('g-from')!.click();
    expect(document.activeElement).toBe(document.getElementById('find'));
    expect(document.getElementById('g-check')!.hidden).toBe(true);
    type(document, 'gateway post orders');
    expect(textOf(document.querySelector('#find-out .find-picking'))).toMatch(/^Choose where the path starts/);
    expect(document.querySelector('#find-out .find-filter')).toBeNull();
    document.getElementById('find')!.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    expect(page.state.picking).toBeNull();
    expect(page.state.ends.from).not.toBeNull();
  });

  it('is the only search box on the page', () => {
    const { document } = mountPage(data);
    expect(document.querySelectorAll('input[type="search"]').map((input: any) => input.id)).toEqual(['find']);
    expect(document.getElementById('search')).toBeNull();
    expect(document.getElementById('g-search')).toBeNull();
  });
});
