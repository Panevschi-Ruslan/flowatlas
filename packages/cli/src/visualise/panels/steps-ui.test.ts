import { describe, expect, it } from 'vitest';
import { textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** The Steps tab and Copy as prompt (P103). */
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
});
