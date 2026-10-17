import { describe, expect, it } from 'vitest';
import { createBand } from './band.js';
import { textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

/** The masthead, the band and the service rail (P103). */
describe('the band', () => {
  const data = testPack('band');

  it('says what was read and joined, a tile per figure', () => {
    const { page, document } = mountPage(data, { upTo: createBand });
    createBand(page);
    const tiles = document.querySelectorAll('#band .stat').map((tile) => textOf(tile.querySelector('dt')));
    expect(tiles).toEqual(['Graph', 'Service calls', 'Browser calls', 'Routes reached', 'Channels', 'Missed']);
    expect(textOf(document.querySelector('#band .stat dd'))).toBe(`${data.nodes.length} nodes`);
    expect(textOf(document.getElementById('standfirst'))).toMatch(/^\d+ of \d+ repositories read and joined into one graph/);
    expect(textOf(document.getElementById('built'))).toMatch(/^built \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/);
  });

  it('puts a button per service on the rail, which filters the services every tab shows', () => {
    const { page, document } = mountPage(data, { upTo: createBand });
    page.drawEntries = () => {};
    const { fleet } = createBand(page);
    const ships = fleet.querySelectorAll('.ship');
    expect(ships.map((ship: any) => ship.dataset.repo)).toEqual(['billing', 'gateway', 'orders']);
    const heard: string[] = [];
    page.store.on((key: string) => heard.push(key));
    ships[0].click();
    expect(ships[0].getAttribute('aria-pressed')).toBe('false');
    expect(page.store.get('shown').has('billing')).toBe(false);
    expect(heard).toEqual(['shown']);
    expect(document.getElementById('fleet')).toBe(fleet);
  });

  it('adds no run-time tile when no trace was imported', () => {
    const { page, document } = mountPage(data, { upTo: createBand });
    createBand(page);
    expect(document.querySelectorAll('#band .stat dt').map(textOf)).not.toContain('Seen at run time');
  });
});
