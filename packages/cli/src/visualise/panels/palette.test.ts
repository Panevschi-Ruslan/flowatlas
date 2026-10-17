import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../frame.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

/** The command list (⌘K) and the keys (?) (P101). */
describe('the command list', () => {
  const data = testPack('palette');
  const key = (target: any, init: Record<string, unknown>) => {
    const event = new FakeEvent('keydown', init);
    target.dispatchEvent(event);
    return event;
  };
  const offered = (document: any): string[] => document.querySelectorAll('#palette-list [role="option"]').map(textOf);

  it('opens on ⌘K or Ctrl+K, takes the keyboard, and gives it back on Escape', () => {
    const { document } = mountPage(data);
    const palette = document.getElementById('palette')!;
    const tab = document.querySelector('.tab[data-view="steps"]')!;
    tab.focus();
    key(document.body, { key: 'k', metaKey: true });
    expect(palette.hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('palette-input'));
    expect(offered(document)).toContain('Go to Steps');
    // Tab stays inside while it is open.
    expect(key(document.getElementById('palette-input'), { key: 'Tab' }).defaultPrevented).toBe(true);
    key(document.getElementById('palette-input'), { key: 'Escape' });
    expect(palette.hidden).toBe(true);
    expect(document.activeElement).toBe(tab);
    key(document.body, { key: 'k', ctrlKey: true });
    expect(palette.hidden).toBe(false);
  });

  it('filters as typed, moves with the arrows and runs what Enter is on', () => {
    const { page, document } = mountPage(data);
    key(document.body, { key: 'k', metaKey: true });
    const input = document.getElementById('palette-input')!;
    input.value = 'go to';
    input.dispatchEvent(new FakeEvent('input'));
    const list = offered(document);
    expect(list.every((say) => say.startsWith('Go to ') || say.startsWith('Search for'))).toBe(true);
    expect(list).not.toContain('Go to Map');
    expect(list.at(-1)).toBe('Search for ‘go to’');
    input.value = 'crossings';
    input.dispatchEvent(new FakeEvent('input'));
    expect(offered(document)).toEqual(['Go to Crossings', 'Search for ‘crossings’']);
    key(input, { key: 'Enter' });
    expect(page.store.get('view')).toBe('crossings');
    expect(document.getElementById('palette')!.hidden).toBe(true);
  });

  it('offers what the tab open can do, and hands anything else to the search', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    key(document.body, { key: 'k', metaKey: true });
    expect(offered(document)).toEqual(expect.arrayContaining(['Full screen', 'Types on', 'Export as SVG', 'Export as PNG',
      'Copy a link to this view', 'Show the problems', 'Show every key']));
    expect(offered(document).some((say) => say.startsWith('Copy as prompt: '))).toBe(true);
    const input = document.getElementById('palette-input')!;
    input.value = 'invoice';
    input.dispatchEvent(new FakeEvent('input'));
    key(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(`palette-opt-${offered(document).length - 1}`);
    key(input, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('find'));
    expect(document.getElementById('find')!.value).toBe('invoice');
    expect(document.getElementById('find-out')!.hidden).toBe(false);
  });

  it('lists every key of SHORTCUTS on ?, by where it works, and closes on Escape', () => {
    const { document } = mountPage(data);
    const help = document.getElementById('keys-help')!;
    key(document.body, { key: '?' });
    expect(help.hidden).toBe(false);
    const listed = document.querySelectorAll('#keys-list [data-shortcut]').map((row: any) => row.dataset.shortcut);
    expect(listed.sort()).toEqual(SHORTCUTS.map((shortcut) => shortcut.id).sort());
    expect(document.querySelectorAll('#keys-list h4').map(textOf)).toEqual(
      ['Anywhere', 'On the tab row', 'In the Ways in list', 'In the search', 'On the Graph tab', 'On the Map tab',
        'In the command list or a row menu']);
    key(help.querySelector('.keys-box'), { key: 'Escape' });
    expect(help.hidden).toBe(true);
    // Not from a field, where ? is typed.
    const field = document.getElementById('find')!;
    field.focus();
    key(field, { key: '?' });
    expect(help.hidden).toBe(true);
  });

  it('keeps the keys from the page behind while open', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    key(document.body, { key: '?' });
    key(document.querySelector('.keys-box'), { key: 'f' });
    expect(document.documentElement.classList.contains('is-full')).toBe(false);
  });

  it('turns the theme from the keyboard, to the mode the strip’s button would (P102)', () => {
    const { page, document } = mountPage(data);
    key(document.body, { key: 'k', metaKey: true });
    const input = document.getElementById('palette-input')! as any;
    input.value = 'theme';
    input.dispatchEvent(new FakeEvent('input'));
    expect(offered(document)[0]).toBe('Theme: light');
    key(input, { key: 'Enter' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(page.themeMode()).toBe('light');
  });
});
