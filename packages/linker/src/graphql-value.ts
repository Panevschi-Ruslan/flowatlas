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
  | { readonly kind: 'unserved'; readonly service: string; readonly path: string; readonly fields: readonly string[] }
  /**
   * A public host whose path no endpoint serves, or that has none (P296),
   * where several of the project's endpoints serve the operation.
   */
  | { readonly kind: 'undecided'; readonly endpoints: readonly { readonly service: string; readonly path: string }[]; readonly fields: readonly string[]; readonly found: FoundValue };

/** Every GraphQL endpoint of the services, with the service serving it. */
const endpointsOf = (services: readonly string[], routesOf: (service: string) => readonly GraphNode[] | undefined, at?: string): { service: string; entry: GraphNode }[] =>
  services.flatMap((service) =>
    (routesOf(service) ?? [])
      .filter((route) => (route.meta?.['graphql'] as { endpoint?: boolean } | undefined)?.endpoint === true && route.meta?.['method'] === 'POST' && (at === undefined || route.meta?.['path'] === at))
      .map((entry) => ({ service, entry })),
  );

/**
 * A GraphQL operation whose only values are public hosts none of whose paths
 * an endpoint serves - a gateway in front rewriting it, or a host with no
 * path (P296): the host is a deployment of the project's one endpoint that
 * serves the operation, where exactly one qualifies - the only endpoint, or
 * the only one declaring a root field the operation asks for - joined as a
 * guess, as a browser's request under such a host is by its route alone
 * (P280). Several are a row saying so; none serving the operation leaves the
 * host a third party's.
 */
const publicHostEndpoint = (
  call: GraphNode,
  found: FoundValue,
  services: readonly string[],
  routesOf: (service: string) => readonly GraphNode[] | undefined,
): LocalGraphqlAnswer | undefined => {
  const endpoints = endpointsOf(services, routesOf);
  if (endpoints.length === 0) return undefined;
  const asked = rootFieldsAsked(call);
  const serving = asked.length === 0 ? endpoints : endpoints.filter((each) => asked.some((field) => servesRootField(each.entry, field, routesOf(each.service) ?? [])));
  const [only] = serving;
  if (serving.length === 1 && only !== undefined) return { kind: 'linked', service: only.service, entry: only.entry, found };
  // None serving it: the host is a third party's, whose operation nothing here declares.
  if (serving.length === 0) return undefined;
  return { kind: 'undecided', endpoints: serving.map((each) => ({ service: each.service, path: String(each.entry.meta?.['path']) })), fields: asked, found };
};

/** The row a public host several endpoints qualify for is (P296). */
export const undecidedFinding = (answer: Extract<LocalGraphqlAnswer, { kind: 'undecided' }>): { reason: string; message: string; hint: string } => ({
  reason: 'ambiguous-route-target',
  message: `${answer.found.variable} is ${answer.found.value}, a public host no endpoint's path matches, and the GraphQL endpoints ${answer.endpoints
    .map((each) => `${each.service} (POST ${each.path})`)
    .join(' and ')} each serve the operation, so it is joined to neither`,
  hint: `Add ${answer.found.variable} to services[].baseUrlEnv of the service whose deployment the host is.`,
});

/**
 * A GraphQL operation sent to a setting whose values name no configured
 * service (P281): `STORE_API_URL=http://localhost:3000/store-api` in the
 * repository's example environment, where nothing says which service listens
 * on that port. The value for running the project on this machine says
 * where on the server the operation goes, and only a GraphQL endpoint
 * answers an operation: the path its local values agree on is asked of every
 * endpoint of every configured service, and the one that serves exactly it
 * answers - a guess, as a route found by its address alone is. A value with
 * a public host is asked only where no value for this machine has a path
 * (P292): the deployment's demo host in a platform file, where nothing else
 * says where the operation goes, under the same rule - one path the values
 * agree on, one endpoint of the project serving exactly it, a root field it
 * declares. Two endpoints at the path, or values that disagree, leave the
 * request where it was. An endpoint whose schema and resolvers declare none of the
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
  if (!sendsOperation(call) || call.meta?.['method'] !== 'POST' || answer === undefined) return undefined;
  // Values that name a service - a port its code listens on (P292) - ask
  // only its endpoints, under the same rule: an operation none of whose root
  // fields the endpoint declares is not joined there for being at its address.
  const values = answer.kind === 'unsettled' ? answer.values : answer.kind === 'service' ? [answer.found, ...answer.others] : (answer.values ?? [answer.found]);
  const among = answer.kind === 'service' ? services.filter((service) => service === answer.service) : services;
  /** The paths the values on one side of the machine's edge put in front, each with the first value saying so. */
  const pathsOf = (inner: boolean): Map<string, FoundValue> => {
    const paths = new Map<string, FoundValue>();
    for (const found of values) {
      const host = hostOf(found.value);
      if (host === undefined || isInnerHost(host.hostname) !== inner) continue;
      const start = pathOfValue(found);
      if (start === undefined) continue;
      const whole = normalizePath(`${start}/${path}`);
      if (!paths.has(whole)) paths.set(whole, found);
    }
    return paths;
  };
  // The values for this machine first; where there are none, the public
  // hosts' (P292): a project whose only value is its deployment's demo host.
  const local = pathsOf(true);
  // A service's public address is its deployment's, which its own join reads.
  const publicOnly = local.size === 0 && answer.kind !== 'service';
  const paths = publicOnly ? pathsOf(false) : local;
  // The public hosts, where nothing for this machine says (P296): the first, for the row and the join.
  const publicValue = publicOnly ? values.find((found) => { const host = hostOf(found.value); return host !== undefined && !isInnerHost(host.hostname); }) : undefined;
  const byHost = (): LocalGraphqlAnswer | undefined =>
    publicValue === undefined || paths.size > 1 ? undefined : publicHostEndpoint(call, publicValue, services, routesOf);
  if (paths.size !== 1) return byHost();
  const [[at, found]] = [...paths] as [[string, FoundValue]];
  const endpoints = endpointsOf(among, routesOf, at);
  const [only] = endpoints;
  if (endpoints.length === 0) return byHost();
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
