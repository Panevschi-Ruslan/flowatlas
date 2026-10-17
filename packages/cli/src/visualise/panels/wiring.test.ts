import { describe, expect, it } from 'vitest';
import { FakeEvent } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** The tabs, links and first view (P103). */
describe('the wiring', () => {
  const data = testPack('wiring');
  const at = nodeAt(data);

  it('opens on the map with a way in that leaves a service picked', () => {
    const { page, document } = mountPage(data);
    expect(page.store.get('view')).toBe('map');
    expect(document.getElementById('map-view')!.hidden).toBe(false);
    const picked = page.store.get('current');
    expect(page.entryIx).toContain(picked);
    expect(document.querySelector('#entries [aria-current="true"]')).not.toBeNull();
  });

  it('shows one tab at a time, each with its legend', () => {
    const { document } = mountPage(data);
    const tabs = document.querySelectorAll('.tab');
    for (const tab of tabs) {
      tab.click();
      const view = (tab as any).dataset.view;
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(tabs.filter((other) => other.getAttribute('aria-selected') === 'true')).toHaveLength(1);
      expect(document.getElementById('graph-view')!.hidden).toBe(view !== 'graph');
      expect(document.getElementById('map-view')!.hidden).toBe(view !== 'map');
      expect(document.getElementById('steps-view')!.hidden).toBe(view !== 'steps');
      expect(document.getElementById('walk-controls')!.hidden).toBe(view !== 'walk');
    }
  });

  it('follows a link to a node into the graph, and picks it on the left when it is a way in', () => {
    const { page, window } = mountPage(data);
    const v = at('entry:orders:http:POST:/orders');
    window.location.hash = `#graph/${page.keys.keyOf(v)}`;
    window.dispatchEvent(new FakeEvent('hashchange'));
    expect(page.store.get('view')).toBe('graph');
    expect(page.state.focus).toBe(v);
    expect(page.store.get('current')).toBe(v);
  });

  it('says so when a link names a node this page does not hold', () => {
    const { document } = mountPage(data, { address: 'file:///project/graph.html#graph/zzzzzzzz' });
    expect(document.getElementById('g-notice')!.textContent).toContain('names a node this page does not hold');
  });
});
