import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import type { BaseUrlAnswer } from './base-url-value.js';
import { findingFor, resolveCall, type RouteIndex } from './http-link.js';

/** A GraphQL endpoint whose schema declares these mutations. */
const endpoint = (path: string, mutations: readonly string[]): GraphNode => ({
  id: `entry:api:http:POST:${path}`,
  type: 'entry',
  kind: 'http',
  label: `POST ${path}`,
  repo: 'api',
  meta: { method: 'POST', path, graphql: { endpoint: true, fieldsAt: path, schema: { roots: { query: 'Query', mutation: 'Mutation' }, types: { Mutation: { fields: Object.fromEntries(mutations.map((name) => [name, {}])) } } } } },
});

/** An operation a server-rendered page sends to the whole address a setting holds. */
const operation = (field: string): GraphNode => ({
  id: 'http_out:shop#app/services/account.ts:5:3',
  type: 'http_out',
  label: `mutation ${field}`,
  repo: 'shop',
  meta: { method: 'POST', path: '', baseUrlEnv: 'STORE_API_URL', client: 'codegen-sdk', graphql: { operation: 'mutation', fields: [{ field }] } },
});

const value = (text: string, from: string) => ({ variable: 'STORE_API_URL', value: text, from, deployed: false });

const indexWith = (answer: BaseUrlAnswer): RouteIndex => ({
  routesOf: (service) => (service === 'api' ? [endpoint('/store-api', ['signIn']), endpoint('/office-api', ['signIn'])] : []),
  claimantsOf: () => [],
  markerOf: () => undefined,
  baseUrlOf: () => answer,
  services: () => ['api', 'shop'],
});

/**
 * A GraphQL operation between services, sent to a setting whose values name no
 * service (P281): the endpoint at the path its values for this machine agree
 * on, where it declares a root field asked for.
 */
describe('an operation a server sends to a setting no value of which names a service', () => {
  const local = value('http://localhost:3000/store-api', '.env.example');
  const deployed = value('https://demo.example.com/store-api', 'wrangler.toml');

  it('reaches the endpoint at the local value\'s path, rather than the third party the deployment names', () => {
    const { outcome, baseUrl } = resolveCall(operation('signIn'), indexWith({ kind: 'external', host: 'demo.example.com', found: deployed, values: [deployed, local] }));
    expect(outcome).toMatchObject({ kind: 'linked', via: 'graphqlPath' });
    expect(outcome.kind === 'linked' && outcome.entry.id).toBe('entry:api:http:POST:/store-api');
    expect(baseUrl?.from).toBe('.env.example');
  });

  it('is a row naming the root fields where the endpoint declares none of them', () => {
    const { outcome } = resolveCall(operation('payByCard'), indexWith({ kind: 'unsettled', values: [local], services: [], namedOnly: [] }));
    expect(outcome).toMatchObject({ kind: 'noRoute', targetService: 'api', unserved: ['Mutation.payByCard'] });
    expect(findingFor(outcome)?.reason).toBe('graphql-field-no-resolver');
  });

  // Where no value is for this machine, the deployment's public host is asked under the same rule (P292).
  it("reaches the one endpoint at the path a deployment's host alone names, as a guess, where it declares a field asked for", () => {
    const { outcome, baseUrl } = resolveCall(operation('signIn'), indexWith({ kind: 'external', host: 'demo.example.com', found: deployed, values: [deployed] }));
    expect(outcome).toMatchObject({ kind: 'linked', via: 'graphqlPath' });
    expect(outcome.kind === 'linked' && outcome.entry.id).toBe('entry:api:http:POST:/store-api');
    expect(baseUrl?.from).toBe('wrangler.toml');
  });

  it("is a row naming the root fields where the endpoint a deployment's host alone names declares none of them (P292)", () => {
    const { outcome } = resolveCall(operation('payByCard'), indexWith({ kind: 'external', host: 'demo.example.com', found: deployed, values: [deployed] }));
    expect(outcome).toMatchObject({ kind: 'noRoute', targetService: 'api', unserved: ['Mutation.payByCard'] });
  });

  // A value at a port the service's code listens on names the service (P292): its endpoints are asked under the same rule.
  it('asks the endpoints of the service a value for this machine names, and joins nothing the endpoint does not declare', () => {
    const named: BaseUrlAnswer = { kind: 'service', service: 'api', found: local, others: [] };
    expect(resolveCall(operation('signIn'), indexWith(named)).outcome).toMatchObject({ kind: 'linked', via: 'graphqlPath' });
    expect(resolveCall(operation('payByCard'), indexWith(named)).outcome).toMatchObject({ kind: 'noRoute', targetService: 'api', unserved: ['Mutation.payByCard'] });
  });

  it('leaves the third party a deployment names as it was where nothing serves its path', () => {
    const elsewhere = value('https://demo.example.com/graphql', 'wrangler.toml');
    const { outcome } = resolveCall(operation('signIn'), indexWith({ kind: 'external', host: 'demo.example.com', found: elsewhere, values: [elsewhere] }));
    expect(outcome).toMatchObject({ kind: 'external', host: 'demo.example.com' });
  });
});

/** A route a service serves. */
const route = (service: string, method: string, path: string): GraphNode => ({
  id: `entry:${service}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo: service,
  meta: { method, path },
});

/** A request a server sends under a setting. */
const serverRequest = (method: string, path: string): GraphNode => ({
  id: `http_out:worker#src/sync.ts:4:3`,
  type: 'http_out',
  label: `${method} ${path}`,
  repo: 'worker',
  meta: { method, path, baseUrlEnv: 'CATALOG_URL' },
});

/**
 * A server's request rooted at a setting whose value is a host no service is
 * reached at, with a path after it (P285, as P280 for a browser's): tried under
 * the value's path, a guess at whose deployment the host is.
 */
describe("a server's request rooted at a setting whose value is a host no service is reached at", () => {
  const external = (text: string): BaseUrlAnswer => ({ kind: 'external', host: 'api.example.test', found: { variable: 'CATALOG_URL', value: text, from: '.env', deployed: false } });
  const index = (answer: BaseUrlAnswer, routes: Record<string, GraphNode[]>): RouteIndex => ({
    routesOf: (service) => routes[service] ?? [],
    claimantsOf: () => [],
    markerOf: () => undefined,
    baseUrlOf: () => answer,
    services: () => Object.keys(routes),
  });

  it("joins the one service serving the address under the value's path", () => {
    const { outcome, baseUrl } = resolveCall(serverRequest('GET', '/products/:param'), index(external('https://api.example.test/api'), { catalog: [route('catalog', 'GET', '/api/products/:param')], worker: [] }));
    expect(outcome).toMatchObject({ kind: 'linked', via: 'externalValuePath' });
    expect(outcome.kind === 'linked' && outcome.entry.id).toBe('entry:catalog:http:GET:/api/products/:param');
    expect(baseUrl?.value).toBe('https://api.example.test/api');
  });

  it('stays a third party where two services serve it, where only the bare path is served, or where the value has no path', () => {
    const two = { catalog: [route('catalog', 'GET', '/api/products')], search: [route('search', 'GET', '/api/products')] };
    expect(resolveCall(serverRequest('GET', '/products'), index(external('https://api.example.test/api'), two)).outcome).toMatchObject({ kind: 'external' });
    const bare = { catalog: [route('catalog', 'GET', '/products')] };
    expect(resolveCall(serverRequest('GET', '/products'), index(external('https://api.example.test/api'), bare)).outcome).toMatchObject({ kind: 'external' });
    expect(resolveCall(serverRequest('GET', '/products'), index(external('https://api.example.test'), bare)).outcome).toMatchObject({ kind: 'external' });
  });
});
