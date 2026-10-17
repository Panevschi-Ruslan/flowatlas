import { describe, expect, it } from 'vitest';
import { createWalk } from './walk.js';
import { textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** The Walk tab (P103). */
describe('the walk', () => {
  const data = testPack('walk');

  it('follows a way in outward, says what runs first, and marks where it leaves a service', () => {
    const { page, document } = mountPage(data, { upTo: createWalk });
    const { drawWalk } = createWalk(page);
    page.store.set('current', nodeAt(data)('entry:gateway:http:POST:/orders'));
    drawWalk();
    expect(textOf(document.getElementById('walk-title'))).toBe('POST /orders');
    const labels = document.querySelectorAll('#walk .step .label').map(textOf);
    expect(labels[0]).toBe('POST /orders');
    expect(labels).toContain('OrdersController.create');
    expect(labels).toContain('OrdersService.create');
    const rules = document.querySelectorAll('#walk .crossing').map(textOf);
    expect(rules[0]).toBe('runs firstAuthGuard, RolesGuard');
    expect(rules.some((rule) => rule.startsWith('gateway → orders'))).toBe(true);
  });

  it('draws nothing until a way in is picked', () => {
    const { page, document } = mountPage(data, { upTo: createWalk });
    createWalk(page).drawWalk();
    expect(document.getElementById('walk')!.childNodes).toHaveLength(0);
  });
});
