import { PROMPT_LIMITS, PROMPT_WALK, renderPrompt } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { createModel, type GraphModel } from '../graph.js';
import { promptFor } from '../steps.js';
import { textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** The Graph tab's details panel (P103). */
describe('the details panel', () => {
  const data = testPack('details');
  const at = nodeAt(data);

  it('says what a way in is, what stands in front of it, and what goes in and out', () => {
    const { page, document } = mountPage(data);
    page.graph.go(at('entry:gateway:http:POST:/orders'));
    const panel = document.getElementById('g-details')!;
    expect(panel.hidden).toBe(false);
    expect(textOf(panel.querySelector('h3'))).toBe('POST /orders');
    const sections = panel.querySelectorAll('section h4').map(textOf);
    expect(sections).toContain('Out · 3');
    expect(sections.some((title) => title.startsWith('In · '))).toBe(true);
    expect(sections.some((title) => title.startsWith('Problems · '))).toBe(true);
    expect(panel.querySelector('[data-act="walk"]')).toBeNull();
    expect(panel.querySelector('[data-act="steps"]')).not.toBeNull();
    panel.querySelector('[data-act="open-steps"]')!.click();
    expect(page.store.get('view')).toBe('steps');
    expect(page.store.get('current')).toBe(at('entry:gateway:http:POST:/orders'));
    expect(panel.querySelector('[data-prompt]')!.getAttribute('data-prompt')).toBe(`entry:${at('entry:gateway:http:POST:/orders')}`);
  });

  it('gives each row that names the node one menu, and no inline buttons (P100)', () => {
    const { page, document } = mountPage(data);
    page.graph.go(at('http_out:gateway#src/clients/orders.client.ts:20:4'));
    const rows = document.querySelectorAll('#g-details .g-row');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelectorAll('[data-row-menu]')).toHaveLength(1);
      expect(row.querySelectorAll('[data-prompt], [data-accept-cmd]')).toHaveLength(0);
    }
  });

  it('copies any node as a prompt, and its file and service from its `⋯`, in the text the parity test checks (P134)', async () => {
    const { page, document, window } = mountPage(data);
    const method = at('gateway#src/orders/orders.service.ts:OrdersService.create');
    page.graph.go(method);
    const panel = document.getElementById('g-details')!;
    expect(panel.querySelector('.g-actions [data-prompt]')!.getAttribute('data-prompt')).toBe(`node:${method}`);
    const menu = document.getElementById('row-menu')!;
    const button = panel.querySelector('[data-prompt-menu]') as any;
    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = menu.querySelectorAll('[role="menuitem"]');
    // No class here: the test project's methods name no class node.
    expect(items.map((item) => textOf(item.querySelector('span')))).toEqual(['Copy its file as a prompt', 'Copy its service as a prompt']);
    expect(items.map((item) => textOf(item.querySelector('small')))).toEqual(['src/orders/orders.service.ts', 'gateway']);
    const kit = { walk: PROMPT_WALK, render: renderPrompt, limits: PROMPT_LIMITS };
    const model = createModel(data) as GraphModel;
    (items[0] as any).click();
    await new Promise((done) => setTimeout(done, 0));
    expect(window.clipboard.at(-1)).toBe(promptFor(model, { file: ['gateway', 'src/orders/orders.service.ts'] }, kit));
    expect(window.clipboard.at(-1)).toMatch(/^# File: src\/orders\/orders\.service\.ts\n/);
    expect(textOf(document.getElementById('toast'))).toBe('Copied as a prompt.');
    button.click();
    (menu.querySelectorAll('[role="menuitem"]')[1] as any).click();
    await new Promise((done) => setTimeout(done, 0));
    expect(window.clipboard.at(-1)).toBe(promptFor(model, { service: 'gateway' }, kit));
    expect(window.clipboard.at(-1)).toMatch(/^# Service: gateway\n/);
  });

  it('closes, and says nothing, when no node is open', () => {
    const { page, document } = mountPage(data);
    page.graph.go(at('channel:order.created'));
    page.closeDetails();
    expect(document.getElementById('g-details')!.hidden).toBe(true);
    expect(document.getElementById('g-stage')!.classList.contains('is-closed')).toBe(true);
  });
});
