import { describe, expect, it } from 'vitest';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

const key = (name: string) => new FakeEvent('keydown', { key: name });
const settle = () => new Promise((done) => setTimeout(done, 0));

/** One overflow menu per row, and the toast that says what it copied (P100). */
describe('the row menu', () => {
  const data = testPack('menu');

  it('writes a ⋯ button that says it opens a menu', () => {
    const { page, document } = mountPage(data);
    const host = document.createElement('div');
    host.innerHTML = page.rowMenu(0, 'this place');
    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('row-menu');
    expect(button.getAttribute('aria-label')).toBe('Copy from this place');
  });

  it('offers an item a later ticket adds, keeps Tab inside, and hands the keyboard back', () => {
    const { page, document } = mountPage(data);
    page.ROW_MENU_ITEMS.push({ id: 'later', say: 'Copy something else', text: () => 'else' });
    const host = document.createElement('div');
    host.innerHTML = page.rowMenu(0);
    document.body.append(host);
    const button = host.querySelector('button')!;
    button.focus();
    button.click();
    const menu = document.getElementById('row-menu')!;
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(textOf(items.at(-1)!.querySelector('span'))).toBe('Copy something else');
    const tab = key('Tab');
    menu.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(false);
    // Clicking the button again closes it.
    button.click();
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('opens any list of items, and says what it copied in the toast', async () => {
    const { page, document, window } = mountPage(data);
    const button = document.createElement('button');
    document.body.append(button);
    let ran = 0;
    page.openMenu(button, [{ say: 'One', run: () => { ran += 1; } }, { say: 'Two', sub: 'the second', run: () => {} }], ['Read this first.']);
    const menu = document.getElementById('row-menu')!;
    expect(textOf(menu.querySelectorAll('[role="menuitem"]')[1]!.querySelector('small'))).toBe('the second');
    expect(textOf(document.getElementById('row-menu-foot'))).toBe('Read this first.');
    menu.dispatchEvent(key('Enter'));
    expect(ran).toBe(1);
    expect(menu.hidden).toBe(true);
    page.toast('Copied a command; run it in the project:', 'flowatlas accept x');
    const toast = document.getElementById('toast')!;
    expect(toast.hidden).toBe(false);
    expect(textOf(toast.querySelector('span'))).toBe('Copied a command; run it in the project:');
    expect(textOf(toast.querySelector('code'))).toBe('flowatlas accept x');
    expect(window.clipboard).toEqual([]);
    await settle();
  });

  it('hands the text to a prompt where the clipboard is blocked', async () => {
    const { page, document, window } = mountPage(data);
    let asked: string | null = null;
    (window as any).prompt = (_say: string, text: string) => { asked = text; return null; };
    (globalThis as any).navigator.clipboard.writeText = async () => { throw new Error('blocked'); };
    (document as any).execCommand = () => false;
    const host = document.createElement('div');
    host.innerHTML = page.rowMenu(0);
    document.body.append(host);
    host.querySelector('button')!.click();
    document.getElementById('row-menu')!.dispatchEvent(key('ArrowDown'));
    document.getElementById('row-menu')!.dispatchEvent(key('Enter'));
    await settle();
    expect(asked).toMatch(/^flowatlas accept /);
  });
});
