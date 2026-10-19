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
    expect(textOf(document.getElementById('view-title'))).toBe('order.created');
    document.getElementById('g-back')!.click();
    expect(page.state.focus).toBe(first);
    document.getElementById('g-forward')!.click();
    expect(page.state.focus).toBe(second);
  });

  it('keeps its filters and checks in two popovers off the bar, one open at a time (P101)', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    expect(document.getElementById('g-search')).toBeNull();
    const filtersBtn = document.getElementById('g-filters-btn')!;
    const checkBtn = document.getElementById('g-check-btn')!;
    expect(document.getElementById('g-filters')!.hidden).toBe(true);
    filtersBtn.click();
    expect(document.getElementById('g-filters')!.hidden).toBe(false);
    expect(filtersBtn.getAttribute('aria-expanded')).toBe('true');
    checkBtn.click();
    expect(document.getElementById('g-filters')!.hidden).toBe(true);
    expect(document.getElementById('g-check')!.hidden).toBe(false);
    document.body.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('g-check')!.hidden).toBe(true);
    expect(checkBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('names the filters in words with the codes in their tooltips, and counts what is on', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    const chips = document.querySelectorAll('#g-filters .chip');
    const trust = chips.filter((chip) => page.data.dicts.confidences.includes(chip.getAttribute('title')!));
    expect(trust.map(textOf)).toContain('read from code');
    expect(chips.find((chip) => chip.getAttribute('title') === 'http_calls')).toBeDefined();
    expect(textOf(document.getElementById('g-filters-btn'))).toBe('Filters');
    trust.find((chip) => textOf(chip) === 'read from code')!.click();
    expect(textOf(document.getElementById('g-filters-btn'))).toBe('Filters · 1');
    document.getElementById('g-only')!.checked = true;
    document.getElementById('g-only')!.dispatchEvent(new FakeEvent('change'));
    expect(textOf(document.getElementById('g-check-btn'))).toBe('Check · 1');
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
