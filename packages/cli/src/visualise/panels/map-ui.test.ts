import { describe, expect, it } from 'vitest';
import { textOf } from './test-dom.js';
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
});
