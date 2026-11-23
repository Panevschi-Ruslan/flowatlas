import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { DbHandle } from '../query/db.js';
import { impactOf } from './reach.js';

/**
 * A routed screen that renders a child by its tag, the child's button
 * requesting a back end's route, and the clients' methods nothing calls:
 * one whose name the repository writes nowhere else, one the same but in a
 * file with a step the reading could not follow (P370).
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'angular-rendered-reach', 'flowatlas.config.json');
const TARGET = 'catalog-api#src/items.service.ts:ItemsService.findOne';
const SCREEN = 'entry:catalog-web:screen:/catalog';
const LEGACY = 'catalog-web#src/app/items-api.service.ts:ItemsApiService.oneLegacy';
const BY_KEY = 'catalog-web#src/app/items-lookup.service.ts:ItemsLookupService.byKey';
const BADGE = 'catalog-web#src/app/legacy-badge.component.ts:LegacyBadgeComponent';
const DIALOG = 'catalog-web#src/app/promo-dialog.component.ts:PromoDialogComponent';
const CARD = 'catalog-web#src/app/item-card.component.ts:ItemCardComponent';

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ configPath: CONFIG, allTools: true });
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('impact through a component a template renders, and code written nowhere else (P370)', () => {
  it('reaches the screen through the child it renders, keeps the maybe behind a gap, and counts the unreferenced end apart', async () => {
    const answer = await call('impact', { symbol: TARGET });
    const ids = answer.entries.map((row: { id: string }) => row.id);
    expect(ids).toContain(SCREEN);
    expect(answer.entries.find((row: { id: string }) => row.id === SCREEN)).toMatchObject({ via: 'GET /items/:param (catalog-api)' });
    expect(answer.entries.find((row: { id: string }) => row.id === BY_KEY)).toMatchObject({ reach: 'maybe', gap: 'gap:catalog-web|src/app/items-lookup.service.ts|navigation-unresolved' });
    expect(ids).not.toContain(LEGACY);
    expect(answer).toMatchObject({ maybe: 1, unreached: 1 });
  });

  it('is the answer the command line prints, from one function', async () => {
    const handle = new DbHandle({ configPath: CONFIG });
    const opened = handle.open();
    if ('error' in opened) throw new Error(opened.error);
    const of = impactOf(opened.db, handle, { symbol: TARGET, detail: 1, maxNodes: 150 });
    handle.close();
    expect(JSON.parse(JSON.stringify(of.answer))).toEqual(await call('impact', { symbol: TARGET }));
    // The walk it was read from draws the chain back to the screen.
    expect(of.walked?.parents.get(SCREEN)).toBeDefined();
    expect(of.listed?.map((way) => way.node.id)).toContain(SCREEN);
  });

  it('says unreached of code written nowhere else, and maybe of code a value or an unread call may reach', async () => {
    const answer = await call('find_symbol', { queries: ['oneLegacy', 'byKey', 'LegacyBadgeComponent', 'PromoDialogComponent', 'ItemCardComponent'] });
    const reach = new Map<string, string>();
    for (const asked of answer.answers) for (const row of asked.matches ?? asked.symbols ?? asked.results ?? []) reach.set(row.id, row.reach);
    expect(reach.get(LEGACY)).toBe('unreached');
    expect(reach.get(BY_KEY)).toBe('maybe');
    expect(reach.get(BADGE)).toBe('unreached');
    expect(reach.get(DIALOG)).toBe('maybe');
    expect(reach.get(CARD)).toBe('alive');
  });

  it("says dead's verdict with what it rests on", async () => {
    const answer = await call('dead', { ids: [BADGE, DIALOG, CARD] });
    const [badge, dialog, card] = answer.answers;
    expect(badge).toMatchObject({ verdict: 'likely-dead', evidence: { unreferenced: true } });
    expect(dialog).toMatchObject({ verdict: 'likely-dead' });
    expect(dialog.evidence?.unreferenced).toBeUndefined();
    expect(card).toMatchObject({ verdict: 'alive' });
  });
});
