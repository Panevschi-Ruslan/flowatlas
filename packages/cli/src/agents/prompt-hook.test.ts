import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { promptHookCommand, withoutPromptHook, withPromptHook, withSearchHook } from '../commands/agents.js';
import { cardNamesOf, readCardNamesAt, routeKey, type CardIndex } from './card-names.js';
import { ageSaid, CARDS_SEEN_FILE, MAX_CARD_CHARS, planCards, promptCard, promptHookOutput, runPromptHook } from './prompt-hook.js';

/**
 * Prompt cards (P386): the matching against a hand-made index, and the whole
 * hook against the built `prompt-cards` fixture, copied so the session file it
 * writes stays out of the fixture.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const BUILT = join(ROOT, 'fixtures', 'prompt-cards', '.flowatlas');
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-cards-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const INDEX: CardIndex = {
  cardNamesFormatVersion: 1,
  builtAt: '2026-01-01T00:00:00.000Z',
  services: [
    { name: 'shop-api', folder: 'api' },
    { name: 'stock-api', folder: 'stock' },
  ],
  names: [
    { text: '/api/orders/:param', kind: 'route', id: 'route-get', service: 'shop-api', verb: 'GET' },
    { text: '/api/orders/:param', kind: 'route', id: 'route-delete', service: 'shop-api', verb: 'DELETE' },
    { text: 'OrdersController.findOne', kind: 'handler', id: 'shop-handler', service: 'shop-api' },
    { text: 'OrdersController.findOne', kind: 'handler', id: 'stock-handler', service: 'stock-api' },
    { text: 'OrdersApi.cancel', kind: 'client', id: 'client', service: 'web' },
    { text: 'fetchOrders', kind: 'method', id: 'plain-function', service: 'web' },
    { text: 'audit', kind: 'channel', id: 'channel:audit', service: null },
    { text: 'shop:*:orders', kind: 'channel', id: 'channel:shop', service: null },
    { text: 'ORDER_PAID', kind: 'type', id: 'type-paid', service: null },
    { text: 'PAID', kind: 'type', id: 'type-short', service: null },
  ],
};

const keysOf = (prompt: string, seen?: Set<string>): string[] => planCards(prompt, INDEX, seen).cards.map((card) => card.key);

describe('which names a prompt card answers for (P386)', () => {
  it('reads a route said aloud whatever its parameters are called, and a bare path as every verb of it', () => {
    expect(keysOf('who calls GET /api/orders/{orderId}?')).toEqual(['route-get']);
    expect(keysOf('who calls `DELETE /api/orders/:id`')).toEqual(['route-delete']);
    expect(keysOf('is /api/orders/${id} used?')).toEqual(['route-get', 'route-delete']);
    expect(keysOf('POST /api/orders/:id')).toEqual([]);
    expect(keysOf('look at /api/orders')).toEqual([]);
    expect(routeKey('/api/orders/[id]/<line>/')).toBe('/api/orders/:param/:param');
  });

  it('takes Class.method and spelled names in prose, plain words only in backticks', () => {
    expect(keysOf('what does OrdersApi.cancel() send, and who takes ORDER_PAID or shop:*:orders?')).toEqual(['client', 'type-paid', 'channel:shop']);
    expect(keysOf('who reads the audit channel when PAID or fetchOrders runs')).toEqual([]);
    expect(keysOf('who reads `audit`, `PAID` and `fetchOrders()`')).toEqual(['channel:audit', 'type-short', 'plain-function']);
    expect(keysOf('OrdersApi.cancelled and XOrdersApi.cancel')).toEqual([]);
  });

  it('lets a service named in the prompt, by name or folder, pick among names several services hold', () => {
    expect(keysOf('change OrdersController.findOne')).toEqual(['shop-handler', 'stock-handler']);
    expect(keysOf('change OrdersController.findOne in stock-api')).toEqual(['stock-handler']);
    expect(keysOf('change OrdersController.findOne in the stock folder')).toEqual(['stock-handler']);
  });

  it('asks what nothing uses in a service only when nothing in it is named', () => {
    expect(planCards('what in shop-api is unused?', INDEX).cards).toEqual([{ key: 'dead:shop-api', calls: [{ tool: 'dead', args: { service: 'shop-api' } }] }]);
    expect(keysOf('is OrdersApi.cancel in shop-api dead?')).toEqual(['client']);
    expect(keysOf('tell me about shop-api')).toEqual([]);
    // A folder that is a plain word is prose unless backticked.
    expect(keysOf('is the stock app still used?')).toEqual([]);
    expect(keysOf('is `stock` still used?')).toEqual(['dead:stock-api']);
  });

  it('answers at most three names, each once per session, and holds the rest back', () => {
    const plan = planCards('GET /api/orders/:id, OrdersApi.cancel, ORDER_PAID and shop:*:orders', INDEX);
    expect(plan.cards.map((card) => card.key)).toEqual(['route-get', 'client', 'type-paid']);
    expect(plan.more.map((card) => card.key)).toEqual(['channel:shop']);
    expect(keysOf('GET /api/orders/:id and ORDER_PAID', new Set(['route-get']))).toEqual(['type-paid']);
  });

  it('picks the tool by what the name is', () => {
    const tools = (prompt: string): string[] => planCards(prompt, INDEX).cards.flatMap((card) => card.calls.map((call) => call.tool));
    expect(tools('GET /api/orders/:id')).toEqual(['who_calls']);
    expect(tools('OrdersController.findOne in shop-api')).toEqual(['impact']);
    expect(tools('OrdersApi.cancel')).toEqual(['find_symbol']);
    expect(tools('ORDER_PAID')).toEqual(['who_emits', 'who_consumes']);
  });

  it('says the graph’s age as a person does', () => {
    const built = Date.parse(INDEX.builtAt);
    expect(ageSaid(INDEX.builtAt, built + 30_000)).toBe('just now');
    expect(ageSaid(INDEX.builtAt, built + 60_000)).toBe('1 minute ago');
    expect(ageSaid(INDEX.builtAt, built + 3 * 3_600_000)).toBe('3 hours ago');
    expect(ageSaid(INDEX.builtAt, built + 5 * 86_400_000)).toBe('5 days ago');
  });
});

describe('the name index build writes (P386)', () => {
  it('marks a route’s handler, a method requesting another repository’s route, message types and channels', () => {
    const node = (id: string, type: GraphNode['type'], label: string, repo: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id, type, label, repo, ...extra }) as GraphNode;
    const nodes = [
      node('entry:api:http:GET:/orders/:param', 'entry', 'GET /orders/:param', 'api', { kind: 'http', meta: { method: 'GET', path: '/orders/:param' } }),
      node('api#a.ts:OrdersController.one', 'method', 'OrdersController.one', 'api'),
      node('ui_api_call:web#b.ts:3', 'ui_api_call', 'GET /orders/:param', 'web'),
      node('web#b.ts:OrdersApi.one', 'method', 'OrdersApi.one', 'web'),
      node('web#b.ts:OrdersPage.show', 'method', 'OrdersPage.show', 'web'),
      node('channel:shop', 'channel', 'shop', ''),
      node('channel:shop#PAID', 'channel', 'shop#PAID', '', { kind: 'message_type', meta: { messageType: 'PAID', channel: 'channel:shop' } }),
    ];
    const edges: GraphEdge[] = [
      { from: 'entry:api:http:GET:/orders/:param', to: 'api#a.ts:OrdersController.one', type: 'handles' },
      { from: 'ui_api_call:web#b.ts:3', to: 'entry:api:http:GET:/orders/:param', type: 'hits' },
      { from: 'web#b.ts:OrdersApi.one', to: 'ui_api_call:web#b.ts:3', type: 'calls' },
      { from: 'web#b.ts:OrdersPage.show', to: 'web#b.ts:OrdersApi.one', type: 'calls' },
    ] as GraphEdge[];
    const index = cardNamesOf({ nodes, edges, builtAt: INDEX.builtAt }, { api: '/p/api', web: '/p/front' });
    expect(index.services).toEqual([
      { name: 'api', folder: 'api' },
      { name: 'web', folder: 'front' },
    ]);
    expect(index.names.map((name) => [name.kind, name.text])).toEqual([
      ['route', '/orders/:param'],
      ['client', 'OrdersApi.one'],
      ['handler', 'OrdersController.one'],
      ['method', 'OrdersPage.show'],
      ['type', 'PAID'],
      ['channel', 'shop'],
    ]);
  });
});

/** The built fixture's graph and index, copied into a directory of their own. */
const copyOfFixture = (name: string): string => {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  for (const file of ['graph.db', 'card-names.json', 'freshness.json']) if (existsSync(join(BUILT, file))) cpSync(join(BUILT, file), join(dir, file));
  return join(dir, 'card-names.json');
};

describe('the card a prompt gets, from the built fixture (P386)', () => {
  it('holds the tool’s own compact answer under the graph’s age, within the size', async () => {
    const cards = copyOfFixture('answer');
    const index = readCardNamesAt(cards)!;
    const card = await promptCard('Who calls GET /api/orders/{orderId}?', cards, { now: Date.parse(index.builtAt) + 120_000 });
    expect(card.text).toMatch(/^flowatlas, from the graph of every repository \(built 2 minutes ago\)/);
    expect(card.text).toContain('who_calls({symbol: "entry:shop-api:http:GET:/api/orders/:param"}):\n{"target":');
    expect(card.text).toContain('"entry:shop-web:screen:/orders"');
    expect(card.keys).toEqual(['entry:shop-api:http:GET:/api/orders/:param']);
    expect(card.text!.length).toBeLessThanOrEqual(MAX_CARD_CHARS);
  });

  it('keeps a method’s card only where its answer reaches another repository', async () => {
    const cards = copyOfFixture('crossing');
    expect((await promptCard('what reaches Mails.cancelled?', cards)).keys).toEqual(['mailer#src/mail/mails.service.ts:Mails.cancelled']);
    expect((await promptCard('tidy up OrdersPageComponent.cancel', cards)).text).toBeUndefined();
  });

  it('fits many names in the size, naming by its call an answer that does not fit and the names past three', async () => {
    const cards = copyOfFixture('many');
    const card = await promptCard('compare GET /api/orders/:id, POST /api/orders/:id/cancel, OrdersApiService.getOrder and ORDER_CANCELLED', cards);
    expect(card.text!.length).toBeLessThanOrEqual(MAX_CARD_CHARS);
    expect(card.text).toContain('Also named here, not answered: who_emits({channel: "channel:shop:*:orders#ORDER_CANCELLED"})');
  });

  it('runs as a hook: a card once per session, the prompt never written, silence for the rest', async () => {
    const cards = copyOfFixture('hook');
    const outputs: string[] = [];
    const run = (prompt: unknown, session = 's1', argv = ['--cards', cards]): Promise<void> =>
      runPromptHook(argv, {
        stdin: async () => JSON.stringify({ session_id: session, prompt, cwd: scratch }),
        write: async (text) => void outputs.push(text),
        env: {},
      });
    const prompt = 'which code handles ORDER_CANCELLED? secret-words-here';
    await run(prompt);
    expect(outputs).toHaveLength(1);
    const said = JSON.parse(outputs[0]!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(said.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(said.hookSpecificOutput.additionalContext).toContain('who_consumes({channel: "channel:shop:*:orders#ORDER_CANCELLED"})');
    await run(prompt);
    expect(outputs).toHaveLength(1);
    await run(prompt, 's2');
    expect(outputs).toHaveLength(2);
    const seen = readFileSync(join(scratch, 'hook', CARDS_SEEN_FILE), 'utf8');
    expect(seen).toContain('channel:shop:*:orders#ORDER_CANCELLED');
    expect(seen).not.toContain('secret-words-here');
    // Nothing named, no index, a broken call: silence.
    await run('write a haiku about orders', 's3');
    await run(prompt, 's4', ['--cards', join(scratch, 'nowhere', 'card-names.json')]);
    await run(42, 's5');
    await runPromptHook(['--cards', cards], { stdin: async () => 'not json', write: async (text) => void outputs.push(text), env: {} });
    expect(outputs).toHaveLength(2);
  });

  it('writes what Claude Code reads from a UserPromptSubmit hook', () => {
    expect(JSON.parse(promptHookOutput('x'))).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'x' } });
  });
});

describe('installing the prompt hook (P386)', () => {
  it('goes beside every other prompt hook with no matcher, and comes out alone', () => {
    const theirs = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } };
    const command = promptHookCommand('/p/web', '/p/.flowatlas/card-names.json', false);
    expect(command).toMatch(/prompt-hook\.js" --cards "\/p\/\.flowatlas\/card-names\.json"$/);
    expect(promptHookCommand('/p/web', '/p/.flowatlas/card-names.json', true)).toBe('flowatlas agents prompt-hook --cards "../.flowatlas/card-names.json"');
    const both = withPromptHook(withSearchHook(theirs, 'node search-hook.js --names x'), command);
    expect(both.hooks?.UserPromptSubmit).toEqual([...theirs.hooks.UserPromptSubmit, { hooks: [{ type: 'command', command, timeout: 10 }] }]);
    expect(withPromptHook(both, command).hooks?.UserPromptSubmit).toHaveLength(2);
    expect(withoutPromptHook(withPromptHook(theirs, command))).toEqual(theirs);
    expect(withoutPromptHook(withPromptHook({ model: 'x' }, command))).toEqual({ model: 'x' });
  });

  it('is written by --hook and left out, or taken out, by --no-prompt-cards', async () => {
    const { installAgents, agentsStatus, removeAgents } = await import('../commands/agents.js');
    const root = join(scratch, 'project');
    mkdirSync(join(root, 'web'), { recursive: true });
    writeFileSync(join(root, 'flowatlas.config.json'), JSON.stringify({ services: [{ name: 'web', repo: './web', type: 'angular' }] }));
    const config = join(root, 'flowatlas.config.json');
    const settings = join(root, 'web', '.claude', 'settings.local.json');
    installAgents({ config, hook: true });
    const written = JSON.parse(readFileSync(settings, 'utf8'));
    expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toMatch(/prompt-hook\.js" --cards ".*card-names\.json"$/);
    // The search hook and the edit hook (P387) after a tool call, the prompt hook before a turn.
    expect(written.hooks.PostToolUse).toHaveLength(2);
    installAgents({ config, hook: true, promptCards: false });
    expect(JSON.parse(readFileSync(settings, 'utf8')).hooks.UserPromptSubmit).toBeUndefined();
    installAgents({ config, hook: true });
    expect(agentsStatus({ config }).changes.some((change) => change.file === settings && change.state === 'installed')).toBe(true);
    removeAgents({ config });
    expect(existsSync(settings)).toBe(false);
  });
});
