import { describe, expect, it } from 'vitest';
import { textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** The Graph tab's details panel (P103). */
describe('the details panel', () => {
  const data = testPack('details');
  const at = nodeAt(data);

  it('says what a way in is, what stands in front of it, and what goes in and out', () => {
    const { page, document } = mountPage(data);
    page.graph.go(at('entry:gateway:http:POST:/orders'));
    const panel = document.getElementById('g-details')!;
    expect(panel.hidden).toBe(false);
    expect(textOf(panel.querySelector('h3'))).toBe('POST /orders');
    const sections = panel.querySelectorAll('section h4').map(textOf);
    expect(sections).toContain('Out · 3');
    expect(sections.some((title) => title.startsWith('In · '))).toBe(true);
    expect(sections.some((title) => title.startsWith('Problems · '))).toBe(true);
    expect(panel.querySelector('[data-act="walk"]')).toBeNull();
    expect(panel.querySelector('[data-act="steps"]')).not.toBeNull();
    panel.querySelector('[data-act="open-steps"]')!.click();
    expect(page.store.get('view')).toBe('steps');
    expect(page.store.get('current')).toBe(at('entry:gateway:http:POST:/orders'));
    expect(panel.querySelector('[data-prompt]')!.getAttribute('data-prompt')).toBe(`entry:${at('entry:gateway:http:POST:/orders')}`);
  });

  it('gives each row that names the node one menu, and no inline buttons (P100)', () => {
    const { page, document } = mountPage(data);
    page.graph.go(at('http_out:gateway#src/clients/orders.client.ts:20:4'));
    const rows = document.querySelectorAll('#g-details .g-row');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelectorAll('[data-row-menu]')).toHaveLength(1);
      expect(row.querySelectorAll('[data-prompt], [data-accept-cmd]')).toHaveLength(0);
    }
  });

  it('closes, and says nothing, when no node is open', () => {
    const { page, document } = mountPage(data);
    page.graph.go(at('channel:order.created'));
    page.closeDetails();
    expect(document.getElementById('g-details')!.hidden).toBe(true);
    expect(document.getElementById('g-stage')!.classList.contains('is-closed')).toBe(true);
  });
});
