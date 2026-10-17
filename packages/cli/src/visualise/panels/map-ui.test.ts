import { describe, expect, it } from 'vitest';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

/** The Map tab (P103). */
describe('the map', () => {
  const data = testPack('map-ui');

  it('draws a box per service and what joins them, and opens a box in its details', () => {
    const { page, document } = mountPage(data);
    page.showView('map');
    const units = document.querySelectorAll('#m-world .m-unit');
    expect(units.length).toBe(data.map.boxes.length);
    expect(textOf(document.getElementById('m-status'))).toMatch(/^3 services · \d+ boxes drawn · \d+ links/);
    expect(textOf(document.querySelector('#m-details h3'))).toBe('The whole project');
    const gateway = units.find((unit) => textOf(unit.querySelector('.m-name')) === 'gateway')!;
    gateway.click();
    expect(textOf(document.querySelector('#m-details h3'))).toBe('gateway');
    document.querySelector('#m-details [data-map-close]')!.click();
    expect(textOf(document.querySelector('#m-details h3'))).toBe('The whole project');
  });

  it('opens what a link names, and writes it back into the address', () => {
    const { page, window } = mountPage(data);
    page.mapController.apply({
      selected: null, link: null, focus: null, toggled: [], hidden: [], mark: 'problems', packages: false, dev: false, layout: 'role',
    });
    page.showView('map');
    expect(window.location.hash).toBe('#map/m=problems&o=role');
  });

  it('lists the boxes as cards on a phone, by call-order column, each with what it reaches (P102)', () => {
    const { page, document } = mountPage(data, { width: 390 });
    page.showView('map');
    const cards = document.getElementById('m-cards')!;
    expect(cards.hidden).toBe(false);
    expect(document.getElementById('m-canvas')!.hidden).toBe(true);
    const listed = cards.querySelectorAll('.m-card');
    // One card per box the drawing would draw.
    expect(listed.length).toBe(document.querySelectorAll('#m-world .m-unit').length);
    expect(listed.length).toBe(data.map.boxes.length);
    expect(cards.querySelectorAll('.m-step-head').map(textOf)[0]).toMatch(/^step 1 \d+$/);
    const gateway = listed.find((card) => textOf(card.querySelector('.m-card-name')) === 'gateway')!;
    expect(textOf(gateway.querySelector('.m-card-sub'))).toMatch(/ways? in · \d+ nodes/);
    expect(textOf(gateway)).toContain('reaches');
    // Nothing selected: no details under the list.
    expect(document.getElementById('m-details')!.hidden).toBe(true);
  });

  it('opens a card’s details under it, follows its links, and keeps the drawing one tap away (P102)', () => {
    const { page, document, window } = mountPage(data, { width: 390 });
    page.showView('map');
    const name = (text: string) => document.querySelectorAll('#m-cards .m-card-name').find((b) => textOf(b) === text)!;
    name('gateway').click();
    const open = document.querySelector('#m-cards .m-card.is-open')!;
    expect(textOf(open.querySelector('.m-card-name'))).toBe('gateway');
    expect(open.querySelector('#m-details')).not.toBeNull();
    expect(textOf(document.querySelector('#m-details h3'))).toBe('gateway');
    expect(window.location.hash).toContain('gateway');
    // A link on the card opens the box it names.
    const reached = open.querySelector('.m-card-links [data-go-unit]')!;
    const other = reached.getAttribute('data-go-unit')!;
    reached.click();
    expect(document.querySelector('#m-cards .m-card.is-open')!.getAttribute('data-card')).toBe(other);
    document.querySelector('#m-cards [data-show-drawing]')!.click();
    expect(document.getElementById('m-cards')!.hidden).toBe(true);
    expect(document.getElementById('m-canvas')!.hidden).toBe(false);
    expect(document.querySelector('#m-stage > #m-details')).not.toBeNull();
    expect(document.getElementById('m-as-list')!.hidden).toBe(false);
    document.getElementById('m-as-list')!.click();
    expect(document.getElementById('m-cards')!.hidden).toBe(false);
  });

  it('draws the map as ever on a desktop, with no list', () => {
    const { page, document } = mountPage(data);
    page.showView('map');
    expect(document.getElementById('m-cards')!.hidden).toBe(true);
    expect(document.getElementById('m-as-list')!.hidden).toBe(true);
  });

  it('lets a plain wheel scroll the page, zooms on Ctrl or ⌘, and moves the map with the wheel in full screen (P102)', () => {
    const { page, document } = mountPage(data);
    page.showView('map');
    const canvas = document.getElementById('m-canvas')!;
    const world = document.getElementById('m-world')!;
    const wheel = (init: Record<string, unknown>) => {
      const event = new FakeEvent('wheel', { deltaX: 0, deltaY: 40, ...init });
      canvas.dispatchEvent(event);
      return event;
    };
    const before = world.getAttribute('transform');
    expect(wheel({}).defaultPrevented).toBe(false);
    expect(world.getAttribute('transform')).toBe(before);
    // Said once, in the corner: how to zoom instead.
    expect(textOf(canvas.querySelector('.g-wheel-hint'))).toMatch(/^(Ctrl|⌘) \+ scroll to zoom$/);
    wheel({});
    expect(canvas.querySelectorAll('.g-wheel-hint')).toHaveLength(1);
    expect(wheel({ ctrlKey: true }).defaultPrevented).toBe(true);
    expect(world.getAttribute('transform')).not.toBe(before);
    page.setMapFull(true);
    const zoomed = world.getAttribute('transform');
    expect(wheel({}).defaultPrevented).toBe(true);
    expect(world.getAttribute('transform')).not.toBe(zoomed);
  });

  it('lets a plain wheel scroll the page over the Graph too (P102)', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    const canvas = document.getElementById('g-canvas')!;
    const plain = new FakeEvent('wheel', { deltaY: 40 });
    canvas.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    const zoom = new FakeEvent('wheel', { deltaY: 40, metaKey: true });
    canvas.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
  });
});
