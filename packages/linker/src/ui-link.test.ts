import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import {
  callPerChoice,
  missingChoiceFinding,
  resolveUiCall,
  uiFindingFor,
  type UiIndex,
} from './ui-link.js';

const call = (meta: Record<string, unknown>): GraphNode => ({
  id: 'ui_api_call:web#src/app/orders.client.ts:12:4',
  type: 'ui_api_call',
  label: 'POST /orders/:param/:param',
  repo: 'web',
  kind: 'http',
  meta: { method: 'POST', path: '/orders/:param/:param', ...meta },
});

/**
 * One call written, as the several addresses it stands for (R31).
 *
 * The expansion itself is a rewrite of one field, and it has to leave
 * everything else alone: an edge drawn from a copy is drawn from the call
 * somebody wrote, so the id may not move.
 */
describe('a call whose last segment is a closed set', () => {
  it('answers with one copy per value, each carrying its own address', () => {
    const copies = callPerChoice(
      call({ pathChoices: ['/orders/:param/ship', '/orders/:param/refund'] }),
    );
    expect(copies?.map((copy) => copy.meta?.['path'])).toEqual([
      '/orders/:param/ship',
      '/orders/:param/refund',
    ]);
  });

  it('keeps the id of the call that was written', () => {
    const copies = callPerChoice(
      call({ pathChoices: ['/orders/:param/ship', '/orders/:param/refund'] }),
    );
    expect(new Set(copies?.map((copy) => copy.id))).toEqual(
      new Set(['ui_api_call:web#src/app/orders.client.ts:12:4']),
    );
  });

  it('answers with nothing for a call that has no such segment', () => {
    // Which is nearly every call, and why asking is free.
    expect(callPerChoice(call({}))).toBeUndefined();
    expect(callPerChoice(call({ pathChoices: ['/orders/:param/only'] }))).toBeUndefined();
    expect(callPerChoice(call({ pathChoices: ['/a', 7] }))).toBeUndefined();
  });

  it('names the value that reaches nothing, and the ones that do', () => {
    const finding = missingChoiceFinding('POST', ['/orders/:param/hold'], ['/orders/:param/resume']);
    expect(finding.message).toBe(
      'POST /orders/:param/hold reaches no route, though /orders/:param/resume does',
    );
    expect(finding.reason).toBe('target-route-not-found');
  });
});

/** A route of one service, in the shape the merged graph holds it. */
const route = (repo: string, method: string, path: string): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path },
});

/**
 * The four lookups, from a plain table of who serves what.
 *
 * Written out here rather than built from a project, because the question below
 * is about the order the ways are tried in and about nothing else.
 */
const indexOf = (
  routes: Record<string, readonly GraphNode[]>,
  named: Record<string, string> = {},
  claims: Record<string, readonly string[]> = {},
): UiIndex => ({
  routesOf: (service) => routes[service],
  targetOf: (repo, env) => named[`${repo}\0${env}`],
  claimantsOf: (env) => claims[env] ?? [],
  services: () => Object.keys(routes).sort(),
});

/** A request written in a browser, relative unless a settings key is given. */
const uiCall = (
  repo: string,
  method: string,
  path: string,
  meta: Record<string, unknown> = {},
): GraphNode => ({
  id: `ui_api_call:${repo}#src/app/panel.tsx:3:2`,
  type: 'ui_api_call',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path, ...meta },
});

/**
 * Which service answers a request a browser made, and in what order that is
 * decided (R93).
 *
 * The caller's own service used to be the one service struck out of the
 * question, which is why every one of these is about where it sits in the order
 * rather than about matching a path.
 */
describe('a request a browser makes of the service it was served from', () => {
  it('reaches that service, and says the reading was of one repository', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'POST', '/api/cancel'),
      indexOf({ web: [route('web', 'POST', '/api/cancel')] }),
    );
    expect(outcome.kind).toBe('linked');
    if (outcome.kind !== 'linked') return;
    expect(outcome.via).toBe('same-service');
    expect(outcome.targetService).toBe('web');
  });

  it('is preferred to a second service that happens to serve the same address', () => {
    // Both could answer. The one the call was written in is not a guess, and
    // guessing between the two would have made this ambiguous instead.
    const outcome = resolveUiCall(
      uiCall('web', 'GET', '/api/things'),
      indexOf({
        api: [route('api', 'GET', '/api/things')],
        web: [route('web', 'GET', '/api/things')],
      }),
    );
    expect(outcome.kind === 'linked' && outcome.via).toBe('same-service');
    expect(outcome.kind === 'linked' && outcome.targetService).toBe('web');
  });

  it('gives way to what the configuration names outright', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'GET', '/api/things', { baseUrlEnv: 'API_URL' }),
      indexOf(
        { api: [route('api', 'GET', '/api/things')], web: [route('web', 'GET', '/api/things')] },
        { 'web\0API_URL': 'api' },
      ),
    );
    expect(outcome.kind === 'linked' && outcome.via).toBe('api-target');
    expect(outcome.kind === 'linked' && outcome.targetService).toBe('api');
  });

  it('gives way to the one service claiming the settings key as its base', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'GET', '/api/things', { baseUrlEnv: 'API_URL' }),
      indexOf(
        { api: [route('api', 'GET', '/api/things')], web: [route('web', 'GET', '/api/things')] },
        {},
        { API_URL: ['api'] },
      ),
    );
    expect(outcome.kind === 'linked' && outcome.via).toBe('base-url-env');
  });

  it('does not stop the search when its own service serves no such address', () => {
    // A frontend that also serves routes may still be calling somebody else's,
    // so a genuine cross-service request resolves exactly as it did before.
    const outcome = resolveUiCall(
      uiCall('web', 'GET', '/api/orders'),
      indexOf({
        api: [route('api', 'GET', '/api/orders')],
        web: [route('web', 'GET', '/api/session')],
      }),
    );
    expect(outcome.kind === 'linked' && outcome.via).toBe('unique-route');
    expect(outcome.kind === 'linked' && outcome.targetService).toBe('api');
  });

  it('still says so when nothing anywhere serves the address', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'POST', '/api/cancel'),
      indexOf({ web: [route('web', 'GET', '/api/session')] }),
    );
    expect(outcome.kind).toBe('noRoute');
    expect(uiFindingFor(outcome)?.message).toBe('no configured service serves POST /api/cancel');
  });

  it('names the verbs its own service does answer that path with', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'POST', '/api/things'),
      indexOf({ web: [route('web', 'GET', '/api/things'), route('web', 'DELETE', '/api/things')] }),
    );
    expect(outcome.kind === 'noRoute' && outcome.verbs).toEqual(['DELETE', 'GET']);
    expect(uiFindingFor(outcome)?.hint).toContain('That path answers DELETE, GET.');
  });

  /**
   * A browser asking a service that creates two applications (R119).
   *
   * The interesting half is that the service is still found. Asking for a single
   * match struck a service whose own entries tie out of the search for who
   * answers, and the request then came back as one no configured service serves —
   * false, and pointing at the configuration rather than at the two applications.
   */
  describe('two applications of one service answering', () => {
    const inApplication = (repo: string, path: string, application: string): GraphNode => ({
      id: `entry:${repo}@${application}:http:GET:${path}`,
      type: 'entry',
      kind: 'http',
      label: `GET ${path} (${application})`,
      repo,
      meta: { method: 'GET', path, application },
    });

    it('names the applications rather than blaming the configuration', () => {
      const outcome = resolveUiCall(
        uiCall('web', 'GET', '/health'),
        indexOf({
          api: [
            inApplication('api', '/health', 'ApiModule'),
            inApplication('api', '/health', 'WorkerModule'),
          ],
          web: [],
        }),
      );
      expect(outcome.kind).toBe('ambiguous');
      expect(uiFindingFor(outcome)?.reason).toBe('ambiguous-route-application');
      expect(uiFindingFor(outcome)?.hint).not.toContain('apiTarget');
    });

    it('still points at the configuration when two services answer', () => {
      const outcome = resolveUiCall(
        uiCall('web', 'GET', '/health'),
        indexOf({
          api: [route('api', 'GET', '/health')],
          legacy: [route('legacy', 'GET', '/health')],
          web: [],
        }),
      );
      expect(uiFindingFor(outcome)?.reason).toBe('ambiguous-route-target');
      expect(uiFindingFor(outcome)?.hint).toContain('apiTarget');
    });
  });

  it("finds a route of its own service behind that service's global prefix", () => {
    // The browser is handed a base address that already ends in the prefix, so
    // the path it writes is the path without it.
    const prefixed = route('web', 'GET', '/api/things');
    prefixed.meta = { ...prefixed.meta, globalPrefix: 'api' };
    const outcome = resolveUiCall(uiCall('web', 'GET', '/things'), indexOf({ web: [prefixed] }));
    expect(outcome.kind === 'linked' && outcome.via).toBe('same-service');
  });
});

/**
 * A request that no route read in full answers, beside a route whose address has
 * a part nobody read (R137).
 *
 * A notification service's shape: every address begins with a mount the deployment sets, so each
 * route is recorded as `/${…}v1/…`, and the client asks for `/v1/…` under a base
 * that already carries the mount. Forty-two such requests were reported as ones
 * no configured service serves.
 */
describe('a request behind the part of a route nobody read', () => {
  const mounted = route('api', 'GET', '/${…}v1/agents/:param/bridge');

  it('is still not joined', () => {
    const outcome = resolveUiCall(
      uiCall('cli', 'GET', '/v1/agents/:param/bridge'),
      indexOf({ api: [mounted], cli: [] }),
    );
    expect(outcome.kind).toBe('noRoute');
  });

  it('names the route it would reach, rather than saying nothing serves it', () => {
    const outcome = resolveUiCall(
      uiCall('cli', 'GET', '/v1/agents/:param/bridge'),
      indexOf({ api: [mounted], cli: [] }),
    );
    expect(outcome.kind === 'noRoute' && outcome.unread).toEqual(['api GET /${…}v1/agents/:param/bridge']);
    const finding = uiFindingFor(outcome);
    expect(finding?.reason).toBe('target-route-not-found');
    expect(finding?.message).toBe(
      'no configured service serves GET /v1/agents/:param/bridge at an address read in full, though ' +
        'api GET /${…}v1/agents/:param/bridge answers it if the part of its address nobody read is left open',
    );
    expect(finding?.hint).toContain('not evidence that the route is missing');
  });

  it('says the same of a service the configuration named', () => {
    const outcome = resolveUiCall(
      uiCall('cli', 'GET', '/v1/agents/:param/bridge', { baseUrlEnv: 'NOVU_API_URL' }),
      indexOf({ api: [mounted], cli: [] }, { 'cli\0NOVU_API_URL': 'api' }),
    );
    expect(uiFindingFor(outcome)?.message).toContain('target service api has no route GET');
    expect(uiFindingFor(outcome)?.message).toContain('api GET /${…}v1/agents/:param/bridge answers it');
  });

  it('keeps the plain sentence where the read part already rules the route out', () => {
    // By verb, by a literal segment, and by a route of which nothing but the
    // hole was read, which would otherwise be named beside every request.
    const outcome = resolveUiCall(
      uiCall('cli', 'POST', '/v1/invoices'),
      indexOf({
        api: [mounted, route('api', 'GET', '/${…}v1/invoices'), route('api', 'POST', '/${…}')],
        cli: [],
      }),
    );
    expect(outcome.kind === 'noRoute' && outcome.unread).toEqual([]);
    expect(uiFindingFor(outcome)?.message).toBe('no configured service serves POST /v1/invoices');
  });
});

/** A GraphQL endpoint of one service: a route carrying a schema. */
const endpoint = (repo: string, path: string): GraphNode => {
  const made = route(repo, 'POST', path);
  return { ...made, meta: { ...made.meta, graphql: { endpoint: true } } };
};

/**
 * A GraphQL operation sent under a base nothing read (P266): the read rest of
 * its address is asked of the services' GraphQL endpoints, and of nothing else.
 */
describe('an operation sent under a base nothing read', () => {
  const operation = (path: string, meta: Record<string, unknown> = {}): GraphNode =>
    uiCall('web', 'POST', path, { graphql: { operation: 'query', fields: [] }, ...meta });

  it('reaches the one endpoint whose path the read rest names', () => {
    const index = indexOf({ api: [endpoint('api', '/graphql'), endpoint('api', '/settings'), route('api', 'POST', '/uploads')] });
    const outcome = resolveUiCall(operation('/${…}/settings'), index);
    expect(outcome).toMatchObject({ kind: 'linked', via: 'graphql-path', targetService: 'api' });
    expect(outcome.kind === 'linked' && outcome.entry.id).toBe('entry:api:http:POST:/settings');
  });

  it('names both where two endpoints end with it', () => {
    const index = indexOf({ api: [endpoint('api', '/graphql')], legacy: [endpoint('legacy', '/v1/graphql')] });
    const outcome = resolveUiCall(operation('/${…}/graphql'), index);
    expect(outcome.kind).toBe('ambiguous');
    expect(uiFindingFor(outcome)?.message).toBe('api at /graphql and legacy at /v1/graphql both answer POST /${…}/graphql');
  });

  it('asks only the service its settings key names, where it names one', () => {
    const index = indexOf({ api: [endpoint('api', '/graphql')], legacy: [endpoint('legacy', '/graphql')] }, { 'web\0API_URL': 'legacy' });
    const outcome = resolveUiCall(operation('/${…}/graphql', { baseUrlEnv: 'API_URL' }), index);
    expect(outcome).toMatchObject({ kind: 'linked', targetService: 'legacy' });
  });

  it('is still partly read for a route that is no endpoint, a request that sends no operation, or a hole after the opening', () => {
    const index = indexOf({ api: [endpoint('api', '/graphql'), route('api', 'POST', '/uploads')] });
    expect(resolveUiCall(operation('/${…}/uploads'), index)).toEqual({ kind: 'dynamic', reason: 'api-path-partly-read' });
    expect(resolveUiCall(uiCall('web', 'POST', '/${…}/graphql'), index)).toEqual({ kind: 'dynamic', reason: 'api-path-partly-read' });
    expect(resolveUiCall(operation('/${…}/${…}/graphql'), index)).toEqual({ kind: 'dynamic', reason: 'api-path-partly-read' });
  });

  it('takes a request a GraphQL client sends for an operation, whose document was not read', () => {
    const index = indexOf({ api: [endpoint('api', '/graphql')] });
    expect(resolveUiCall(uiCall('web', 'POST', '/${…}/graphql', { client: 'apollo' }), index)).toMatchObject({ kind: 'linked', via: 'graphql-path' });
  });
});

/**
 * A GraphQL operation sent to a setting whose values name no configured
 * service (P281): the path its values for this machine agree on is asked of
 * the services' GraphQL endpoints, and joined only where the endpoint serves
 * a root field the operation asks for.
 */
describe('an operation sent to a setting no value of which names a service', () => {
  const value = (text: string, from: string) => ({ variable: 'STORE_API_URL', value: text, from, deployed: false });
  const schemaEndpoint = (repo: string, path: string, fields: Record<string, unknown>): GraphNode => {
    const made = endpoint(repo, path);
    return { ...made, meta: { ...made.meta, graphql: { endpoint: true, fieldsAt: path, schema: { roots: { query: 'Query', mutation: 'Mutation' }, types: { Mutation: { fields } } } } } };
  };
  const operation = (field: string): GraphNode =>
    uiCall('web', 'POST', '/', { baseUrlEnv: 'STORE_API_URL', client: 'codegen-sdk', graphql: { operation: 'mutation', fields: [{ field }] } });
  const indexWith = (values: ReturnType<typeof value>[]): UiIndex => ({
    ...indexOf({ api: [schemaEndpoint('api', '/store-api', { signIn: {} }), schemaEndpoint('api', '/office-api', { signIn: {} })], web: [] }),
    baseUrlOf: () => ({ kind: 'external', host: 'demo.example.com', found: values[0] as ReturnType<typeof value>, values }),
  });

  it('reaches the endpoint at the path of the value for running it here, a third party deployment aside', () => {
    const index = indexWith([value('https://demo.example.com/store-api', 'wrangler.toml'), value('http://localhost:3000/store-api', '.env.example')]);
    const outcome = resolveUiCall(operation('signIn'), index);
    expect(outcome).toMatchObject({ kind: 'linked', via: 'graphql-path', targetService: 'api' });
    expect(outcome.kind === 'linked' && outcome.entry.id).toBe('entry:api:http:POST:/store-api');
    expect(outcome.kind === 'linked' && outcome.baseUrl?.from).toBe('.env.example');
  });

  it('is not joined where the endpoint declares none of the root fields, and says which', () => {
    const index = indexWith([value('http://localhost:3000/store-api', '.env.example')]);
    const outcome = resolveUiCall(operation('payByCard'), index);
    expect(outcome).toMatchObject({ kind: 'noRoute', targetService: 'api', unserved: ['Mutation.payByCard'] });
    expect(uiFindingFor(outcome)?.reason).toBe('graphql-field-no-resolver');
  });

  it('reaches the one endpoint a public host\'s path names, as a guess (P280), and decides nothing from local values that disagree', () => {
    const outcome = resolveUiCall(operation('signIn'), indexWith([value('https://demo.example.com/store-api', 'wrangler.toml')]));
    expect(outcome).toMatchObject({ kind: 'linked', targetService: 'api' });
    expect(outcome.kind === 'linked' && outcome.entry.id).toBe('entry:api:http:POST:/store-api');
    const split = indexWith([value('http://localhost:3000/store-api', '.env'), value('http://localhost:3000/office-api', '.env.example')]);
    expect(resolveUiCall(operation('signIn'), split)).toMatchObject({ kind: 'noRoute', targetService: null });
  });
});

describe('a request rooted at a setting whose value is a host no service is reached at (P280)', () => {
  const external = (value: string): UiIndex['baseUrlOf'] => () => ({
    kind: 'external',
    host: 'api.example.test',
    found: { variable: 'apiUrl', value, from: 'src/environments/environment.ts', deployed: false },
  });

  it("reaches the one service serving the address under the value's path, as a guess", () => {
    const index = { ...indexOf({ api: [route('api', 'GET', '/api/products/:param')] }), baseUrlOf: external('https://api.example.test/api') };
    const outcome = resolveUiCall(uiCall('web', 'GET', '/products/:param', { baseUrlEnv: 'apiUrl' }), index);
    expect(outcome).toMatchObject({ kind: 'linked', via: 'unique-route', targetService: 'api' });
  });

  it('reaches the address as written where nothing serves it under that path', () => {
    const index = { ...indexOf({ api: [route('api', 'GET', '/products')] }), baseUrlOf: external('https://api.example.test/v2') };
    const outcome = resolveUiCall(uiCall('web', 'GET', '/products', { baseUrlEnv: 'apiUrl' }), index);
    expect(outcome).toMatchObject({ kind: 'linked', via: 'unique-route', targetService: 'api' });
  });
});
