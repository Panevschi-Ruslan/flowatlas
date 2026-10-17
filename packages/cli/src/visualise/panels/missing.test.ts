import { RISK_NAMES, type Unresolved } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { ROW } from '../graph.js';
import { PAGE_WORDS, wordFor } from '../frame.js';
import { createMissing } from './missing.js';
import { FakeEvent, textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

/** A route of the test project with nothing in front of it, as the route audit writes one. */
const unguarded = (file: string, line: number, path: string): Unresolved => ({
  file, line, reason: 'route-unguarded', service: 'orders', message: `GET ${path} has no guard in front of it.`,
});

/* The project's three gaps, and beside them: three unguarded routes (two of
   them in a file accepted with a note), a query once per item of a loop and
   one per item on purpose (a note, P89), a route that checks in its own body
   (a note), sixty rows of one gap (more than a reason lists), and a service
   that read nothing (a row with no single place). */
const EXTRA: Unresolved[] = [
  unguarded('src/orders/orders.controller.ts', 10, '/orders/:param/items'),
  unguarded('src/admin/admin.controller.ts', 12, '/admin/users'),
  unguarded('src/admin/admin.controller.ts', 18, '/admin/stats'),
  { file: 'src/orders/orders.service.ts', line: 40, reason: 'query-in-loop', service: 'orders', level: 'info',
    message: 'OrdersService.total queries order_items once per order', meta: { severity: 'likely' } },
  { file: 'src/orders/orders.service.ts', line: 52, reason: 'query-in-loop', service: 'orders', level: 'info',
    message: 'OrdersService.notify writes once per recipient', meta: { severity: 'note' } },
  { file: 'src/orders/orders.controller.ts', line: 30, reason: 'route-checked-in-body', service: 'orders', level: 'info',
    message: 'GET /orders/mine checks the caller in its body' },
  ...Array.from({ length: 60 }, (_, i): Unresolved => ({
    file: `src/catalog/item-${i}.ts`, line: i + 1, reason: 'type-unresolved', service: 'gateway', message: `Item${i} is not resolved`,
  })),
  { file: '', line: 0, reason: 'service-read-nothing', service: 'gateway', message: 'gateway read no source file' },
];

const ACCEPTED = [{
  reason: 'route-unguarded', service: 'orders', file: 'src/admin/*', note: 'the admin routes sit behind the gateway',
  acceptedAt: '2026-01-01T00:00:00.000Z',
}];

const key = (name: string, init: Record<string, unknown> = {}) => new FakeEvent('keydown', { key: name, ...init });

describe('what did not join, split by what it is (P100)', () => {
  const data = testPack('missing-split', { unresolved: EXTRA, accepted: ACCEPTED });
  const reasonOf = (r: number) => data.dicts.reasons[data.rows[r]![ROW.reason] as number];

  const mount = () => {
    const mounted = mountPage(data);
    mounted.page.showView('missing');
    return mounted;
  };

  it('packs what each reason is, so the page never reads it off the words', () => {
    const at = (reason: string) => data.dicts.reasonClass![data.dicts.reasons.indexOf(reason)];
    expect(data.dicts.reasonClass).toHaveLength(data.dicts.reasons.length);
    expect(at('route-unguarded')).toEqual(['finding', 'auth']);
    expect(at('query-in-loop')).toEqual(['finding', 'performance']);
    expect(at('di-token-unknown')).toEqual(['gap']);
    expect(at('route-checked-in-body')).toEqual(['note']);
    // The loop that is per item on purpose is a note by what it recorded, not by its reason.
    const loops = data.rows.map((_, r) => r).filter((r) => reasonOf(r) === 'query-in-loop');
    expect(loops.map((r) => data.rowKinds?.[String(r)])).toEqual([undefined, 'note']);
  });

  it('draws three sections in order, each with its count, and the risks auth first', () => {
    const { document } = mount();
    expect(textOf(document.getElementById('view-title'))).toBe('What did not join');
    const sections = document.querySelectorAll('#tab-sheet section.nj-section');
    expect(sections.map((section: any) => section.getAttribute('id'))).toEqual(['nj-gaps', 'nj-risks', 'nj-accepted']);
    expect(sections.map((section) => textOf(section.querySelector('h4')))).toEqual(['Couldn’t join 64', 'Risks 2', 'Accepted 2']);
    const gaps = document.querySelectorAll('#nj-gaps .nj-row').map((row: any) => row.dataset.reason);
    expect(gaps).toEqual(['type-unresolved', 'call-dynamic-receiver', 'di-token-unknown', 'service-read-nothing', 'unknown-base-url-env']);
    expect(document.querySelectorAll('#nj-risks h5.nj-risk').map(textOf)).toEqual([`${PAGE_WORDS.risk.auth} 1`, `${PAGE_WORDS.risk.performance} 1`]);
    expect(document.querySelectorAll('#nj-risks .nj-row').map((row: any) => row.dataset.reason)).toEqual(['route-unguarded', 'query-in-loop']);
    // A risk's tone is its risk's; a gap has none.
    expect(document.querySelector('#nj-risks .nj-row[data-reason="route-unguarded"] .tag')!.className).toBe('tag is-bad');
    expect(document.querySelector('#nj-gaps .nj-row[data-reason="type-unresolved"] .tag')!.className).toBe('tag');
    // The notes are left out, and said to be.
    expect(document.querySelector('#tab-sheet [data-reason="route-checked-in-body"]')).toBeNull();
    expect(textOf(document.querySelector('.nj-notes'))).toMatch(/^2 notes say how a join/);
  });

  it('lists every row in exactly one place: a section, the accepted list, or the notes line', () => {
    const { document } = mount();
    const listed = document.querySelectorAll('#nj-gaps .nj-count, #nj-risks .nj-count').reduce((n, el) => n + Number(textOf(el)), 0);
    const accepted = document.querySelectorAll('#nj-accepted tbody tr').length;
    expect(listed + accepted + 2).toBe(data.rows.length);
  });

  it('lists a risk once on the tab, never again under what the reader could not follow', () => {
    const { document } = mount();
    expect(document.querySelectorAll('#tab-sheet .nj-row[data-reason="route-unguarded"]')).toHaveLength(1);
    expect(document.querySelectorAll('#tab-sheet [title="route-unguarded"]')).toHaveLength(1 + 2);
    const fold = document.getElementById('cant-follow');
    if (fold !== null) {
      expect(fold.closest('#nj-gaps')).not.toBeNull();
      expect(textOf(fold)).not.toContain(wordFor('reason', 'route-unguarded'));
    }
  });

  it('names no service in the command for the rest when the reason is in more than one (P141)', () => {
    const spread = testPack('missing-spread', { unresolved: [...EXTRA, ...Array.from({ length: 5 }, (_, i): Unresolved => ({
      file: `src/orders/line-${i}.ts`, line: i + 1, reason: 'type-unresolved', service: 'orders', message: `Line${i} is not resolved`,
    }))] });
    const { page, document } = mountPage(spread);
    page.showView('missing');
    const row = document.querySelector('.nj-row[data-reason="type-unresolved"]')!;
    (row.querySelector('summary') as any).click();
    expect(textOf(row.querySelectorAll('.nj-places > p.hint').at(-1)!)).toBe(
      '15 more places; flowatlas doctor --reason type-unresolved --max-nodes 65 lists every one.');
  });

  it('says each reason in words, its code in the tooltip and in the row opened', () => {
    const { document } = mount();
    const tags = document.querySelectorAll('#tab-sheet .nj-row .nj-what .tag');
    expect(tags.map(textOf)).toEqual(tags.map((tag) => wordFor('reason', tag.getAttribute('title')!)));
    const row = document.querySelector('.nj-row[data-reason="di-token-unknown"]')!;
    (row.querySelector('summary') as any).click();
    expect(textOf(row.querySelector('.nj-code code'))).toBe('di-token-unknown');
  });

  it('opens a row to every place it stands for, fifty at most, and the command for the rest', () => {
    const { document } = mount();
    const row = document.querySelector('.nj-row[data-reason="type-unresolved"]')!;
    expect(row.querySelectorAll('.nj-place')).toHaveLength(0);
    (row.querySelector('summary') as any).click();
    expect((row.querySelector('details') as any).open).toBe(true);
    expect(row.querySelectorAll('.nj-place')).toHaveLength(50);
    // The command for the rest lists that reason only, and only its service when all of it is in one (P141).
    expect(textOf(row.querySelectorAll('.nj-places > p.hint').at(-1)!)).toBe(
      '10 more places; flowatlas doctor --reason type-unresolved --max-nodes 60 --service gateway lists every one.');
    const routes = document.querySelector('.nj-row[data-reason="route-unguarded"]')!;
    (routes.querySelector('summary') as any).click();
    // The accepted ones are under Accepted, not here.
    expect(routes.querySelectorAll('.nj-place').map((place) => textOf(place.querySelector('.nj-where')))).toEqual([
      'orders src/orders/orders.controller.ts:10',
    ]);
    const nowhere = document.querySelector('.nj-row[data-reason="service-read-nothing"]')!;
    (nowhere.querySelector('summary') as any).click();
    expect(textOf(nowhere.querySelector('.nj-place .nj-where'))).toBe('gateway no single place');
  });

  it('gives each row one ⋯ menu and no inline buttons', () => {
    const { document } = mount();
    // A row closed holds its menu and nothing else to press (the graph link is a link).
    for (const row of document.querySelectorAll('#tab-sheet .nj-row')) expect(row.querySelectorAll('button')).toHaveLength(1);
    const rows = document.querySelectorAll('#tab-sheet .nj-row');
    expect(document.querySelectorAll('#tab-sheet .nj-row > .nj-tools [data-row-menu]')).toHaveLength(rows.length);
    expect(document.querySelectorAll('#tab-sheet [data-prompt], #tab-sheet [data-accept-cmd], #tab-sheet .accept-cmd')).toHaveLength(0);
    expect(document.querySelectorAll('#tab-sheet button').filter((button) => textOf(button) === 'Accept all like this')).toHaveLength(0);
  });

  it('opens the menu with Enter, moves with the arrows, copies a command for this place, and closes with Escape', async () => {
    const { document, window } = mount();
    const button = document.querySelector('.nj-row[data-reason="route-unguarded"] [data-row-menu]') as any;
    const menu = document.getElementById('row-menu')!;
    button.focus();
    // Enter on a button is its click.
    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.map((item) => textOf(item.querySelector('span')))).toEqual([
      'Copy as prompt', 'Copy accept command', 'Copy accept command for every row like this',
    ]);
    expect(textOf(document.getElementById('row-menu-foot'))).toContain('Copies a command; run it in the project.');
    expect(document.activeElement).toBe(items[0]);
    menu.dispatchEvent(key('ArrowDown'));
    expect(document.activeElement).toBe(items[1]);
    menu.dispatchEvent(key('ArrowUp'));
    menu.dispatchEvent(key('ArrowUp'));
    expect(document.activeElement).toBe(items[2]);
    menu.dispatchEvent(key('Escape'));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    button.click();
    menu.dispatchEvent(key('ArrowDown'));
    menu.dispatchEvent(key('Enter'));
    await new Promise((done) => setTimeout(done, 0));
    expect(menu.hidden).toBe(true);
    const command = "flowatlas accept route-unguarded --service orders --path 'GET /orders/:param/items' --note '<why this one is fine>'";
    expect(window.clipboard.at(-1)).toBe(command);
    const toast = document.getElementById('toast')!;
    expect(toast.hidden).toBe(false);
    expect(textOf(toast.querySelector('code'))).toBe(command);

    button.click();
    menu.dispatchEvent(key('ArrowUp'));
    menu.dispatchEvent(key('Enter'));
    await new Promise((done) => setTimeout(done, 0));
    expect(window.clipboard.at(-1)).toBe(
      "flowatlas accept route-unguarded --service orders --path 'GET /orders/:param/*' --note '<why these are fine>' --dry-run");
  });

  it('copies the row as a prompt from its menu, and warns where a row has no single place', async () => {
    const { document, window, page } = mount();
    const menu = document.getElementById('row-menu')!;
    const button = document.querySelector('.nj-row[data-reason="di-token-unknown"] [data-row-menu]') as any;
    button.click();
    (menu.querySelector('[role="menuitem"]') as any).click();
    await new Promise((done) => setTimeout(done, 0));
    const r = Number(button.dataset.rowMenu);
    expect(window.clipboard.at(-1)).toBe(page.promptOf(`row:${r}`));
    expect(textOf(document.getElementById('toast'))).toBe('Copied as a prompt.');

    (document.querySelector('.nj-row[data-reason="service-read-nothing"] [data-row-menu]') as any).click();
    expect(menu.querySelectorAll('[role="menuitem"]').map((item) => textOf(item.querySelector('span'))))
      .toEqual(['Copy as prompt', 'Copy accept command']);
    expect(textOf(document.getElementById('row-menu-foot'))).toContain('No single place: it accepts service-read-nothing across gateway.');
    // A click away closes it, and leaves the keyboard where it went.
    document.body.dispatchEvent(new FakeEvent('pointerdown'));
    expect(menu.hidden).toBe(true);
  });

  it('lists what was accepted as a section of its own, with the rule and the note', () => {
    const { document } = mount();
    const section = document.getElementById('nj-accepted')!;
    expect(textOf(section.querySelector('.accepted-rules'))).toContain('accepted by rule');
    expect(section.querySelectorAll('tbody tr.is-accepted')).toHaveLength(2);
    expect(textOf(section)).toContain('the admin routes sit behind the gateway');
    expect((section.querySelector('details.nj-accepted') as any).open).toBe(true);
  });

  it('says what would appear in a section with nothing in it', () => {
    const empty = testPack('missing-empty');
    const { page, document } = mountPage(empty);
    page.showView('missing');
    expect(textOf(document.querySelector('#nj-risks .nj-empty'))).toMatch(/^Nothing here\. A route with nothing in front of it/);
    expect(textOf(document.querySelector('#nj-accepted .nj-empty'))).toMatch(/^Nothing here\. A row accepted with flowatlas accept/);
    expect(document.querySelectorAll('#nj-gaps .nj-row').length).toBeGreaterThan(0);
  });

  it('names a group for every risk, in core’s order', () => {
    expect(Object.keys(PAGE_WORDS.risk)).toEqual([...RISK_NAMES]);
  });
});
