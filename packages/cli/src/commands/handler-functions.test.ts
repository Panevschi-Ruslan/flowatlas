import { join, resolve } from 'node:path';
import { AdapterRegistry, parseConfig, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'bot-registry');

const id = (file: string, symbol: string): string => `bot-registry#src/${file}:${symbol}`;

const read = async (registries: unknown[]): Promise<RepoGraph> => {
  const config = parseConfig({
    services: [{ name: 'bot-registry', repo: '.', type: 'nestjs' }],
    adapters: { entry: { registries } },
  });
  return extractRepo({
    rootDir: FIXTURE,
    repo: 'bot-registry',
    service: config.services[0],
    config,
    registry: registerEntryAdapters(new AdapterRegistry()),
    noTypes: true,
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
};

/**
 * A bot whose buttons are functions in a table it keeps itself.
 *
 * Asserted against the graph rather than against a snapshot, because the whole
 * of R12 was that a missing layer looked exactly like a complete one: a snapshot
 * of the wrong answer would have passed just as happily.
 */
describe('handlers that are functions rather than methods', () => {
  let graph: RepoGraph;

  beforeAll(async () => {
    graph = await read([{ name: 'callbacks', receiver: 'callbackRegistry', method: 'register' }]);
  }, 60_000);

  const edge = (from: string, type: string, to: string): boolean =>
    graph.edges.some((row) => row.from === from && row.type === type && row.to === to);

  it('opens a way in for every registration in the table', () => {
    const entries = graph.nodes.filter((node) => node.type === 'entry').map((node) => node.id);
    expect(entries).toContain('entry:bot-registry:bot_callback:confirm_cancel');
    expect(entries).toContain('entry:bot-registry:bot_callback:view_order');
    expect(entries).toContain('entry:bot-registry:bot_callback:keep_order');
  });

  it('carries a pressed button through to the method it calls', () => {
    const handler = id('actions/cancel-order.action.ts', 'confirmCancelHandler');
    expect(edge('entry:bot-registry:bot_callback:confirm_cancel', 'handles', handler)).toBe(true);
    expect(edge(handler, 'calls', id('orders.service.ts', 'OrdersService.cancel'))).toBe(true);
  });

  it('follows a handler through a function it calls by name', () => {
    const handler = id('actions/cancel-order.action.ts', 'viewOrderHandler');
    const helper = id('actions/summary.ts', 'summarise');
    expect(edge(handler, 'calls', helper)).toBe(true);
    expect(edge(helper, 'calls', id('orders.service.ts', 'OrdersService.find'))).toBe(true);
  });

  it('finds registrations on the library written outside any class', () => {
    const menu = id('commands/menu.command.ts', 'showMenu');
    const written = id('commands/menu.command.ts', 'action back_to_main@14');
    expect(edge('entry:bot-registry:bot_command:menu', 'handles', menu)).toBe(true);
    // The function written in the registration, not the one it is written in:
    // that runs once at start-up, and this runs every time the button is pressed.
    expect(edge('entry:bot-registry:bot_callback:back_to_main', 'handles', written)).toBe(true);
    expect(edge(written, 'calls', id('orders.service.ts', 'OrdersService.find'))).toBe(true);
  });

  it('carries the button whose handler has no name into the function written in place', () => {
    const keep = 'entry:bot-registry:bot_callback:keep_order';
    const written = id('actions/cancel-order.action.ts', 'callbacks:keep_order@19');
    expect(edge(keep, 'handles', written)).toBe(true);
    expect(graph.unresolved.map((row) => row.reason)).not.toContain('registry-handler-anonymous');
  });

  it('makes a node of no function an entry point does not reach', () => {
    const functions = graph.nodes.filter((node) => node.type === 'function').map((node) => node.id);
    expect(functions).toContain(id('actions/summary.ts', 'summarise'));
    expect(functions).not.toContain(id('handlers/text-registry.ts', 'helpText'));
    expect(functions).not.toContain(id('main.ts', 'bootstrap'));
  });
});

describe('a table of handlers nobody configured', () => {
  it('is named once, with how much of it there is, and costs no entry point', async () => {
    const graph = await read([]);
    const rows = graph.unresolved.filter((row) => row.reason === 'entry-registry-unconfigured');
    expect(rows.map((row) => row.symbol).sort()).toEqual([
      'callbackRegistry.register',
      'textRegistry.on',
    ]);
    expect(graph.nodes.filter((node) => node.kind === 'bot_callback')).toHaveLength(1);
  }, 60_000);
});
