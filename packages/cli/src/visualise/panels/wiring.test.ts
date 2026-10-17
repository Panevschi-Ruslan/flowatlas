import { describe, expect, it } from 'vitest';
import { createKeys, SHORTCUTS, VIEWS } from '../frame.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack, withServices } from './test-page.js';

/** The tabs, links and first view (P103, P98). */
describe('the wiring', () => {
  const data = testPack('wiring');
  const at = nodeAt(data);
  const testKey = (v: number): string => createKeys(data.keys, data.nodes.length).keyOf(v);

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

  it('draws the tabs VIEWS names, in its order', () => {
    const { document } = mountPage(data);
    expect(document.querySelectorAll('.tab').map((tab: any) => tab.dataset.view)).toEqual([...VIEWS]);
  });

  it('writes each tab in the address as it opens, the way in on the two that show one', () => {
    const { page, document, window } = mountPage(data);
    const key = page.keys.keyOf(page.store.get('current'));
    const written: Record<string, string> = {};
    for (const tab of document.querySelectorAll('.tab')) {
      if (tab.hidden) continue;
      tab.click();
      written[(tab as any).dataset.view] = window.location.hash;
    }
    expect(written).toEqual({
      map: '#map', walk: `#walk/${key}`, steps: `#steps/${key}`, crossings: '#crossings', missing: '#missing',
      busiest: '#busiest', graph: `#graph/${key}/2`,
    });
    // Moving between tabs adds nothing to the history.
    expect(window.history.length).toBe(1);
  });

  it('opens Steps on the way in a link names', () => {
    const v = at('entry:orders:http:POST:/orders');
    const { page, document } = mountPage(data, { address: `file:///project/graph.html#steps/${testKey(v)}` });
    expect(page.store.get('view')).toBe('steps');
    expect(page.store.get('current')).toBe(v);
    expect(document.getElementById('steps-view')!.hidden).toBe(false);
    expect(document.getElementById('v-notice')!.hidden).toBe(true);
    expect(document.getElementById('start')!.hidden).toBe(true);
  });

  it('opens a table tab from a link, and Not joined on the reason it names', () => {
    for (const view of ['crossings', 'busiest', 'missing']) {
      const { page } = mountPage(data, { address: `file:///project/graph.html#${view}` });
      expect(page.store.get('view')).toBe(view);
    }
    const { document, window } = mountPage(data, { address: 'file:///project/graph.html#missing/reason=di-token-unknown' });
    const row = document.querySelector('#walk tr.is-target') as any;
    expect(row.dataset.reason).toBe('di-token-unknown');
    expect(window.location.hash).toBe('#missing/reason=di-token-unknown');
    expect(document.getElementById('table-bar')!.hidden).toBe(false);
  });

  it('says so, and opens the map, for a tab this page has not got', () => {
    const unknown = mountPage(data, { address: 'file:///project/graph.html#timeline' });
    expect(unknown.page.store.get('view')).toBe('map');
    expect(textOf(unknown.document.getElementById('v-notice'))).toContain('opens a tab this page does not have, timeline');
    const noDiff = mountPage(data, { address: 'file:///project/graph.html#changes' });
    expect(noDiff.page.store.get('view')).toBe('map');
    expect(textOf(noDiff.document.getElementById('v-notice'))).toContain('--diff');
    // The notice is about the tab it was said over.
    noDiff.document.querySelector('.tab[data-view="busiest"]')!.click();
    expect(noDiff.document.getElementById('v-notice')!.hidden).toBe(true);
  });

  it('says so for a way in, or a reason, the page does not hold, and shows what it has', () => {
    const stale = mountPage(data, { address: 'file:///project/graph.html#walk/zzzzzz' });
    expect(stale.page.store.get('view')).toBe('walk');
    expect(stale.page.entryIx).toContain(stale.page.store.get('current'));
    expect(textOf(stale.document.getElementById('v-notice'))).toMatch(/names a way in this page does not hold, zzzzzz.*Shown instead: /);
    const gone = mountPage(data, { address: 'file:///project/graph.html#missing/reason=no-such-reason' });
    expect(textOf(gone.document.getElementById('v-notice'))).toContain('Not joined on no-such-reason, which has no rows here');
  });

  it('copies a link to the tab open from its Copy link', async () => {
    const { page, document, window } = mountPage(data);
    document.querySelector('.tab[data-view="steps"]')!.click();
    document.getElementById('s-link')!.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(window.clipboard.at(-1)).toBe(`file:///project/graph.html#steps/${page.keys.keyOf(page.store.get('current'))}`);
    document.querySelector('.tab[data-view="crossings"]')!.click();
    document.getElementById('t-link')!.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(window.clipboard.at(-1)).toBe('file:///project/graph.html#crossings');
  });

  it('steps Back through the ways in picked, not through the tabs', () => {
    const { page, document, window } = mountPage(data);
    const first = page.store.get('current');
    const rows = document.querySelectorAll('#entries button.row');
    const other = rows.find((row) => row.getAttribute('aria-current') !== 'true')!;
    document.querySelector('.tab[data-view="steps"]')!.click();
    other.click();
    const second = page.store.get('current');
    expect(second).not.toBe(first);
    expect(window.location.hash).toBe(`#steps/${page.keys.keyOf(second)}`);
    document.querySelector('.tab[data-view="busiest"]')!.click();
    window.history.back();
    expect(page.store.get('current')).toBe(first);
    expect(page.store.get('view')).toBe('steps');
    expect(window.location.hash).toBe(`#steps/${page.keys.keyOf(first)}`);
  });

  it('keeps the old links: a node on the graph and a view of the map', () => {
    const v = at('entry:orders:http:POST:/orders');
    const graph = mountPage(data, { address: `file:///project/graph.html#graph/${testKey(v)}/3` });
    expect(graph.page.store.get('view')).toBe('graph');
    expect(graph.page.state.focus).toBe(v);
    const map = mountPage(data, { address: 'file:///project/graph.html#map/m=dead' });
    expect(map.page.store.get('view')).toBe('map');
    expect((map.document.getElementById('m-mark') as any).value).toBe('dead');
  });

  it('boots a page of thirty services with the checklist in place of the chips', () => {
    const { document } = mountPage(withServices(data, 30));
    expect(document.querySelectorAll('#fleet .ship')).toHaveLength(0);
    expect(textOf(document.getElementById('svc-button'))).toBe('Services: all ▾');
  });

  it('hides the Ways in list on the tabs that never read it, and brings it back (P101)', () => {
    const { page, document } = mountPage(data);
    const work = document.querySelector('.work')!;
    for (const [view, wide] of [['crossings', true], ['busiest', true], ['map', false], ['steps', false],
      ['missing', false], ['graph', false]] as const) {
      page.showView(view);
      expect(work.classList.contains('is-wide'), view).toBe(wide);
    }
  });

  it('points every legend with keys at the ? overlay, which lists every shortcut (P101)', () => {
    const { page, document } = mountPage(data);
    for (const view of ['graph', 'map']) {
      page.showView(view);
      const legend = document.getElementById('legend')!;
      expect(textOf(legend)).not.toMatch(/arrows move|Tab moves/);
      legend.querySelector('[data-keys-open]')!.click();
      expect(document.getElementById('keys-help')!.hidden).toBe(false);
      expect(document.querySelectorAll('#keys-list [data-shortcut]')).toHaveLength(SHORTCUTS.length);
      document.querySelector('[data-keys-close]')!.click();
    }
  });

  it('says what was read and, only with a trace, what was seen running (P101)', () => {
    const { document } = mountPage(data);
    const said = textOf(document.getElementById('colophon'));
    expect(said).toMatch(/^Read from the source code\. A path/);
    expect(said).not.toContain('never run');
    const traced = mountPage({ ...data, observed: { entries: {}, joins: {} } } as any);
    expect(textOf(traced.document.getElementById('colophon')))
      .toMatch(/^Read from the source code\. Where a trace was imported, what was seen at run time is shown beside it\./);
  });
});
