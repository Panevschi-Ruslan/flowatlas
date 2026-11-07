import type { CallExpression, ClassDeclaration, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { documentOf } from './documents.js';

/**
 * The calls that send a GraphQL operation (P232), in the spellings of the
 * clients a repository uses: Apollo Client's hooks and `client.query`,
 * urql's, graphql-request's `request` and `GraphQLClient#request`,
 * apollo-angular's `this.apollo.query` and its `Query` services, and `fetch`
 * with a body holding `query`. Each is a request to an endpoint, which is
 * what joins it to a service; the document is what joins it to the fields.
 */
export type GraphqlLibrary = 'apollo' | 'urql' | 'graphql-request' | 'apollo-angular' | 'fetch';

export interface GraphqlCall {
  readonly library: GraphqlLibrary;
  /** The expression the document is. */
  readonly document: TsNode | undefined;
  /** The address the call itself names, where it names one. */
  readonly endpoint?: TsNode;
  /** A subscription goes over a socket. */
  readonly transport?: 'ws';
}

const APOLLO_HOOKS = new Set(['useQuery', 'useLazyQuery', 'useSuspenseQuery', 'useBackgroundQuery', 'useMutation', 'useSubscription', 'useReadQuery']);
const URQL_HOOKS = new Set(['useQuery', 'useMutation', 'useSubscription']);

/** The module a name is imported from, and the name it exports it under, when it is imported. */
const importOf = (name: TsNode): { module: string; exported: string } | undefined => {
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isImportSpecifier(declaration)) return { module: declaration.getImportDeclaration().getModuleSpecifierValue(), exported: declaration.getName() };
    if (Node.isImportClause(declaration)) {
      const parent = declaration.getParent();
      if (Node.isImportDeclaration(parent)) return { module: parent.getModuleSpecifierValue(), exported: 'default' };
    }
  }
  return undefined;
};

const property = (object: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const found = object.getProperty(key);
  if (found === undefined) return undefined;
  if (Node.isPropertyAssignment(found)) return found.getInitializer();
  if (Node.isShorthandPropertyAssignment(found)) return found.getNameNode();
  return undefined;
};

const objectAt = (call: CallExpression, index: number): ObjectLiteralExpression | undefined => {
  const argument = call.getArguments()[index];
  return argument !== undefined && Node.isObjectLiteralExpression(argument) ? argument : undefined;
};

/** Whether an expression is a document this can read: what tells `client.query(doc)` from `db.query(sql)`. */
const isDocument = (expression: TsNode | undefined): boolean => expression !== undefined && documentOf(expression).kind === 'read';

/** The address a `new GraphQLClient(url)` the receiver was made by names. */
const constructedWith = (receiver: TsNode, className: string): TsNode | undefined => {
  if (!Node.isIdentifier(receiver) && !Node.isPropertyAccessExpression(receiver)) return undefined;
  for (const declaration of receiver.getSymbol()?.getDeclarations() ?? []) {
    const value = Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (value !== undefined && Node.isNewExpression(value) && value.getExpression().getText().replace(/^.*\./, '') === className) return value.getArguments()[0];
  }
  return undefined;
};

/** What a call sends, when it sends a GraphQL operation. */
export const graphqlCallOf = (call: CallExpression): GraphqlCall | undefined => {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) {
    const imported = importOf(callee);
    // A hook imported under another name is the hook it exports: `useQuery as useApollo`.
    const name = imported?.exported ?? callee.getText();
    const module = imported?.module;
    if (name === 'fetch' && module === undefined) {
      const document = fetchedDocument(call);
      return document === undefined ? undefined : { library: 'fetch', document, ...(call.getArguments()[0] === undefined ? {} : { endpoint: call.getArguments()[0] as TsNode }) };
    }
    if (module === undefined) return undefined;
    if (APOLLO_HOOKS.has(name) && module.startsWith('@apollo/client')) {
      return { library: 'apollo', document: call.getArguments()[0], ...(name === 'useSubscription' ? { transport: 'ws' as const } : {}) };
    }
    if (URQL_HOOKS.has(name) && (module === 'urql' || module.startsWith('@urql/'))) {
      const options = objectAt(call, 0);
      const document = options === undefined ? call.getArguments()[0] : property(options, 'query');
      return { library: 'urql', document, ...(name === 'useSubscription' ? { transport: 'ws' as const } : {}) };
    }
    if (name === 'request' && module === 'graphql-request') {
      const options = objectAt(call, 0);
      if (options !== undefined) return { library: 'graphql-request', document: property(options, 'document'), ...(property(options, 'url') === undefined ? {} : { endpoint: property(options, 'url') as TsNode }) };
      const [endpoint, document] = call.getArguments();
      return { library: 'graphql-request', document, ...(endpoint === undefined ? {} : { endpoint }) };
    }
    return undefined;
  }
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.getName();
  const receiver = callee.getExpression();
  const angular = /apollo$/i.test(receiver.getText()) || receiver.getType().getText().endsWith('Apollo');
  const options = objectAt(call, 0);
  if (options !== undefined && ['query', 'watchQuery', 'subscribe'].includes(method) && isDocument(property(options, 'query'))) {
    return { library: angular ? 'apollo-angular' : 'apollo', document: property(options, 'query'), ...(method === 'subscribe' ? { transport: 'ws' as const } : {}) };
  }
  if (options !== undefined && method === 'mutate' && isDocument(property(options, 'mutation'))) {
    return { library: angular ? 'apollo-angular' : 'apollo', document: property(options, 'mutation') };
  }
  const first = call.getArguments()[0];
  if (['query', 'mutation', 'subscription'].includes(method) && isDocument(first)) {
    return { library: 'urql', document: first, ...(method === 'subscription' ? { transport: 'ws' as const } : {}) };
  }
  if (method === 'request' && isDocument(first)) {
    const endpoint = constructedWith(receiver, 'GraphQLClient');
    return { library: 'graphql-request', document: first, ...(endpoint === undefined ? {} : { endpoint }) };
  }
  return undefined;
};

/** The document a `fetch` sends, where its body is `JSON.stringify({ query })` written in place. */
export const fetchedDocument = (call: CallExpression): TsNode | undefined => {
  const init = objectAt(call, 1);
  const body = init === undefined ? undefined : property(init, 'body');
  if (body === undefined || !Node.isCallExpression(body) || body.getExpression().getText() !== 'JSON.stringify') return undefined;
  const [payload] = body.getArguments();
  if (payload === undefined || !Node.isObjectLiteralExpression(payload)) return undefined;
  const query = property(payload, 'query');
  return isDocument(query) ? query : undefined;
};

/**
 * The document an apollo-angular `Query` service holds:
 * `class OrdersGQL extends Query<…> { document = gql\`…\` }`, which the
 * screens call as `this.ordersGQL.fetch()` or `.watch()`.
 */
export const serviceDocumentOf = (declaration: ClassDeclaration): TsNode | undefined => {
  const base = declaration.getExtends()?.getExpression().getText();
  if (base === undefined || !['Query', 'Mutation', 'Subscription'].includes(base)) return undefined;
  return declaration.getProperty('document')?.getInitializer();
};

/** The calls of a service class that send its document: `fetch`, `watch`, `mutate`, `subscribe`. */
export const SERVICE_SENDS = new Set(['fetch', 'watch', 'mutate', 'subscribe']);

/**
 * The address the application's GraphQL client is made with, where it is
 * made once: `new ApolloClient({ uri })`, `new HttpLink({ uri })`,
 * `createHttpLink({ uri })`, apollo-angular's `httpLink.create({ uri })`,
 * urql's `createClient({ url })`. The first one in the repository's files, in
 * path order, so two runs agree.
 */
export const clientEndpointIn = (sources: readonly SourceFile[]): TsNode | undefined => {
  for (const sourceFile of [...sources].sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : 1))) {
    let found: TsNode | undefined;
    sourceFile.forEachDescendant((node, traversal) => {
      if (!Node.isNewExpression(node) && !Node.isCallExpression(node)) return;
      const callee = node.getExpression().getText().replace(/^.*\./, '');
      const options = node.getArguments()[0];
      if (options === undefined || !Node.isObjectLiteralExpression(options)) return;
      const key = ['ApolloClient', 'HttpLink', 'createHttpLink', 'create', 'BatchHttpLink'].includes(callee) ? 'uri' : callee === 'createClient' ? 'url' : undefined;
      const value = key === undefined ? undefined : property(options, key);
      if (value === undefined) return;
      found = value;
      traversal.stop();
    });
    if (found !== undefined) return found;
  }
  return undefined;
};
