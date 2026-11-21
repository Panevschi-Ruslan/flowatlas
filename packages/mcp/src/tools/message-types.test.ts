import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * Asking about one type of message on a channel (P358), against the fixture
 * that publishes several on one channel and chooses among them every way the
 * reader knows: `who_consumes` and `who_emits` with `type`, `search` finding a
 * type by its value, and "no code selects this type" said with how sure it is.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'space-message-types', 'flowatlas.config.json');
const CHANNEL = 'channel:space:*:events';

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

const labels = (rows: Array<{ label: string }>): string[] => rows.map((row) => row.label).sort();

describe('who handles one type of message', () => {
  it('lists the handlers that select it, each with where and how the choice was made', async () => {
    const answer = await call('who_consumes', { channel: 'space:*:events', type: 'MEMBER_JOINED' });
    expect(answer.type).toBe('MEMBER_JOINED');
    expect(labels(answer.consumers)).toEqual(['AuditTrail.recordJoin', 'Notices.digest', 'WelcomeHandlers.greet']);
    const greet = answer.consumers.find((row: { label: string }) => row.label === 'WelcomeHandlers.greet');
    expect(greet).toMatchObject({ selectedIn: 'RegistryDispatcher.route', via: 'decorator' });
    expect(answer.unselected).toBeUndefined();
  });

  it('reads a guard and an if chain as choices too', async () => {
    expect(labels((await call('who_consumes', { channel: CHANNEL, type: 'EXPORT_FINISHED' })).consumers)).toEqual(['ExportWatcher.notifyOwner', 'Notices.digest']);
    expect(labels((await call('who_consumes', { channel: CHANNEL, type: 'COMMENT_ADDED' })).consumers)).toEqual(['ActivityFeed.pushComment', 'SpaceEventsDispatcher.onComment']);
  });

  it('answers "no code selects it" for a type selected only in a class nothing builds, unsure past a consumer that forwards every type', async () => {
    const answer = await call('who_consumes', { channel: CHANNEL, type: 'QUOTA_WARNING' });
    expect(answer.consumers).toHaveLength(1);
    expect(answer.consumers[0]).toMatchObject({ label: 'LegacyDigest.mailQuota', unreached: expect.stringContaining('nothing builds LegacyDigest') });
    expect(answer.unselected).toContain('no code that runs selects QUOTA_WARNING');
    expect(answer.unselected).toContain('StreamRelay.forward passes every type on without choosing');
    expect(answer.sureness).toBe('unsure');
  });

  it('takes the channel as code writes it, saying which it answered for (P360)', async () => {
    const answer = await call('who_consumes', { channel: 'space:<id>:events', type: 'MEMBER_JOINED' });
    expect(answer.channelUsed).toBe(CHANNEL);
    expect(labels(answer.consumers)).toEqual(['AuditTrail.recordJoin', 'Notices.digest', 'WelcomeHandlers.greet']);
    // A type node written the same way is the type asked about.
    const typed = await call('who_consumes', { channel: 'space:{spaceId}:events#MEMBER_JOINED' });
    expect(typed).toMatchObject({ channelUsed: `${CHANNEL}#MEMBER_JOINED`, type: 'MEMBER_JOINED' });
  });

  it('takes the type node by its own id', async () => {
    const answer = await call('who_consumes', { channel: `${CHANNEL}#DOC_PUBLISHED` });
    expect(answer.type).toBe('DOC_PUBLISHED');
    expect(labels(answer.consumers)).toEqual(['AuditTrail.recordPublish', 'Notices.docPublished']);
  });

  it('says a type nothing publishes or selects is not read, with the types that are', async () => {
    const answer = await call('who_consumes', { channel: CHANNEL, type: 'DOC_DELETED' });
    expect(answer.consumers).toEqual([]);
    expect(answer.unselected).toContain('no code selects DOC_DELETED');
    expect(answer.types).toContain('DOC_PUBLISHED');
    expect(answer.maybe).toHaveLength(1);
  });

  it('lists the channel\'s types without one', async () => {
    const answer = await call('who_consumes', { channel: CHANNEL });
    expect(answer.types).toEqual(['COMMENT_ADDED', 'DOC_ARCHIVED', 'DOC_PUBLISHED', 'EXPORT_FINISHED', 'MEMBER_JOINED', 'QUOTA_WARNING']);
    expect(answer.next[0]).toBe(`who_consumes({channel: "${CHANNEL}", type: "COMMENT_ADDED"})`);
  });
});

describe('who publishes one type of message', () => {
  it('lists the publishes of it', async () => {
    const answer = await call('who_emits', { channel: CHANNEL, type: 'EXPORT_FINISHED' });
    expect(answer.producers.map((row: { loc: string }) => row.loc)).toEqual(['src/spaces/spaces.service.ts:32']);
  });

  it('names the publishes whose type was not read where nothing read publishes it', async () => {
    const answer = await call('who_emits', { channel: CHANNEL, type: 'DOC_ARCHIVED' });
    expect(answer.producers).toEqual([]);
    expect(answer.note).toContain('nothing read publishes DOC_ARCHIVED');
    expect(answer.maybe.map((row: { loc: string }) => row.loc)).toEqual(['src/spaces/spaces.service.ts:46']);
  });
});

describe('searching for a type by its value', () => {
  it('finds it under messages, with its publishes and the handlers that select it', async () => {
    const answer = await call('search', { query: 'DOC_PUBLISHED', kinds: ['messages'] });
    const [hit] = answer.results.messages;
    expect(hit).toMatchObject({ id: `${CHANNEL}#DOC_PUBLISHED`, type: 'message_type', label: 'DOC_PUBLISHED', channel: 'space:*:events' });
    expect(hit.producers).toEqual(['producer:docs-api#src/spaces/spaces.service.ts:16:5']);
    expect(hit.handlers).toHaveLength(2);
    expect(answer.next[0]).toBe(`who_consumes({channel: "${CHANNEL}", type: "DOC_PUBLISHED"})`);
  });

  it('says so in the hit where nothing that runs selects it, and keeps types out of the channels', async () => {
    const answer = await call('search', { query: 'QUOTA' });
    expect(answer.results.messages[0].unselected).toContain('no code that runs selects QUOTA_WARNING');
    expect(answer.results.channels).toBeUndefined();
  });
});

describe('dead, per type', () => {
  it('judges a type, and a handler in a class nothing builds', async () => {
    expect(await call('dead', { id: `${CHANNEL}#QUOTA_WARNING` })).toMatchObject({ verdict: 'unknown', evidence: { missing: 'consumer' } });
    expect(await call('dead', { id: `${CHANNEL}#EXPORT_FINISHED` })).toMatchObject({ verdict: 'alive' });
    expect(await call('dead', { id: 'consumer:notify-worker#src/handlers/legacy-digest.service.ts:LegacyDigest.mailQuota' })).toMatchObject({ verdict: 'dead' });
    // A method that checks the type and is reached by nothing stays dead: it is no consumer of anything.
    expect(await call('dead', { id: 'notify-worker#src/handlers/mention.handler.ts:MentionHandler' })).toMatchObject({ verdict: 'dead' });
  });

  it('walks impact through the type only: a handler of one type is reached from the route that publishes it', async () => {
    const answer = await call('impact', { symbol: 'consumer:notify-worker#src/handlers/export-watcher.service.ts:ExportWatcher.notifyOwner' });
    expect(answer.entries.map((row: { id: string }) => row.id)).toEqual(['entry:docs-api:http:POST:/spaces/:param/exports/:param/done']);
  });
});
