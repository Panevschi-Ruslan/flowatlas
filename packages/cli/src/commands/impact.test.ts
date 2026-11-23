import { join, resolve } from 'node:path';
import { compactAnswer, DbHandle, impactOf } from '@flowatlas/mcp';
import { describe, expect, it } from 'vitest';
import { runImpact } from './impact.js';

/**
 * `flowatlas impact` answers as the graph server's tool does (P370): the same
 * walk, its rows with the crossing they came through, the maybe rows apart,
 * and `--format json` the tool's answer, compact unless `--verbose`.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'angular-rendered-reach', 'flowatlas.config.json');
const TARGET = 'catalog-api#src/items.service.ts:ItemsService.findOne';

const run = (options: Record<string, unknown>): string => {
  let text = '';
  runImpact(TARGET, { config: CONFIG, color: false, ascii: true, ...options }, { out: (chunk) => void (text += chunk), err: () => {} });
  return text;
};

const toolAnswer = (): object => {
  const handle = new DbHandle({ configPath: CONFIG });
  const opened = handle.open();
  if ('error' in opened) throw new Error(opened.error);
  try {
    return JSON.parse(JSON.stringify(impactOf(opened.db, handle, { symbol: TARGET, detail: 1, maxNodes: 150 }).answer)) as object;
  } finally {
    handle.close();
  }
};

describe('flowatlas impact (P370)', () => {
  it('draws the chain to each way in, the screen a rendered child reaches included, and lists the rows under it', () => {
    const text = run({ format: 'tree' });
    expect(text).toContain('CatalogPageComponent');
    expect(text).toContain('Could break:');
    expect(text).toContain('/catalog (catalog-web)  outside, via GET /items/:param (catalog-api)');
    expect(text).toContain('Maybe, behind a call the reading could not follow:');
    expect(text).toContain('ItemsLookupService.byKey (catalog-web)  maybe');
    expect(text).toContain('Unreached: 1 chain ends at code');
    expect(text).not.toContain('oneLegacy');
  });

  it('prints the tool’s answer as JSON, compact on one line, and whole with --verbose', () => {
    const compact = run({ format: 'json' });
    expect(compact.trimEnd().includes('\n')).toBe(false);
    expect(JSON.parse(compact)).toEqual(compactAnswer(toolAnswer()));
    expect(JSON.parse(run({ format: 'json', verbose: true }))).toEqual(toolAnswer());
  });

  it('counts what lies only beyond a channel under the rows, and draws the chains to it with --channel (P372)', () => {
    let text = '';
    const guarded = { config: join(ROOT, 'fixtures', 'impact-guarded-navigation', 'flowatlas.config.json'), color: false, ascii: true, format: 'tree' as const };
    const out = { out: (chunk: string) => void (text += chunk), err: () => {} };
    runImpact('store-api#src/items.service.ts:ItemsService.listByShop', guarded, out);
    expect(text).toContain('Only beyond a channel, calling none of it');
    expect(text).toContain('shop:*:orders  4 ways in, taken by StoreBot.onStatusEvent (store-bot): DELETE /api/orders/:param (store-api)');
    expect(text).not.toContain('LoginComponent');
    expect(text).not.toContain('/analytics');
    text = '';
    runImpact('store-api#src/items.service.ts:ItemsService.listByShop', { ...guarded, channel: 'shop:*:orders' }, out);
    expect(text).toContain('OrdersAdminComponent');
    expect(text).toContain('/orders (store-web)  outside, via channel shop:*:orders');
  });

  it('says the code that handles each way in, with where it is written (P374)', () => {
    let text = '';
    const options = { config: join(ROOT, 'fixtures', 'rows-name-handling-code', 'flowatlas.config.json'), color: false, ascii: true, format: 'tree' as const };
    runImpact('shop-api#src/orders/orders.service.ts:OrdersService.cancel', options, { out: (chunk: string) => void (text += chunk), err: () => {} });
    expect(text).toContain('POST /bot/staff/webhook (shop-api)  outside, by StaffBot.handleCallbackQuery src/bot/staff-bot.service.ts:');
    expect(text).toContain('/orders/:param (shop-web)  outside, via PATCH /api/orders/:param/cancel (shop-api), by OrderDetailComponent src/app/order-detail.component.ts:');
  });

  it('hangs the rows under the target with --entries-only, and draws the chains to --depth', () => {
    const only = run({ format: 'tree', entriesOnly: true });
    expect(only).not.toContain('ItemCardComponent.load');
    expect(only).toContain('/catalog');
    const shallow = run({ format: 'tree', depth: '2' });
    // The tree stops at the depth; the rows under it still name the component that handles the screen (P374).
    expect(shallow.split('Reachable from')[0]).not.toContain('CatalogPageComponent');
    expect(shallow).toContain('raise --depth');
  });
});
