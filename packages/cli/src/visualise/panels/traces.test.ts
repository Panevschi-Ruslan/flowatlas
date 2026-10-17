import { describe, expect, it } from 'vitest';
import { createTraces } from './traces.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack, testRunTimePack } from './test-page.js';

/** Run time as requests (P111): the Traces tab and the Run time changes tab. */
describe('the traces', () => {
  const data = testRunTimePack('traces');
  const at = nodeAt(data);
  const gateway = at('entry:gateway:http:POST:/orders');

  it('is a tab only when the observed file kept samples', () => {
    expect(mountPage(data).document.getElementById('tab-traces')!.hidden).toBe(false);
    expect(mountPage(testPack('traces-none')).document.getElementById('tab-traces')!.hidden).toBe(true);
    const unsampled = { ...data, observed: { ...data.observed!, samples: undefined } } as typeof data;
    expect(mountPage(unsampled).document.getElementById('tab-traces')!.hidden).toBe(true);
  });

  it('lists the slowest and the failing request, slowest first, and draws the first on its own time axis', () => {
    const { page, document } = mountPage(data);
    page.showView('traces');
    const picks = document.querySelectorAll('#tab-sheet [data-trace-pick]');
    expect(picks.map((pick) => textOf(pick))).toEqual([
      'POST /ordersgateway · 310 ms · 201 · slowest',
      'POST /ordersgateway · 40 ms · 500 · failing',
    ]);
    expect(picks[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(picks[1]!.classList.contains('is-failure')).toBe(true);
    const tree = document.querySelector('#tab-sheet .tr-tree')!;
    expect(textOf(tree.querySelector('.w-axis-say'))).toBe('one request, as it ran');
    const rows = tree.querySelectorAll('.tr-row');
    expect(rows).toHaveLength(5);
    // The hop is most of the request: it starts 4 ms in and lasts 300 of 310.
    const hop = rows[3]!;
    expect(hop.getAttribute('data-node')).toBe(String(at('http_out:gateway#src/clients/orders.client.ts:20:4')));
    expect(hop.getAttribute('style')).toContain(`--start:${(4 / 310) * 100}%`);
    expect(hop.getAttribute('style')).toContain(`--span:${(300 / 310) * 100}%`);
    // A span the map has no node for says so and links nowhere.
    const lookup = rows[2]!;
    expect(lookup.getAttribute('data-node')).toBeNull();
    expect(textOf(lookup)).toContain('not in the map');
    expect(rows[1]!.querySelector('.to-graph')).not.toBeNull();
  });

  it('draws another request when it is picked, with what the sample left out', () => {
    const { page, document } = mountPage(data);
    page.showView('traces');
    (document.querySelectorAll('#tab-sheet [data-trace-pick]')[1] as any).click();
    const tree = document.querySelector('#tab-sheet .tr-tree')!;
    expect(textOf(tree.querySelector('.tr-head'))).toContain('40 ms · status 500');
    expect(tree.querySelectorAll('.tr-row.is-failure')).toHaveLength(2);
    expect(tree.querySelector('.tr-row.is-unplaced')).not.toBeNull();
    expect(textOf(tree.querySelector('.cut'))).toBe('4 more spans not kept: a sample holds at most a few hundred');
  });

  it('opens on the sample of the way in picked elsewhere', () => {
    const { page, document } = mountPage(data);
    page.store.set('current', gateway);
    page.showView('traces');
    expect(textOf(document.querySelector('#tab-sheet .tr-head'))).toContain('POST /orders');
    expect(document.querySelector('#tab-sheet .tr-head a')!.getAttribute('href')).toMatch(/^#steps\//);
  });

  it('says how samples are kept when there are none to draw', () => {
    const { page, document } = mountPage(testPack('traces-empty'), { upTo: createTraces });
    Object.assign(page, createTraces(page));
    (page as any).drawTraces();
    expect(textOf(document.getElementById('tab-sheet'))).toContain('unless it was run with --no-samples');
  });

  it('carries no trace id, no span id and no time of day into the page', () => {
    const text = JSON.stringify(data);
    expect(text).not.toContain('traceId');
    expect(text).not.toContain('a'.repeat(32));
    expect(text).not.toContain('spanId');
    expect(JSON.stringify(data.observed!.samples)).not.toContain('2026-01-01');
  });

  it('says a link to a tab this page has not got, and opens the map', () => {
    const { page, document } = mountPage(testPack('traces-link'), { address: 'file:///project/page.html#traces' });
    expect(page.store.get('view')).toBe('map');
    expect(textOf(document.getElementById('v-notice'))).toContain('Traces tab, which a page has only when its observed file holds sampled requests');
    const other = mountPage(testPack('traces-link-2'), { address: 'file:///project/page.html#runtime' });
    expect(textOf(other.document.getElementById('v-notice'))).toContain('--observed-diff');
  });
});

describe('the run time changes', () => {
  const data = testRunTimePack('runtime-diff', { diff: { slower: 3, failing: 9, stranger: true } });

  it('is a tab only on a page written with --observed-diff', () => {
    expect(mountPage(data).document.getElementById('tab-runtime')!.hidden).toBe(false);
    expect(mountPage(testRunTimePack('runtime-nodiff')).document.getElementById('tab-runtime')!.hidden).toBe(true);
  });

  it('lists what got slower and what fails more, both windows side by side, each row opening its way in', () => {
    const { page, document } = mountPage(data);
    page.showView('runtime');
    const sheet = document.getElementById('tab-sheet')!;
    expect(textOf(sheet.querySelector('.c-sum'))).toBe(
      'before.json 2026-01-01 08:00 to 09:00 UTC→after.json 2026-01-01 08:00 to 09:00 UTC');
    const heads = sheet.querySelectorAll('h4').map((h) => textOf(h));
    expect(heads).toEqual(['Slower · 3', 'Failing more · 3', 'Newly seen · 0', 'No longer seen · 0']);
    const first = sheet.querySelector('.rt-table tbody tr')!;
    expect(textOf(first)).toContain('310 ms → 910 ms +194%');
    expect(first.querySelector('a')!.getAttribute('href')).toMatch(/^#steps\//);
    // The other file's ids this graph does not hold are left out, and counted.
    expect(textOf(sheet)).toContain('2 ids in the files are not in this graph and were left out.');
    expect(textOf(sheet)).toContain('10% → 30%');
  });
});

describe('run time elsewhere on the page', () => {
  const data = testRunTimePack('runtime-page');
  const at = nodeAt(data);

  it('says the hours the figures cover in the header', () => {
    expect(textOf(mountPage(data).document.getElementById('built'))).toContain('seen 2026-01-01 08:00 to 09:00 UTC');
    expect(textOf(mountPage(testPack('runtime-header')).document.getElementById('built'))).not.toContain('seen ');
  });

  it('gives a way in its p95 and its error rate beside how often it was seen', () => {
    const { document } = mountPage(data);
    const row = document.querySelector(`#entries [data-entry="${at('entry:gateway:http:POST:/orders')}"]`)!;
    expect(textOf(row)).toContain('seen ×30 · p95 310 ms · 10% errors');
  });

  it('colours the Map’s links by traffic or by p95, with a key, and leaves unseen links neutral', () => {
    const { page, document, window } = mountPage(data);
    page.showView('map');
    const heat = document.getElementById('m-heat')!;
    expect(heat.hidden).toBe(false);
    expect(document.getElementById('m-heat-key')!.hidden).toBe(true);
    (heat.querySelector('[data-map-heat="p95"]') as any).click();
    const hot = document.querySelectorAll('#m-world .m-link.is-heat');
    expect(hot.length).toBeGreaterThan(0);
    expect(hot.every((link) => /--heat: var\(--heat-\d\)/.test(link.getAttribute('style') ?? ''))).toBe(true);
    expect(document.querySelectorAll('#m-world .m-link.is-cold').length).toBeGreaterThan(0);
    const key = document.getElementById('m-heat-key')!;
    expect(key.hidden).toBe(false);
    expect(textOf(key)).toMatch(/^p95 of the slowest edge\d.* ms.*300 ms not seenseen 2026-01-01 08:00 to 09:00 UTC$/);
    expect(window.location.hash).toContain('x=p95');
    (heat.querySelector('[data-map-heat="traffic"]') as any).click();
    expect(textOf(key)).toContain('requests through');
    (heat.querySelector('[data-map-heat=""]') as any).click();
    expect(document.querySelectorAll('#m-world .m-link.is-heat')).toHaveLength(0);
    expect(key.hidden).toBe(true);
  });

  it('offers no heat without traffic, and no p95 heat without a time', () => {
    expect(mountPage(testPack('runtime-noheat')).document.getElementById('m-heat')!.hidden).toBe(true);
    const counted = { ...data, observed: { ...data.observed!, joins: { 0: { count: 3, lastSeen: null } }, entries: {}, nodes: undefined } } as typeof data;
    const { document } = mountPage(counted);
    expect((document.querySelector('[data-map-heat="p95"]') as any).disabled).toBe(true);
    expect((document.querySelector('[data-map-heat="traffic"]') as any).disabled).toBe(false);
  });

  it('opens a link to the map with its heat', () => {
    const { document } = mountPage(data, { address: 'file:///project/page.html#map/x=traffic' });
    expect(document.querySelector('[data-map-heat="traffic"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('#m-world .m-link.is-heat').length).toBeGreaterThan(0);
  });

  it('hears a key on the heat buttons as a click', () => {
    const { document } = mountPage(data);
    const button = document.querySelector('[data-map-heat="traffic"]') as any;
    button.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});
