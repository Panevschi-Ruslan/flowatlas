import { describe, expect, it } from 'vitest';
import type { PackedChanges } from '../changes.js';
import type { PackedGraph } from '../pack.js';
import { createBand } from './band.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, testPack, withServices } from './test-page.js';

/** The strip, the service rail and Start here (P103, P98). */
describe('the strip', () => {
  const data = testPack('band');
  const services = [
    { name: 'gateway', type: 'nestjs', nodes: 9, edges: 8, unresolved: 1, durationMs: 40, skipped: null },
    { name: 'orders', type: 'nestjs', nodes: 6, edges: 6, unresolved: 2, durationMs: 310, skipped: null },
    { name: 'billing', type: 'nestjs', nodes: 4, edges: 4, unresolved: 0, durationMs: 95, skipped: null },
  ];
  const read = { ...data, report: { ...(data.report as object), services } } as PackedGraph;
  const labels = (document: any): string[] => document.querySelectorAll('#band .pill dt').map(textOf);

  it('says what was read and joined, a pill per figure, with what it means in its title', () => {
    const { page, document } = mountPage(read, { upTo: createBand });
    createBand(page);
    // The test project has no front end: its Browser calls would be "0 / 0 joined".
    expect(labels(document)).toEqual(['Read', 'Graph', 'Service calls', 'Routes reached', 'Channels', 'Missed']);
    const [first, graph] = document.querySelectorAll('#band .pill');
    expect(textOf(first!.querySelector('dd'))).toBe('3 of 3');
    expect(textOf(graph!.querySelector('dd'))).toBe(`${data.nodes.length} nodes`);
    expect(graph!.getAttribute('title')).toMatch(/^\d+ edges, \d+ types$/);
    expect(textOf(document.getElementById('standfirst'))).toMatch(/^3 of 3 repositories read and joined into one graph/);
    expect(textOf(document.querySelector('#built .built-at'))).toMatch(/^built \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/);
  });

  it('draws no pill whose total is nought, but always Missed, and what was read in the warn tone when not all of it was', () => {
    const r = read.report as any;
    const empty = {
      ...read,
      report: {
        ...r,
        services: [...services.slice(0, 2), { ...services[2]!, skipped: 'extract-failed' }],
        ui: { total: 0, resolved: 0, unresolved: 0 },
        channels: { ...r.channels, total: 0, linked: 0, noConsumers: [] },
        httpOut: { ...r.httpOut, total: 0, linked: 0 },
        totals: { ...r.totals, missed: 0 },
      },
    } as PackedGraph;
    const { page, document } = mountPage(empty, { upTo: createBand });
    createBand(page);
    expect(labels(document)).toEqual(['Read', 'Graph', 'Routes reached', 'Missed']);
    expect(document.querySelectorAll('#band .pill dd').map(textOf)).not.toContain('0 / 0 joined');
    const [first] = document.querySelectorAll('#band .pill');
    expect(first!.classList.contains('is-warn')).toBe(true);
    expect(first!.getAttribute('title')).toBe('not read: billing (extract-failed)');
    expect(textOf(document.querySelectorAll('#band .pill').at(-1)!.querySelector('dd'))).toBe('0');
  });

  it('opens what a pill means under the strip on a click or focus, and closes it on a second click', () => {
    const { page, document } = mountPage(read, { upTo: createBand });
    createBand(page);
    const note = document.getElementById('pill-note')!;
    const missed = document.querySelectorAll('#band .pill').at(-1)!;
    expect(note.hidden).toBe(true);
    missed.click();
    expect(note.hidden).toBe(false);
    expect(textOf(note)).toMatch(/^Missed: joined from files: \d+ · findings: \d+$/);
    missed.click();
    expect(note.hidden).toBe(true);
    missed.dispatchEvent(new FakeEvent('focus'));
    expect(note.hidden).toBe(false);
    missed.dispatchEvent(new FakeEvent('blur'));
    expect(note.hidden).toBe(true);
  });

  it('folds the build timings away, slowest first, under their total', () => {
    const { page, document } = mountPage(read, { upTo: createBand });
    createBand(page);
    const folded = document.querySelector('#built details.build-times')!;
    expect(folded.hasAttribute('open')).toBe(false);
    expect(textOf(folded.querySelector('summary'))).toBe('build · 445ms · 3 services');
    const rows = folded.querySelectorAll('tbody tr').map((tr) => tr.querySelectorAll('td').map(textOf));
    expect(rows).toEqual([['orders', '310ms'], ['billing', '95ms'], ['gateway', '40ms']]);
  });

  it('adds no run-time pill when no trace was imported', () => {
    const { page, document } = mountPage(data, { upTo: createBand });
    createBand(page);
    expect(labels(document)).not.toContain('Seen at run time');
  });
});

describe('the service rail', () => {
  const data = testPack('rail');

  it('puts a chip per service up to twelve, which filters the services every tab shows', () => {
    const { page, document } = mountPage(withServices(data, 12), { upTo: createBand });
    let drawn = 0;
    page.drawEntries = () => { drawn += 1; };
    createBand(page);
    const ships = document.querySelectorAll('#fleet .ship');
    expect(ships).toHaveLength(12);
    expect(ships.slice(0, 3).map((ship: any) => ship.dataset.repo)).toEqual(['billing', 'gateway', 'orders']);
    expect(document.getElementById('svc-button')).toBeNull();
    const heard: string[] = [];
    page.store.on((key: string) => heard.push(key));
    ships[0]!.click();
    expect(ships[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(page.store.get('shown').has('billing')).toBe(false);
    expect(heard).toEqual(['shown']);
    expect(drawn).toBe(1);
  });

  it('is one button and a checklist past twelve: search, all, none, and what it lets through on the button', () => {
    const { page, document } = mountPage(withServices(data, 13), { upTo: createBand });
    page.drawEntries = () => {};
    createBand(page);
    expect(document.querySelectorAll('#fleet .ship')).toHaveLength(0);
    const button = document.getElementById('svc-button')!;
    const pop = document.getElementById('svc-pop')!;
    expect(textOf(button)).toBe('Services: all ▾');
    button.click();
    expect(pop.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const rows = pop.querySelectorAll('.svc-list li');
    expect(rows).toHaveLength(13);
    expect(textOf(rows[3]!)).toBe('svc-04 express 6 nodes');
    expect(rows[3]!.querySelector('.svc-swatch')!.getAttribute('style')).toContain('--hue');

    const box = rows[1]!.querySelector('input')! as any;
    box.checked = false;
    box.dispatchEvent(new FakeEvent('change'));
    expect(page.store.get('shown').has('gateway')).toBe(false);
    expect(textOf(button)).toBe('Services: 12 of 13 ▾');

    const find = document.getElementById('svc-find')! as any;
    find.value = 'svc-1';
    find.dispatchEvent(new FakeEvent('input'));
    expect(rows.filter((li) => !li.hidden).map((li: any) => li.dataset.repo)).toEqual(['svc-10', 'svc-11', 'svc-12', 'svc-13']);
    pop.querySelector('[data-svc="none"]')!.click();
    expect(textOf(button)).toBe('Services: 8 of 13 ▾');
    expect(page.store.get('shown').has('svc-04')).toBe(true);
    pop.querySelector('[data-svc="all"]')!.click();
    expect(textOf(button)).toBe('Services: 12 of 13 ▾');

    pop.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(pop.hidden).toBe(true);
  });

  it('redraws itself when the services are changed elsewhere, as a link to the graph does', () => {
    for (const count of [3, 30]) {
      const { page, document } = mountPage(withServices(data, count), { upTo: createBand });
      createBand(page);
      const shown = page.store.get('shown');
      shown.delete('orders');
      page.store.set('shown', shown);
      if (count === 3) {
        expect(document.querySelector('#fleet .ship[data-repo="orders"]')!.getAttribute('aria-pressed')).toBe('false');
      } else {
        expect(textOf(document.getElementById('svc-button'))).toBe('Services: 29 of 30 ▾');
        expect((document.querySelector('#svc-pop input[data-repo="orders"]') as any).checked).toBe(false);
      }
    }
  });
});

describe('Start here', () => {
  const data = testPack('start');

  it('names the way in that crosses the most services and the gap with the most rows to act on, each a link', () => {
    const { page } = mountPage(data, { upTo: createBand });
    const { startHere } = createBand(page);
    const picks = startHere(page.model, page.data);
    expect(picks.map((pick: any) => pick.what)).toEqual(['Busiest way in', 'Worst gap']);
    const [busiest, gap] = picks;
    // The gateway's POST /orders calls the orders service, which publishes to billing.
    expect(busiest).toMatchObject({ say: 'POST /orders', note: 'gateway · 2 crossings · 16 steps' });
    const wayIn = page.keys.find(busiest.href.split('/')[1]);
    expect(busiest.href).toMatch(/^#steps\/[a-z0-9]+$/);
    expect(page.repoName(wayIn)).toBe('gateway');
    expect(page.reachesCrossing[wayIn]).toBe(1);
    // An action row, never the info row standing for twelve places.
    expect(gap).toEqual({ what: 'Worst gap', say: 'unknown-base-url-env', note: '1 row to act on',
      href: '#missing/reason=unknown-base-url-env' });
  });

  it('names what a branch did when the page has its changes, the routes still called first', () => {
    const route = { id: 'entry:orders:http:GET:/orders', service: 'orders', label: 'GET /orders' };
    const changes: PackedChanges = {
      base: 'main', head: null, routes: { added: [route], removed: [] }, stillCalled: [], shapes: [], gaps: [],
      unresolved: { base: 0, head: 0 }, counts: { nodesAdded: 1, nodesRemoved: 0, nodesChanged: 0, edgesAdded: 0, edgesRemoved: 0 },
    };
    const { page } = mountPage({ ...data, changes }, { upTo: createBand });
    const { startHere } = createBand(page);
    expect(startHere(page.model, page.data).at(-1)).toEqual({ what: 'Latest change', say: 'Route added: GET /orders',
      note: 'orders', href: '#changes' });
    const called = { ...changes, stillCalled: [{ ...route, label: 'DELETE /orders/:param', callers: ['gateway'] }] };
    expect(startHere(page.model, { ...page.data, changes: called }).at(-1))
      .toMatchObject({ say: 'Removed but still called: DELETE /orders/:param', href: '#changes' });
  });

  it('leaves out the way in when there is none, and the gap when no row is to be acted on', () => {
    const quiet = { ...data, rows: data.rows.filter((row) => data.dicts.levels[row[5] as number] !== 'action') } as PackedGraph;
    const { page } = mountPage(quiet, { upTo: createBand });
    const { startHere } = createBand(page);
    page.entryIx.length = 0;
    expect(startHere(page.model, page.data)).toEqual([]);
  });

  it('shows once on a first visit, closes for good, and comes back from the strip', () => {
    const first = mountPage(data);
    const card = first.document.getElementById('start')!;
    expect(card.hidden).toBe(false);
    expect(card.querySelectorAll('.start-picks a').map((a: any) => a.getAttribute('href'))[1]).toBe('#missing/reason=unknown-base-url-env');
    card.querySelector('[data-start-close]')!.click();
    expect(card.hidden).toBe(true);
    expect(first.window.storage.get('flowatlas.start.dismissed')).toBe('1');
    first.document.getElementById('start-again')!.click();
    expect(card.hidden).toBe(false);
    expect(first.window.storage.has('flowatlas.start.dismissed')).toBe(false);

    const linked = mountPage(data, { address: 'file:///project/graph.html#busiest' });
    expect(linked.document.getElementById('start')!.hidden).toBe(true);
  });

  it('stays closed once closed, and comes every time when the browser keeps nothing', () => {
    const { window } = mountPage(data);
    window.document.getElementById('start')!.querySelector('[data-start-close]')!.click();
    const again = mountPage(data);
    // A new document, so the storage is new too; put back what the first kept.
    again.window.storage.set('flowatlas.start.dismissed', '1');
    again.page.startCard.hide();
    again.page.startCard.offer();
    expect(again.document.getElementById('start')!.hidden).toBe(true);

    const blocked = mountPage(data);
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); } };
    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true, writable: true });
    blocked.page.startCard.hide();
    expect(() => blocked.page.startCard.offer()).not.toThrow();
    expect(blocked.document.getElementById('start')!.hidden).toBe(false);
    expect(() => blocked.document.getElementById('start')!.querySelector('[data-start-close]')!.click()).not.toThrow();
  });
});
