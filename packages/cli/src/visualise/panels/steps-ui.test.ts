import { describe, expect, it } from 'vitest';
import { createStepsUi } from './steps-ui.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack, testRunTimePack } from './test-page.js';

/** The Steps tab and Copy as prompt (P103), one view with three modes (P99). */
describe('the steps', () => {
  const data = testPack('steps-ui');
  const at = nodeAt(data);

  it('lists a way in in call order, a row per step', () => {
    const { page, document } = mountPage(data);
    page.store.set('current', at('entry:gateway:http:POST:/orders'));
    page.showView('steps');
    const rows = document.querySelectorAll('#s-list .s-row');
    expect(rows.length).toBeGreaterThan(3);
    expect(textOf(rows[0]!.querySelector('.s-label'))).toBe('POST /orders');
    expect(textOf(document.getElementById('s-note'))).toMatch(/steps.* · in call order, as the source reads; not timed\.$/);
  });

  it('copies a way in as the prompt describe_for_prompt writes', async () => {
    const { page, document, window } = mountPage(data);
    const v = at('entry:gateway:http:POST:/orders');
    page.store.set('current', v);
    document.getElementById('s-copy')!.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(window.clipboard).toHaveLength(1);
    expect(window.clipboard[0]).toContain('POST /orders');
  });

  it('opens a way in’s steps above the drawing, and closes them again', () => {
    const { page, document } = mountPage(data);
    const v = at('entry:gateway:http:POST:/orders');
    page.stepsInGraph.toggle(v);
    const box = document.getElementById('g-steps')!;
    expect(box.hidden).toBe(false);
    expect(textOf(box.querySelector('p b'))).toBe('Steps of POST /orders');
    page.stepsInGraph.toggle(v);
    expect(box.hidden).toBe(true);
  });

  const onSteps = (address?: string) => {
    const mounted = mountPage(data, address ? { address } : {});
    mounted.page.store.set('current', at('entry:gateway:http:POST:/orders'));
    mounted.page.showView('steps');
    return mounted;
  };
  const rowOf = (document: any, id: string) => document.querySelector(`#s-list .s-row[data-node="${at(id)}"]`);

  it('opens compact: a line per step, the file by its name with the path in its tooltip, no word for what is certain', () => {
    const { document, page } = onSteps();
    expect(page.stepMode()).toBe('compact');
    expect(document.querySelector('[data-step-mode="compact"]')!.getAttribute('aria-pressed')).toBe('true');
    const first = document.querySelector('#s-list .s-row')!;
    expect(first.classList.contains('is-compact')).toBe(true);
    const where = first.querySelector('.s-where')!;
    expect(textOf(where)).toBe('orders.controller.ts:12');
    expect(where.getAttribute('title')).toBe('src/orders/orders.controller.ts:12');
    const marks = document.querySelectorAll('#s-list .s-mark').map(textOf);
    expect(marks).not.toContain('certain');
    expect(marks).not.toContain('read from code');
    // An annotated join changes nothing about how the steps read, so compact leaves it out; a guess stays.
    expect(marks).not.toContain('annotated');
    expect(textOf(rowOf(document, 'gateway#src/loop.ts:Loop.a').querySelector('.s-marks'))).toContain('best guess');
    expect(document.querySelectorAll('#s-list details.s-logs')).toHaveLength(0);
  });

  it('draws every mark and the path from the repository root in detailed, and remembers it', () => {
    const { document, window } = onSteps();
    document.querySelector('[data-step-mode="detailed"]')!.click();
    const first = document.querySelector('#s-list .s-row')!;
    expect(first.classList.contains('is-detailed')).toBe(true);
    expect(textOf(first.querySelector('.s-where'))).toBe('src/orders/orders.controller.ts:12');
    expect(document.querySelectorAll('#s-list .s-mark').map(textOf)).toContain('annotated');
    expect(window.storage.get('flowatlas.steps.mode')).toBe('detailed');
    expect(document.querySelector('[data-step-mode="detailed"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-step-mode="compact"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens on the mode kept for this reader, and on compact when nothing can be kept', () => {
    const kept = mountPage(data, { upTo: createStepsUi });
    kept.window.storage.set('flowatlas.steps.mode', 'waterfall');
    expect(createStepsUi(kept.page).stepMode()).toBe('waterfall');
    const odd = mountPage(data, { upTo: createStepsUi });
    odd.window.storage.set('flowatlas.steps.mode', 'sideways');
    expect(createStepsUi(odd.page).stepMode()).toBe('compact');
    const blocked = mountPage(data, { upTo: createStepsUi });
    const fail = () => { throw new Error('storage is off'); };
    (globalThis as any).localStorage = { getItem: fail, setItem: fail, removeItem: fail };
    const ui = createStepsUi(blocked.page);
    expect(ui.stepMode()).toBe('compact');
    ui.setStepMode('detailed');
    expect(ui.stepMode()).toBe('detailed');
  });

  it('draws a crossing as a row of its own, between the call and the other service’s handler', () => {
    for (const mode of ['compact', 'detailed']) {
      const { document, page } = onSteps();
      page.setStepMode(mode);
      const items = document.querySelectorAll('#s-list > li');
      const cross = items.findIndex((li: any) => li.classList.contains('s-cross'));
      expect(cross, mode).toBeGreaterThan(0);
      expect(textOf(items[cross]!)).toBe('→ orders · requests');
      expect(items[cross - 1]!.dataset.node).toBe(String(at('http_out:gateway#src/clients/orders.client.ts:20:4')));
      expect(items[cross + 1]!.dataset.node).toBe(String(at('entry:orders:http:POST:/orders')));
      // The mark it replaced is gone.
      expect(document.querySelectorAll('#s-list .s-mark').map(textOf).some((mark: string) => mark.startsWith('into '))).toBe(false);
      // The channel's handler in another service is a crossing too, in words.
      expect(document.querySelectorAll('#s-list .s-cross').map(textOf)).toContain('→ billing · consumes');
    }
  });

  it('says what runs in front of a step under it, never walked', () => {
    const { document } = onSteps();
    const first = document.querySelector('#s-list .s-first')!;
    expect(textOf(first)).toBe('runs first AuthGuard, RolesGuard');
    expect(first.previousElementSibling!.dataset.node).toBe(String(at('entry:gateway:http:POST:/orders')));
    expect(rowOf(document, 'guard:gateway#AuthGuard')).toBeNull();
  });

  it('draws a waterfall in units, its axis saying it is steps, not time', () => {
    const { document, page } = onSteps();
    page.setStepMode('waterfall');
    expect(textOf(document.querySelector('#s-list .w-axis-say'))).toBe('steps, not time');
    expect(document.getElementById('s-list')!.classList.contains('is-waterfall')).toBe(true);
    const bars = document.querySelectorAll('#s-list .w-row');
    expect(bars.length).toBeGreaterThan(5);
    expect(bars[0]!.getAttribute('style')).toContain('--start:0%;--span:100%');
    // A step on its own path again has no width: a mark where it would start.
    const loop = bars.filter((bar: any) => bar.classList.contains('is-mark'));
    expect(loop.length).toBeGreaterThan(0);
    expect(textOf(document.getElementById('s-note'))).toMatch(/laid out in steps, not time\.$/);
    // Hovering a bar lights its node, as a row does.
    const v = at('gateway#src/orders/orders.controller.ts:OrdersController.create');
    page.graph.go(at('entry:gateway:http:POST:/orders'));
    page.showView('steps');
    const bar = document.querySelector(`#s-list .w-row[data-node="${v}"] .w-bar`)!;
    bar.dispatchEvent(new FakeEvent('pointerover'));
    expect(document.querySelector('#g-world .g-node.is-hover')!.dataset.node).toBe(String(v));
  });

  it('says which bound left steps out, the depth by name', () => {
    const { document } = onSteps();
    const depth = document.getElementById('s-depth') as any;
    depth.value = '4';
    depth.dispatchEvent(new FakeEvent('change'));
    expect(textOf(document.querySelector('#s-list .s-cut'))).toMatch(/more steps? past depth 4: raise the depth; or open it in the graph\.$/);
  });

  it('draws the steps above the drawing in the mode the Steps tab is in, and switches both', () => {
    const { page, document } = mountPage(data);
    page.setStepMode('detailed');
    const v = at('entry:gateway:http:POST:/orders');
    page.stepsInGraph.toggle(v);
    const box = document.getElementById('g-steps')!;
    expect(box.querySelectorAll('.s-row.is-detailed').length).toBeGreaterThan(3);
    expect(box.querySelector('[data-step-mode="detailed"]')!.getAttribute('aria-pressed')).toBe('true');
    box.querySelector('[data-step-mode="waterfall"]')!.click();
    expect(page.stepMode()).toBe('waterfall');
    expect(textOf(box.querySelector('.w-axis-say'))).toBe('steps, not time');
  });
});

/** The steps with run time on them (P111): a waterfall in time, and the figures on every row. */
describe('the steps with run time', () => {
  const data = testRunTimePack('steps-ui-runtime');
  const at = nodeAt(data);
  const gateway = at('entry:gateway:http:POST:/orders');

  const waterfall = (options: Parameters<typeof mountPage>[1] = {}) => {
    const mounted = mountPage(data, options);
    mounted.page.store.set('current', gateway);
    mounted.page.setStepMode('waterfall');
    mounted.page.showView('steps');
    return mounted;
  };

  it('draws a waterfall on a time axis that says it is typical time per step, not one request', () => {
    const { document } = waterfall();
    expect(textOf(document.querySelector('#s-list .w-axis-say'))).toBe('typical time per step (p50), not one request');
    expect(document.querySelectorAll('#s-list .w-tick').map((tick) => textOf(tick))).toContain('10 ms');
    expect(textOf(document.getElementById('s-note'))).toMatch(/p95 310 ms · 10% errors · a bar per step, as long as its typical time \(p50\)/);
    // The caption says what is drawn: calls sit inside their caller's bar, not end to end (P145).
    expect(textOf(document.getElementById('s-note'))).toContain('what a step calls sits inside its bar, from where it starts');
    expect(textOf(document.getElementById('s-note'))).not.toContain('end to end');
    // A step no traffic timed is a hatched stand-in, and says so.
    const untimed = document.querySelector('#s-list .w-row.is-untimed .w-bar')!;
    expect(untimed.getAttribute('title')).toContain('no time measured: drawn at a stand-in width, not to scale');
    // A failing step keeps its chip on the waterfall.
    expect(textOf(document.querySelector('#s-list .w-row .s-mark.is-errors'))).toBe('10% errors');
    expect(document.getElementById('s-times')!.hidden).toBe(false);
  });

  it('writes the first tick from its place and a last one at the right edge up to it, so none runs off the axis (P145)', () => {
    const { document } = waterfall();
    const ticks = document.querySelectorAll('#s-list .w-tick');
    expect(ticks[0]!.getAttribute('class')).toBe('w-tick is-start');
    const placeOf = (tick: any) => Number(/left:([\d.]+)%/.exec(tick.getAttribute('style'))![1]);
    const last = ticks[ticks.length - 1]!;
    // Written up to its place only near the edge; further in, centred like the rest.
    expect(last.getAttribute('class')).toBe(placeOf(last) >= 90 ? 'w-tick is-end' : 'w-tick');
    expect(ticks.slice(1, -1).every((tick) => tick.getAttribute('class') === 'w-tick')).toBe(true);
    // The Steps tab's own waterfall uses the same rule: one whose last tick is at the edge writes it inward.
    const { page } = waterfall();
    const html = page.ticksHtml([0, 250, 500], 500, (n: number) => `${n} ms`);
    expect(html).toContain('class="w-tick is-end" style="left:100%">500 ms');
    expect(html).toContain('class="w-tick is-start" style="left:0%">0 ms');
  });

  it('switches to p95, and keeps the choice for the next visit', () => {
    const { document, window } = waterfall();
    (document.querySelector('#s-times [data-step-time="p95"]') as any).click();
    expect(textOf(document.querySelector('#s-list .w-axis-say'))).toBe('typical time per step (p95), not one request');
    expect(document.querySelector('#s-list .w-row .w-bar')!.getAttribute('title')).toBe('POST /orders · p95 310 ms');
    expect(window.localStorage.getItem('flowatlas.steps.time')).toBe('p95');
    expect(document.querySelector('#s-times [data-step-time="p95"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the units axis without run time, and offers no time switch', () => {
    const plain = testPack('steps-ui-units');
    const { page, document } = mountPage(plain);
    page.store.set('current', nodeAt(plain)('entry:gateway:http:POST:/orders'));
    page.setStepMode('waterfall');
    page.showView('steps');
    expect(textOf(document.querySelector('#s-list .w-axis-say'))).toBe('steps, not time');
    expect(document.getElementById('s-times')!.hidden).toBe(true);
    expect(document.querySelector('#s-list .is-untimed')).toBeNull();
  });

  it('marks compact and detailed rows with p95 and an error rate above one in a hundred', () => {
    const { page, document } = mountPage(data);
    page.store.set('current', gateway);
    for (const mode of ['compact', 'detailed']) {
      page.setStepMode(mode);
      page.showView('steps');
      const marks = document.querySelectorAll('#s-list .s-mark').map((mark) => textOf(mark));
      expect(marks).toContain('p95 300 ms');
      expect(marks).toContain('10% errors');
      expect(marks).toContain('p95 306 ms');
    }
  });

  it('offers the switch above the drawing too, in waterfall mode', () => {
    const { page, document } = mountPage(data);
    page.setStepMode('waterfall');
    page.stepsInGraph.toggle(gateway);
    expect(document.querySelector('#g-steps [data-step-time="p50"]')).not.toBeNull();
    expect(textOf(document.querySelector('#g-steps .w-axis-say'))).toBe('typical time per step (p50), not one request');
  });
});
