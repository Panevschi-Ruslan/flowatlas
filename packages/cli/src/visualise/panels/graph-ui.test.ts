import { describe, expect, it } from 'vitest';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** What a person does on the Graph tab (P103). */
describe('the graph controls', () => {
  const data = testPack('graph-ui');
  const at = nodeAt(data);

  it('opens on a focus, writes it into the address, and goes back and forward', () => {
    const { page, document, window } = mountPage(data);
    page.showView('graph');
    const first = at('entry:gateway:http:POST:/orders');
    const second = at('channel:order.created');
    page.graph.go(first);
    expect(window.location.hash).toBe(`#graph/${page.keys.keyOf(first)}/${page.state.hops}`);
    page.graph.go(second);
    expect(textOf(document.getElementById('walk-title'))).toBe('order.created');
    document.getElementById('g-back')!.click();
    expect(page.state.focus).toBe(first);
    document.getElementById('g-forward')!.click();
    expect(page.state.focus).toBe(second);
  });

  it('finds a node by its name and centres on it', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    const input = document.getElementById('g-search')!;
    input.value = 'invoicesservice';
    input.dispatchEvent(new FakeEvent('input'));
    const hits = document.querySelectorAll('#g-results .g-hit');
    expect(hits.map((hit) => textOf(hit.querySelector('.row-name')))).toEqual(['fnInvoicesService.create']);
    input.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    expect(page.state.focus).toBe(at('billing#src/invoices/invoices.service.ts:InvoicesService.create'));
    expect(document.getElementById('g-results')!.hidden).toBe(true);
  });

  it('hides an edge type with its filter chip, and says so', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    page.graph.go(at('entry:gateway:http:POST:/orders'));
    const chip = document.querySelectorAll('#g-filters .chip').find((c) => textOf(c) === 'calls')!;
    chip.click();
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(textOf(document.getElementById('g-status'))).toContain('Filters hide 1 edge type.');
  });
});
