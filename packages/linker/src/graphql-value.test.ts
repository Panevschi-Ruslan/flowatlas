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

  it('leaves the third party a deployment alone names as it was', () => {
    const { outcome } = resolveCall(operation('signIn'), indexWith({ kind: 'external', host: 'demo.example.com', found: deployed, values: [deployed] }));
    expect(outcome).toMatchObject({ kind: 'external', host: 'demo.example.com' });
  });
});
