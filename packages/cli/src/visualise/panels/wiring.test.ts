import { describe, expect, it } from 'vitest';
import { packChanges } from '../changes.js';
import { createKeys, SHORTCUTS, VIEWS } from '../frame.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack, testRunTimePack, withServices } from './test-page.js';

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
      expect(document.getElementById('tab-sheet')!.hidden).toBe(['graph', 'map', 'steps'].includes(view));
      const legend = document.getElementById('legend')!;
      if (view === 'steps') expect(textOf(legend)).toContain('cfg reads config');
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

  it('writes each tab in the address as it opens, the way in on Steps, the one that shows one', () => {
    const { page, document, window } = mountPage(data);
    const key = page.keys.keyOf(page.store.get('current'));
    const written: Record<string, string> = {};
    for (const tab of document.querySelectorAll('.tab')) {
      if (tab.hidden) continue;
      tab.click();
      written[(tab as any).dataset.view] = window.location.hash;
    }
    expect(written).toEqual({
      map: '#map', steps: `#steps/${key}`, crossings: '#crossings', missing: '#missing',
      busiest: '#busiest', graph: `#graph/${key}/2`,
    });
    // Moving between tabs adds nothing to the history.
    expect(window.history.length).toBe(1);
  });

  it('opens a link made for the Walk tab on Steps, on the same way in, and says Steps from then on (P99)', () => {
    const v = at('entry:orders:http:POST:/orders');
    const { page, document, window } = mountPage(data, { address: `file:///project/graph.html#walk/${testKey(v)}` });
    expect(page.store.get('view')).toBe('steps');
    expect(page.store.get('current')).toBe(v);
    expect(document.getElementById('steps-view')!.hidden).toBe(false);
    expect(document.getElementById('v-notice')!.hidden).toBe(true);
    expect(window.location.hash).toBe(`#steps/${testKey(v)}`);
    expect(document.querySelector('.tab[data-view="walk"]')).toBeNull();
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
    const row = document.querySelector('#tab-sheet .nj-row.is-target') as any;
    expect(row.dataset.reason).toBe('di-token-unknown');
    // Opened to its places (P100).
    expect(row.querySelector('details').open).toBe(true);
    expect(row.querySelectorAll('.nj-place').length).toBeGreaterThan(0);
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
    const stale = mountPage(data, { address: 'file:///project/graph.html#steps/zzzzzz' });
    expect(stale.page.store.get('view')).toBe('steps');
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

  it('is a tab row the keyboard moves along: one tab in the Tab order, the arrows round the ends, Home and End (P102)', () => {
    const { page, document } = mountPage(data);
    const tabs = document.querySelectorAll('.tab').filter((tab) => !tab.hidden);
    const views = tabs.map((tab: any) => tab.dataset.view);
    const inTabOrder = () => document.querySelectorAll('.tab').filter((tab) => tab.getAttribute('tabindex') === '0')
      .map((tab: any) => tab.dataset.view);
    expect(inTabOrder()).toEqual(['map']);
    const press = (key: string) => document.activeElement!.dispatchEvent(new FakeEvent('keydown', { key }));
    tabs[0]!.focus();
    press('ArrowRight');
    expect(page.store.get('view')).toBe(views[1]);
    expect((document.activeElement as any).dataset.view).toBe(views[1]);
    expect(inTabOrder()).toEqual([views[1]]);
    press('End');
    expect(page.store.get('view')).toBe(views.at(-1));
    press('ArrowRight');
    expect(page.store.get('view')).toBe(views[0]);
    press('ArrowLeft');
    expect(page.store.get('view')).toBe(views.at(-1));
    press('Home');
    expect(page.store.get('view')).toBe(views[0]);
    // Changes is not on this page, so the arrows pass it over.
    expect(views).not.toContain('changes');
  });

  it('ties each tab to the panel it shows, and names the shared sheet by the table tab open (P102)', () => {
    const { page, document } = mountPage(data);
    for (const tab of document.querySelectorAll('.tab')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!);
      expect(panel, (tab as any).dataset.view).not.toBeNull();
      expect(panel!.getAttribute('role')).toBe('tabpanel');
      expect(tab.getAttribute('id')).toBe('tab-' + (tab as any).dataset.view);
    }
    for (const id of ['map-view', 'steps-view', 'graph-view']) {
      const labelled = document.getElementById(id)!.getAttribute('aria-labelledby')!;
      expect(document.getElementById(labelled)!.getAttribute('aria-controls')).toBe(id);
    }
    page.showView('busiest');
    expect(document.getElementById('tab-sheet')!.getAttribute('aria-labelledby')).toBe('tab-busiest');
    page.showView('missing');
    expect(document.getElementById('tab-sheet')!.getAttribute('aria-labelledby')).toBe('tab-missing');
  });

  it('offers a View select with every tab the row shows, kept in step with it (P102)', () => {
    const { page, document } = mountPage(data);
    const select = document.getElementById('view-select')! as any;
    expect(select.querySelectorAll('option').map((o: any) => o.value))
      .toEqual(document.querySelectorAll('.tab').filter((tab) => !tab.hidden).map((tab: any) => tab.dataset.view));
    expect(textOf(document.getElementById('view-pick')!.querySelector('span'))).toBe('View');
    page.showView('crossings');
    expect(select.value).toBe('crossings');
    select.value = 'graph';
    select.dispatchEvent(new FakeEvent('change'));
    expect(page.store.get('view')).toBe('graph');
    // On a desktop the row fits, and the select stays away.
    expect(document.querySelector('#views > .panel-head')!.classList.contains('is-select')).toBe(false);
  });

  it('puts the select in place of the row under 360px (P102)', () => {
    const { document } = mountPage(data, { width: 340 });
    expect(document.querySelector('#views > .panel-head')!.classList.contains('is-select')).toBe(true);
  });

  /** The panel each tab shows: the table tabs share one sheet. */
  const PANEL_OF: Record<string, string> = {
    map: 'map-view', steps: 'steps-view', graph: 'graph-view',
    crossings: 'tab-sheet', missing: 'tab-sheet', busiest: 'tab-sheet', changes: 'tab-sheet',
    traces: 'tab-sheet', runtime: 'tab-sheet',
  };
  const PANELS = [...new Set(Object.values(PANEL_OF))];
  /** A page written with --diff and --observed-diff over traffic with samples, so it has every tab (P111). */
  const withChanges = {
    ...testRunTimePack('wiring-runtime', { diff: { slower: 2 } }),
    changes: packChanges({
      base: { ref: 'main', services: {} }, head: { ref: null, services: {} },
      nodes: { added: ['entry:orders:http:GET:/orders/today'], removed: [], changed: [], moved: [] },
      edges: { added: [], removed: [], changed: [] },
      types: { added: [], removed: [], changed: [] },
      counts: { base: { nodes: 1, edges: 0, types: 0, unresolved: { rows: 0, sites: 0 } },
        head: { nodes: 2, edges: 0, types: 0, unresolved: { rows: 0, sites: 0 } } },
      impact: [], contracts: { new: [], fixed: [], preexisting: [], ignored: [] }, warnings: [],
    } as any),
  };

  it('shows the panel of whichever tab is the first one opened, at every address a tab has (P137)', () => {
    const v = at('entry:orders:http:POST:/orders');
    const addresses: Array<[string, string]> = [
      ['', 'map'], ['#map', 'map'], ['#map/m=dead', 'map'], ['#map/o=role', 'map'],
      ['#steps', 'steps'], [`#steps/${testKey(v)}`, 'steps'], [`#walk/${testKey(v)}`, 'steps'],
      ['#crossings', 'crossings'], ['#missing', 'missing'], ['#missing/reason=di-token-unknown', 'missing'],
      ['#busiest', 'busiest'], ['#changes', 'changes'], ['#traces', 'traces'], ['#runtime', 'runtime'],
      ['#graph', 'graph'], [`#graph/${testKey(v)}`, 'graph'], [`#graph/${testKey(v)}/3`, 'graph'],
      ['#timeline', 'map'],
    ];
    for (const [hash, view] of addresses) {
      for (const width of [1280, 390]) {
        const { page, document } = mountPage(withChanges, { address: `file:///project/multi-repo.html${hash}`, width });
        const where = `${hash || 'no hash'} at ${width}px`;
        expect(page.store.get('view'), where).toBe(view);
        for (const id of PANELS) expect(document.getElementById(id)!.hidden, `${id} on ${where}`).toBe(id !== PANEL_OF[view]);
        expect(document.querySelector('.tab[aria-selected="true"]')!.getAttribute('data-view'), where).toBe(view);
        // Something is in it: the map its drawing, a table its rows, Steps its way in.
        expect(document.getElementById(PANEL_OF[view]!)!.childNodes.length, where).toBeGreaterThan(0);
      }
    }
    expect([...new Set(addresses.map(([, view]) => view))].sort()).toEqual([...VIEWS].sort());
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
