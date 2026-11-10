import { hostOf, isInnerHost, normalizePath, type GraphNode } from '@flowatlas/core';
import type { BaseUrlAnswer, FoundValue } from './base-url-value.js';
import { pathOfValue } from './http-link.js';

/** The clients that send nothing but GraphQL operations. */
export const GRAPHQL_CLIENTS = new Set(['apollo', 'urql', 'graphql-request', 'apollo-angular', 'codegen-sdk']);

/** Whether a request sends a GraphQL operation: its document was read, or a GraphQL client sends it whatever its document. */
export const sendsOperation = (call: GraphNode): boolean => call.meta?.['graphql'] !== undefined || GRAPHQL_CLIENTS.has(String(call.meta?.['client']));

/** What the values of a request's setting say of the GraphQL endpoint it reaches (P281). */
export type LocalGraphqlAnswer =
  | { readonly kind: 'linked'; readonly service: string; readonly entry: GraphNode; readonly found: FoundValue }
  | { readonly kind: 'unserved'; readonly service: string; readonly path: string; readonly fields: readonly string[] };

/**
 * A GraphQL operation sent to a setting whose values name no configured
 * service (P281): `STORE_API_URL=http://localhost:3000/store-api` in the
 * repository's example environment, where nothing says which service listens
 * on that port. The value for running the project on this machine says
 * where on the server the operation goes, and only a GraphQL endpoint
 * answers an operation: the path its local values agree on is asked of every
 * endpoint of every configured service, and the one that serves exactly it
 * answers - a guess, as a route found by its address alone is. A value with
 * a public host is the deployment's third party and decides nothing here;
 * two endpoints at the path, or values that disagree, leave the request
 * where it was. An endpoint whose schema and resolvers declare none of the
 * root fields the operation asks for is not the one meant, or serves them
 * from code nothing here read: the request is not joined, and the row names
 * the fields.
 */
export const localGraphqlEndpoint = (
  call: GraphNode,
  path: string,
  answer: BaseUrlAnswer | undefined,
  services: readonly string[],
  routesOf: (service: string) => readonly GraphNode[] | undefined,
): LocalGraphqlAnswer | undefined => {
  if (!sendsOperation(call) || call.meta?.['method'] !== 'POST' || answer === undefined || answer.kind === 'service') return undefined;
  const values = answer.kind === 'unsettled' ? answer.values : (answer.values ?? [answer.found]);
  const paths = new Map<string, FoundValue>();
  for (const found of values) {
    const host = hostOf(found.value);
    if (host === undefined || !isInnerHost(host.hostname)) continue;
    const start = pathOfValue(found);
    if (start === undefined) continue;
    const whole = normalizePath(`${start}/${path}`);
    if (!paths.has(whole)) paths.set(whole, found);
  }
  if (paths.size !== 1) return undefined;
  const [[at, found]] = [...paths] as [[string, FoundValue]];
  const endpoints = services.flatMap((service) =>
    (routesOf(service) ?? [])
      .filter((route) => (route.meta?.['graphql'] as { endpoint?: boolean } | undefined)?.endpoint === true && route.meta?.['method'] === 'POST' && route.meta?.['path'] === at)
      .map((entry) => ({ service, entry })),
  );
  const [only] = endpoints;
  if (endpoints.length !== 1 || only === undefined) return undefined;
  const asked = rootFieldsAsked(call);
  if (asked.length > 0 && !asked.some((field) => servesRootField(only.entry, field, routesOf(only.service) ?? []))) {
    return { kind: 'unserved', service: only.service, path: at, fields: asked };
  }
  return { kind: 'linked', service: only.service, entry: only.entry, found };
};

/** The root fields an operation asks for, as `Mutation.signIn`. */
const rootFieldsAsked = (call: GraphNode): string[] => {
  const operation = call.meta?.['graphql'] as { operation?: string; fields?: ReadonlyArray<{ field?: string }> } | undefined;
  if (operation === undefined || !Array.isArray(operation.fields)) return [];
  const root = operation.operation === 'mutation' ? 'Mutation' : operation.operation === 'subscription' ? 'Subscription' : 'Query';
  return operation.fields.flatMap((field) => (typeof field.field === 'string' && field.field !== '__typename' ? [`${root}.${field.field}`] : []));
};

/** Whether an endpoint's schema declares a root field, or a resolver of its service answers it there. */
const servesRootField = (endpoint: GraphNode, field: string, routes: readonly GraphNode[]): boolean => {
  const served = endpoint.meta?.['graphql'] as { schema?: { roots?: Record<string, string>; types?: Record<string, { fields?: Record<string, unknown> }> }; fieldsAt?: string; open?: string } | undefined;
  if (served?.open !== undefined || served?.schema === undefined) return true;
  const [root, name] = field.split('.') as [string, string];
  const type = served.schema.roots?.[root.toLowerCase()] ?? root;
  if (served.schema.types?.[type]?.fields?.[name] !== undefined) return true;
  const keyed = served.fieldsAt === undefined ? '' : `@${served.fieldsAt}`;
  return routes.some((route) => route.id.endsWith(`:graphql:${type}.${name}${keyed}`));
};

/** The row an operation no endpoint at the path serves is. */
export const unservedFinding = (service: string, method: string, path: string, fields: readonly string[]): { reason: string; message: string; hint: string } => ({
  reason: 'graphql-field-no-resolver',
  message: `${service} serves the GraphQL endpoint ${method} ${path} the value of the request's setting names, and neither its schema nor a resolver declares ${fields.join(', ')}: nothing read serves the operation, so it is not joined there`,
  hint: 'A plugin or package the server loads may add the field; read it as a service, or correct the operation.',
});
