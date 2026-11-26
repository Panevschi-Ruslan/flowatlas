import { describe, expect, it } from 'vitest';
import { deadMethods, deadProviders, deadVerdict } from './dead.js';
import { botButtonMismatches } from './mismatches.js';
import { buildTestDb, edge, node } from './__fixtures__/test-db.js';

const provider = (id: string, over = {}) => node(id, { type: 'provider', kind: 'injectable', file: 'src/bot.ts', line: 1, ...over });
type Out = ReturnType<typeof botButtonMismatches>;
const findingsOf = (out: Out) => out.flatMap((each) => ('finding' in each ? [each.finding] : []));
const heldOf = (out: Out) => out.flatMap((each) => ('held' in each ? [each.held] : []));
const hook = (id: string, hookName = 'onModuleInit', when = 'startup') => node(id, { meta: { frameworkCalls: { hook: hookName, when } } });

describe('a hook the framework calls (P399)', () => {
  it('is alive, and so is what only it calls and the class it is on', () => {
    const db = buildTestDb({
      nodes: [provider('bot#src/bot.ts:Bot'), hook('bot#src/bot.ts:Bot.onModuleInit'), node('bot#src/bot.ts:Bot.setup'), node('bot#src/bot.ts:Bot.unused')],
      edges: [edge('bot#src/bot.ts:Bot.onModuleInit', 'bot#src/bot.ts:Bot.setup')],
    });
    const verdict = deadVerdict(db, db.report(), 'bot#src/bot.ts:Bot.onModuleInit');
    const methods = deadMethods(db).map((row) => row.id);
    const providers = deadProviders(db);
    db.close();
    expect(verdict).toMatchObject({ verdict: 'alive', reason: 'the framework calls it at startup', evidence: { framework: 'startup (onModuleInit)' } });
    // The hook and what it calls are not listed; a method nothing calls on the class still is.
    expect(methods).toEqual(['bot#src/bot.ts:Bot.unused']);
    expect(providers).toEqual([]);
  });

  it('leaves a method with no such mark as it was', () => {
    const db = buildTestDb({ nodes: [provider('bot#src/bot.ts:Bot'), node('bot#src/bot.ts:Bot.onModuleInit')], edges: [] });
    const verdict = deadVerdict(db, db.report(), 'bot#src/bot.ts:Bot.onModuleInit');
    db.close();
    expect(verdict?.verdict).not.toBe('alive');
  });
});

describe('buttons held against a listener split by a table (P399)', () => {
  const entry = (id: string, meta: Record<string, unknown>) => node(id, { type: 'entry', kind: id.split(':')[2], file: 'src/bot.ts', line: 3, meta });
  const holder = node('bot#src/bot.ts:Bot.buttons', {
    meta: {
      callbackButtons: [
        { data: 'view_order_${…}', at: 'src/bot.ts:40' },
        { data: 'archive_${…}', at: 'src/bot.ts:41' },
      ],
    },
  });
  const prefixes = entry('entry:bot:bot_callback:view_order_*', { key: 'view_order_*', callbackData: { regex: '^view_order_', flags: '' } });

  it('names the button no element takes when the listener does nothing with the data itself', () => {
    const db = buildTestDb({
      nodes: [holder, prefixes, entry('entry:bot:bot_event:callback_query', { key: 'callback_query', splitByTable: 'src/bot.ts:5' })],
      edges: [],
    });
    const out = botButtonMismatches(db, []);
    db.close();
    expect(findingsOf(out).map((finding) => finding.kind)).toEqual(['bot-button-unhandled']);
    expect(findingsOf(out)[0]?.message).toContain('archive_');
    expect(heldOf(out)).toEqual([]);
  });

  it('holds it back where what the listener does besides choosing reads the data', () => {
    const db = buildTestDb({
      nodes: [holder, prefixes, entry('entry:bot:bot_event:callback_query', { key: 'callback_query', splitByTable: 'src/bot.ts:5', restReadsData: true })],
      edges: [],
    });
    const out = botButtonMismatches(db, []);
    db.close();
    expect(findingsOf(out)).toEqual([]);
    expect(heldOf(out).map((held) => held.kind)).toEqual(['bot-button-unhandled']);
  });
});
