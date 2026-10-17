import { describe, expect, it } from 'vitest';
import { createFind } from './find.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

/** The one search over everything (P103). */
describe('the search over everything', () => {
  const data = testPack('find');

  it('lists what is called that, grouped, each opening in the graph', () => {
    const { page, document } = mountPage(data, { upTo: createFind });
    createFind(page);
    const input = document.getElementById('find')!;
    const out = document.getElementById('find-out')!;
    expect(out.hidden).toBe(true);
    input.value = 'invoice';
    input.dispatchEvent(new FakeEvent('input'));
    expect(out.hidden).toBe(false);
    expect(out.querySelectorAll('h4').length).toBeGreaterThan(0);
    expect(out.querySelectorAll('a').every((a: any) => a.getAttribute('href').startsWith('#graph/'))).toBe(true);
    expect(out.querySelectorAll('h4').map(textOf)).toContain('Tables · 1');
  });

  it('says when nothing is called that, and closes on Escape', () => {
    const { page, document } = mountPage(data, { upTo: createFind });
    createFind(page);
    const input = document.getElementById('find')!;
    const out = document.getElementById('find-out')!;
    input.value = 'zzzz-nothing';
    input.dispatchEvent(new FakeEvent('input'));
    expect(textOf(out)).toBe('Nothing here is called that.');
    input.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(out.hidden).toBe(true);
    expect(input.value).toBe('');
  });
});
