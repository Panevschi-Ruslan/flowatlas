import { describe, expect, it } from 'vitest';
import { textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** Problems, a path between two nodes, and impact on the Graph tab (P103). */
describe('checking', () => {
  const data = testPack('checking');
  const at = nodeAt(data);

  it('lists where to look first', () => {
    const { page, document } = mountPage(data);
    page.graph.go(at('entry:gateway:http:POST:/orders'));
    const button = document.getElementById('g-problems')!;
    expect(textOf(button)).toMatch(/^Problems · \d+$/);
    button.click();
    const answer = document.getElementById('g-answer')!;
    expect(answer.hidden).toBe(false);
    expect(textOf(answer)).toMatch(/^Where to look first/);
  });

  it('draws the shortest path between two ends, and what reaches a node', () => {
    const { page, document } = mountPage(data);
    const from = at('entry:gateway:http:POST:/orders');
    const to = at('table:billing#Invoice');
    page.graph.go(from);
    page.chooseEnd(from, 'from');
    page.chooseEnd(to, 'to');
    expect(textOf(document.getElementById('g-status'))).toMatch(/drawn on the shortest path from POST \/orders to Invoice\.$/);
    page.askImpact(to);
    expect(textOf(document.getElementById('g-status'))).toMatch(/drawn upstream of Invoice, of \d+ nodes that reach it\.$/);
    expect(page.dismissAnswer()).toBe(true);
  });
});
