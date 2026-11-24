import { describe, expect, it } from 'vitest';
import type { Promoted } from './boundary.js';
import { collectFindings } from './findings.js';
import { botButtonMismatches, configMismatches, corsMismatches, statusMismatches, streamEventMismatches } from './mismatches.js';
import { buildTestDb, edge, node } from './__fixtures__/test-db.js';

const findings = (promoted: readonly Promoted[]) => promoted.flatMap((each) => ('finding' in each ? [each.finding] : []));
const held = (promoted: readonly Promoted[]) => promoted.flatMap((each) => ('held' in each ? [each.held] : []));

const route = (service: string, method: string, path: string, meta: Record<string, unknown> = {}) =>
  node(`entry:${service}:http:${method}:${path}`, { type: 'entry', kind: 'http', repo: service, label: `${method} ${path}`, meta: { method, path, adapter: 'nestjs-http', ...meta } });

/** Protocol, validation, settings, status and CORS mismatches (P388), each beside the case its evidence does not hold. */
describe('a stream whose frames no listener hears', () => {
  const graph = (events: string[], listened: string[], unread = false) =>
    buildTestDb({
      services: ['api', 'web'],
      nodes: [
        route('api', 'GET', '/orders/events', { stream: 'sse', streamEvents: events, ...(unread ? { streamEventsUnread: true } : {}) }),
        node('ui_api_call:web#src/live.ts:4:20', { type: 'ui_api_call', kind: 'sse', repo: 'web', label: 'GET /orders/events', meta: { method: 'GET' } }),
        node('consumer:web#src/live.ts:Live.onReady', { type: 'consumer', kind: 'sse', repo: 'web', label: 'Live.onReady', file: 'src/live.ts', line: 5, meta: { client: 'EventSource', events: listened } }),
      ],
      edges: [
        edge('ui_api_call:web#src/live.ts:4:20', 'entry:api:http:GET:/orders/events', { type: 'hits' }),
        edge('ui_api_call:web#src/live.ts:4:20', 'consumer:web#src/live.ts:Live.onReady', { type: 'triggers' }),
      ],
    });

  it('names a named event a listener with only onmessage never hears', () => {
    const db = graph(['order-ready'], ['message']);
    const out = streamEventMismatches(db);
    db.close();
    expect(findings(out)).toMatchObject([
      {
        kind: 'sse-event-unhandled',
        id: 'consumer:web#src/live.ts:Live.onReady',
        precision: 'high',
        message: 'GET /orders/events sends frames as the event "order-ready", which Live.onReady never listens for: it listens for "message", and onmessage hears only frames named no event',
        fix: 'listen with addEventListener("order-ready", …), or send the frames with no event name',
      },
    ]);
  });

  it('says nothing where the listener listens for the name, and holds back where a frame is named at run time', () => {
    const heard = graph(['order-ready'], ['order-ready']);
    expect(streamEventMismatches(heard)).toEqual([]);
    heard.close();
    const named = graph(['message'], ['order-ready'], true);
    const out = streamEventMismatches(named);
    named.close();
    expect(findings(out).map((each) => each.kind)).toEqual(['sse-event-unhandled']);
    expect(held(out).map((each) => each.kind)).toEqual(['sse-event-never-sent', 'sse-event-unhandled']);
  });
});

describe('bot buttons and the handlers of their callback data', () => {
  const graph = (extra: { nodes?: ReturnType<typeof node>[]; unresolved?: object[] } = {}) =>
    buildTestDb({
      services: ['bot'],
      nodes: [
        node('bot#src/bot.ts:Bot.show', {
          repo: 'bot',
          label: 'Bot.show',
          meta: {
            callbackButtons: [
              { data: 'order:confirm', at: 'src/bot.ts:10' },
              { data: 'order:cancel:${…}', at: 'src/bot.ts:11' },
              { data: 'order:track', at: 'src/bot.ts:12' },
              { data: `order:details:${'x'.repeat(60)}`, at: 'src/bot.ts:13' },
            ],
          },
        }),
        node('entry:bot:bot_callback:order:confirm', { type: 'entry', kind: 'bot_callback', repo: 'bot', label: 'bot_callback order:confirm', meta: { key: 'order:confirm' } }),
        node('entry:bot:bot_callback:/^order:cancel:(\\w+)$/', { type: 'entry', kind: 'bot_callback', repo: 'bot', label: 'bot_callback cancel', meta: { key: '/^order:cancel:(\\w+)$/' } }),
        node('entry:bot:bot_callback:/^order:details:/', { type: 'entry', kind: 'bot_callback', repo: 'bot', label: 'bot_callback details', meta: { key: '/^order:details:/' } }),
        node('entry:bot:bot_callback:order:refund', { type: 'entry', kind: 'bot_callback', repo: 'bot', label: 'bot_callback order:refund', file: 'src/bot.ts', line: 5, meta: { key: 'order:refund' } }),
        ...(extra.nodes ?? []),
      ],
      edges: [],
      unresolved: (extra.unresolved ?? []) as never[],
    });

  it('names a button no handler matches, a handler no button sends, and data over 64 bytes', () => {
    const db = graph();
    const out = botButtonMismatches(db, db.allUnresolved());
    db.close();
    expect(findings(out).map((each) => [each.kind, each.loc ?? each.id])).toEqual([
      ['bot-button-unhandled', 'src/bot.ts:12'],
      ['bot-button-data-too-long', 'src/bot.ts:13'],
      ['bot-handler-untriggered', 'src/bot.ts:5'],
    ]);
  });

  it('holds back a dead button where a handler takes every callback, and an untriggered handler where a button is not read', () => {
    const db = graph({
      nodes: [
        node('entry:bot:bot_event:callback_query', { type: 'entry', kind: 'bot_event', repo: 'bot', label: 'bot_event callback_query', meta: { updateType: 'callback_query' } }),
        node('bot#src/bot.ts:Bot.more', { repo: 'bot', meta: { callbackButtons: [{ data: '${…}', at: 'src/bot.ts:20' }] } }),
      ],
    });
    const out = botButtonMismatches(db, db.allUnresolved());
    db.close();
    expect(findings(out).map((each) => each.kind)).toEqual(['bot-button-data-too-long']);
    expect(held(out).map((each) => [each.kind, each.why])).toEqual([
      ['bot-button-unhandled', 'bot_event callback_query (bot) takes every callback'],
      ['bot-handler-untriggered', 'a button sends callback data not read'],
    ]);
  });
});

describe('settings read against the settings set', () => {
  const key = (name: string, meta: Record<string, unknown> = {}) =>
    node(`config:api:${name}`, { type: 'config_key', repo: 'api', label: name, file: 'src/app.service.ts', line: 3, meta: { key: name, source: 'config.get', ...meta } });
  const graph = (settingNames?: Record<string, { names: Record<string, string[]>; files: string[]; schema?: string }>) =>
    buildTestDb({
      services: ['api'],
      nodes: [key('PAYMENT_API_KEY'), key('REDIS_URL'), key('LOG_LEVEL', { defaultValue: 'info' }), key('MODE', { fallback: true }), key('SMTP_HOST'), key('NODE_ENV')],
      edges: [],
      ...(settingNames === undefined ? {} : { settingNames }),
    });
  const files = { names: { PAYMENTS_API_KEY: ['.env.example'], SMTP_HOST: ['docker-compose.yml'], LEGACY_DIR: ['.env.example'] }, files: ['.env.example', 'docker-compose.yml'] };

  it('names a name spelled two ways, a key set nowhere and a name read nowhere; never a defaulted or platform key', () => {
    const db = graph({ api: files });
    const out = configMismatches(db, db.allUnresolved());
    db.close();
    expect(findings(out).map((each) => [each.kind, each.precision, each.id])).toEqual([
      ['config-name-mismatch', 'high', 'config:api:PAYMENT_API_KEY'],
      ['config-not-set', 'medium', 'config:api:REDIS_URL'],
      ['config-never-read', 'low', 'config_key:api#LEGACY_DIR'],
    ]);
  });

  it('holds back where a schema may give the default, or where nothing was recorded', () => {
    const schema = graph({ api: { ...files, schema: 'src/app.module.ts' } });
    const out = configMismatches(schema, schema.allUnresolved());
    schema.close();
    expect(held(out).map((each) => each.why)).toEqual([
      'the configuration module in src/app.module.ts validates the settings with a schema, which may give it a default',
      'the configuration module in src/app.module.ts validates the settings with a schema, which may give it a default',
    ]);
    const none = graph();
    const unrecorded = configMismatches(none, none.allUnresolved());
    none.close();
    expect(findings(unrecorded)).toEqual([]);
    expect(held(unrecorded)).toHaveLength(3);
  });
});

describe('a status the route never answers', () => {
  const graph = (fails: object[], extra: { unresolved?: object[] } = {}) =>
    buildTestDb({
      services: ['api', 'web'],
      nodes: [
        route('api', 'POST', '/orders/:param/cancel', { fails }),
        node('api#src/orders.controller.ts:OrdersController.cancel', { repo: 'api', file: 'src/orders.controller.ts', line: 9 }),
        node('ui_api_call:web#src/orders.ts:7:12', { type: 'ui_api_call', repo: 'web', label: 'POST /orders/:param/cancel', meta: { method: 'POST', statusChecks: [{ status: 409, at: 'src/panel.ts:4', in: 'Panel.cancel' }, { status: 410, at: 'src/panel.ts:5', in: 'Panel.cancel' }, { status: 503, at: 'src/panel.ts:6' }] } }),
      ],
      edges: [
        edge('entry:api:http:POST:/orders/:param/cancel', 'api#src/orders.controller.ts:OrdersController.cancel', { type: 'handles' }),
        edge('ui_api_call:web#src/orders.ts:7:12', 'entry:api:http:POST:/orders/:param/cancel', { type: 'hits' }),
      ],
      unresolved: (extra.unresolved ?? []) as never[],
    });

  it('names a branch on a status the route never answers, and never one a proxy may answer', () => {
    const db = graph([{ status: 409, exception: 'ConflictException', at: 'x', source: 'throw' }]);
    const out = statusMismatches(db, db.allUnresolved());
    db.close();
    expect(findings(out)).toMatchObject([
      { kind: 'status-never-answered', loc: 'src/panel.ts:5', precision: 'high', message: 'Panel.cancel branches on 410 from POST /orders/:param/cancel, which never answers 410: it answers 409' },
    ]);
  });

  it('holds back where a status is computed, or the code behind the route left a gap', () => {
    const computed = graph([{ exception: 'HttpException', at: 'x', source: 'throw' }]);
    expect(held(statusMismatches(computed, computed.allUnresolved())).map((each) => each.why)).toEqual([
      'POST /orders/:param/cancel throws HttpException, whose status is not read',
      'POST /orders/:param/cancel throws HttpException, whose status is not read',
    ]);
    computed.close();
    const gap = graph([], { unresolved: [{ service: 'api', file: 'src/orders.controller.ts', line: 11, reason: 'call-dynamic-receiver', level: 'action', message: 'x' }] });
    expect(held(statusMismatches(gap, gap.allUnresolved()))[0]?.why).toBe('the code behind POST /orders/:param/cancel was not read whole (call-dynamic-receiver at src/orders.controller.ts:11)');
    gap.close();
  });
});

describe('a browser request its server’s CORS refuses', () => {
  const graph = (cors: object, meta: Record<string, unknown>) =>
    buildTestDb({
      services: ['api', 'web'],
      nodes: [
        node('repo:api', { type: 'repo', repo: 'api', label: 'api', meta: { cors } }),
        route('api', 'DELETE', '/orders/:param'),
        node('ui_api_call:web#src/orders.ts:9:12', { type: 'ui_api_call', repo: 'web', label: 'DELETE /orders/:param', meta: { method: 'DELETE', ...meta } }),
      ],
      edges: [edge('ui_api_call:web#src/orders.ts:9:12', 'entry:api:http:DELETE:/orders/:param', { type: 'hits' })],
    });

  it('names credentials against *, a header and a verb not allowed', () => {
    const db = graph(
      { at: 'src/main.ts:5', origin: '*', credentials: false, allowedHeaders: ['authorization'], methods: ['GET', 'POST'] },
      { credentials: { at: 'src/orders.ts:9', via: 'call' }, headers: ['authorization', 'x-tenant'] },
    );
    const out = corsMismatches(db);
    db.close();
    expect(findings(out).map((each) => each.kind)).toEqual(['cors-credentials', 'cors-header-not-allowed', 'cors-method-not-allowed']);
    expect(findings(out)[1]?.message).toBe("DELETE /orders/:param sets x-tenant, which api's CORS does not allow (it allows authorization): the browser's preflight fails");
  });

  it('says nothing where the origin is named with credentials and every header and verb is allowed, and holds back what is not read', () => {
    const fine = graph({ at: 'src/main.ts:5', origin: 'list', credentials: true }, { credentials: { at: 'src/orders.ts:9', via: 'call' }, headers: ['x-tenant'] });
    expect(corsMismatches(fine)).toEqual([]);
    fine.close();
    const unread = graph({ at: 'src/main.ts:5', origin: 'unread', credentials: 'unread', allowedHeaders: 'unread' }, { credentials: { at: 'x', via: 'call' }, headers: ['x-tenant'] });
    expect(held(corsMismatches(unread)).map((each) => each.kind)).toEqual(['cors-credentials', 'cors-header-not-allowed']);
    unread.close();
  });
});

describe('the findings list them', () => {
  it('ranks them with the defects between the services, where the report is handed in', () => {
    const db = buildTestDb({
      services: ['bot'],
      nodes: [node('bot#src/bot.ts:Bot.show', { repo: 'bot', meta: { callbackButtons: [{ data: 'order:track', at: 'src/bot.ts:12' }] } })],
      edges: [],
    });
    const { findings: rows } = collectFindings(db, { rows: db.allUnresolved(), report: db.report()! });
    db.close();
    expect(rows.map((row) => [row.kind, row.precision])).toEqual([['bot-button-unhandled', 'high']]);
  });
});
