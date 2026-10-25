import { describe, expect, it } from 'vitest';
import { layout, neighbourhood } from '../graph.js';
import { createGraphDraw } from './graph-draw.js';
import { textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** The Graph tab's drawing (P103). */
describe('the drawing', () => {
  const data = testPack('graph-draw');
  const at = nodeAt(data);

  it('draws a neighbourhood as boxes in a lane per service, with its columns named', () => {
    const { page, document } = mountPage(data, { upTo: createGraphDraw });
    const drawing = createGraphDraw(page);
    const { state, model, BOX } = { ...drawing, model: page.model };
    state.focus = at('entry:gateway:http:POST:/orders');
    state.hood = neighbourhood(model, { focus: state.focus, hops: 2, cap: 40, filter: drawing.filterNow(), group: true });
    state.placed = layout(model, state.hood, { column: BOX.column, row: BOX.row, laneGap: BOX.laneGap, laneHead: BOX.laneHead });
    drawing.drawDrawing();
    const world = document.getElementById('g-world')!;
    expect(world.querySelectorAll('.g-node')).toHaveLength(state.hood.nodes.length);
    expect(world.querySelector('.g-node.is-focus')!.getAttribute('aria-label')).toMatch(/^POST \/orders, entry, gateway/);
    expect(world.querySelectorAll('.g-lane text').map(textOf)[0]).toBe('gateway');
    expect(world.querySelectorAll('.g-col').map(textOf)).toContain('focus');
    expect(document.getElementById('g-svg')!.getAttribute('aria-label')).toBe('Neighbourhood of POST /orders');
  });

  it('moves the camera and tells whoever watches it', () => {
    const { page, document } = mountPage(data, { upTo: createGraphDraw });
    const { camera } = createGraphDraw(page);
    const seen: number[] = [];
    camera.watch((view: { k: number }) => seen.push(view.k));
    camera.zoom(2);
    expect(seen).toEqual([2]);
    expect(document.getElementById('g-world')!.getAttribute('transform')).toBe('translate(-400 -250) scale(2)');
  });

  it('cards a node: its full name, whose and where', () => {
    const { page } = mountPage(data);
    const v = at('gateway#src/orders/orders.service.ts:OrdersService.create');
    page.graph.go(v);
    const card = page.nodeCardHtml(v);
    expect(card).toContain('OrdersService.create');
    expect(card).toContain('gateway');
  });
});
