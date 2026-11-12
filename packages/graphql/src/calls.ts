import type { CallExpression, ClassDeclaration, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { documentOf, type DocumentReading } from './documents.js';
import { sdkCallOf, writtenInSdk } from './sdk.js';

/**
 * The calls that send a GraphQL operation (P232), in the spellings of the
 * clients a repository uses: Apollo Client's hooks and `client.query`,
 * urql's, graphql-request's `request` and `GraphQLClient#request`,
 * apollo-angular's `this.apollo.query` and its `Query` services, and `fetch`
 * with a body holding `query`, and a method of the SDK GraphQL Code Generator
 * writes (P281). Each is a request to an endpoint, which is what joins it to
 * a service; the document is what joins it to the fields.
 */
export type GraphqlLibrary = 'apollo' | 'urql' | 'graphql-request' | 'apollo-angular' | 'fetch' | 'codegen-sdk';

export interface GraphqlCall {
  readonly library: GraphqlLibrary;
  /** The expression the document is. */
  readonly document: TsNode | undefined;
  /** The address the call itself names, where it names one. */
  readonly endpoint?: TsNode;
  /** A subscription goes over a socket. */
  readonly transport?: 'ws';
  /**
   * The client the call is made with, where it says (P266): one it hands
   * itself (`{ client }`, `named`), or the one it is a method of.
   */
  readonly client?: { readonly node: TsNode; readonly named: boolean };
  /**
   * The operation, where it was read without an expression of its own: a
   * method of a codegen SDK whose module is not committed (P281).
   */
  readonly reading?: DocumentReading;
  /** Why the address the call is sent to could not be read, where it is decided away from the call (P281). */
  readonly endpointUnread?: string;
}

/**
 * The packages a server imports `fetch` from, and the names each exports it
 * under (P279): `import fetch from 'node-fetch'` sends what the platform's does.
 */
const FETCH_MODULES: ReadonlyMap<string, readonly string[]> = new Map([
  ['node-fetch', ['default', 'fetch']],
  ['cross-fetch', ['default', 'fetch']],
  ['isomorphic-fetch', ['default']],
  ['isomorphic-unfetch', ['default']],
  ['undici', ['fetch']],
  ['@whatwg-node/fetch', ['fetch']],
]);

const APOLLO_HOOKS =new Set(['useQuery', 'useLazyQuery', 'useSuspenseQuery', 'useBackgroundQuery', 'useMutation', 'useSubscription', 'useReadQuery']);
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

/**
 * The object literals a hook's options may be (P266): written in place,
 * through a `const`, or either side of a condition
 * (`ids.length === 0 ? skipToken : { client }`).
 */
const optionObjects = (node: TsNode | undefined, depth = 0): ObjectLiteralExpression[] => {
  if (node === undefined || depth > 4) return [];
  if (Node.isObjectLiteralExpression(node)) return [node];
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node)) return optionObjects(node.getExpression(), depth + 1);
  if (Node.isConditionalExpression(node)) return [...optionObjects(node.getWhenTrue(), depth + 1), ...optionObjects(node.getWhenFalse(), depth + 1)];
  if (Node.isIdentifier(node)) {
    for (const declaration of node.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isVariableDeclaration(declaration)) return optionObjects(declaration.getInitializer(), depth + 1);
    }
  }
  return [];
};

/** Whether an expression is a document this can read: what tells `client.query(doc)` from `db.query(sql)`. */
const isReadDocument = (expression: TsNode | undefined): boolean => expression !== undefined && documentOf(expression).kind === 'read';

/** The options only Apollo Client's `query` takes beside its document. */
const APOLLO_QUERY_OPTIONS = ['variables', 'fetchPolicy', 'errorPolicy', 'context'];

/**
 * Whether a call is Apollo Client's by the options it is handed, whatever its
 * document (P279): `client.mutate({ mutation })`, `client.watchQuery({ query })`
 * and `client.query({ query, variables })` name keys no other client's call
 * does. Such a call whose document is built at run time is still a GraphQL
 * request, to its client's endpoint, with a row saying its fields are unread -
 * rather than nothing at all.
 */
const apolloShaped = (method: string, options: ObjectLiteralExpression): boolean => {
  if (method === 'mutate') return options.getProperty('mutation') !== undefined;
  if (options.getProperty('query') === undefined) return false;
  return method === 'watchQuery' || (method === 'query' && APOLLO_QUERY_OPTIONS.some((key) => options.getProperty(key) !== undefined));
};

/** The address a `new GraphQLClient(url)` the receiver was made by names. */
const constructedWith = (receiver: TsNode, className: string): TsNode | undefined => {
  if (!Node.isIdentifier(receiver) && !Node.isPropertyAccessExpression(receiver)) return undefined;
  for (const declaration of receiver.getSymbol()?.getDeclarations() ?? []) {
    const value = Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (value !== undefined && Node.isNewExpression(value) && value.getExpression().getText().replace(/^.*\./, '') === className) return value.getArguments()[0];
  }
  return undefined;
};

/**
 * What a call sends, when it sends a GraphQL operation.
 *
 * A method whose name alone does not say GraphQL (`client.mutation(doc)`,
 * `client.query(doc)`) is one where its document is read; `handed` lets a
 * reader take one whose document is a value it will read elsewhere - the
 * parameter of a helper, read at each of its callers (P275).
 */
export const graphqlCallOf = (call: CallExpression, handed?: (expression: TsNode) => boolean): GraphqlCall | undefined => {
  const found = graphqlCallIn(call, handed);
  // A send written in a method of a codegen SDK is drawn at each call of that method (P285).
  return found === undefined || writtenInSdk(call) ? undefined : found;
};

const graphqlCallIn = (call: CallExpression, handed?: (expression: TsNode) => boolean): GraphqlCall | undefined => {
  const isDocument = (expression: TsNode | undefined): boolean => isReadDocument(expression) || (expression !== undefined && handed?.(expression) === true);
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) {
    const imported = importOf(callee);
    // A hook imported under another name is the hook it exports: `useQuery as useApollo`.
    const name = imported?.exported ?? callee.getText();
    const module = imported?.module;
    if (module === undefined ? name === 'fetch' : FETCH_MODULES.get(module)?.includes(name) === true) {
      // One whose document is written as an operation but could not be read is
      // still a GraphQL request: its reader says why the fields are unread (P279).
      const query = fetchedQuery(call);
      const document = isReadDocument(query) || looksLikeOperation(query) ? query : undefined;
      return document === undefined ? undefined : { library: 'fetch', document, ...(call.getArguments()[0] === undefined ? {} : { endpoint: call.getArguments()[0] as TsNode }) };
    }
    if (module === undefined) return undefined;
    if (APOLLO_HOOKS.has(name) && module.startsWith('@apollo/client')) {
      const client = optionObjects(call.getArguments()[1]).map((options) => property(options, 'client')).find((found) => found !== undefined);
      return { library: 'apollo', document: call.getArguments()[0], ...(name === 'useSubscription' ? { transport: 'ws' as const } : {}), ...(client === undefined ? {} : { client: { node: client, named: true } }) };
    }
    if (URQL_HOOKS.has(name) && (module === 'urql' || module.startsWith('@urql/'))) {
      const options = objectAt(call, 0);
      const document = options === undefined ? call.getArguments()[0] : property(options, 'query');
      return { library: 'urql', document, ...(name === 'useSubscription' ? { transport: 'ws' as const } : {}) };
    }
    // urql's `createRequest(doc, variables)`, which a helper hands `client.executeQuery` (P275).
    if (name === 'createRequest' && (module === 'urql' || module.startsWith('@urql/'))) return { library: 'urql', document: call.getArguments()[0] };
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
  const made = angular ? {} : { client: { node: receiver, named: false } };
  if (options !== undefined && ['query', 'watchQuery', 'subscribe'].includes(method) && (isDocument(property(options, 'query')) || apolloShaped(method, options))) {
    return { library: angular ? 'apollo-angular' : 'apollo', document: property(options, 'query'), ...(method === 'subscribe' ? { transport: 'ws' as const } : {}), ...made };
  }
  if (options !== undefined && method === 'mutate' && (isDocument(property(options, 'mutation')) || apolloShaped(method, options))) {
    return { library: angular ? 'apollo-angular' : 'apollo', document: property(options, 'mutation'), ...made };
  }
  const first = call.getArguments()[0];
  if (['query', 'mutation', 'subscription'].includes(method) && isDocument(first)) {
    return { library: 'urql', document: first, ...(method === 'subscription' ? { transport: 'ws' as const } : {}) };
  }
  if (method === 'request' && isDocument(first)) {
    const endpoint = constructedWith(receiver, 'GraphQLClient');
    return { library: 'graphql-request', document: first, ...(endpoint === undefined ? {} : { endpoint }) };
  }
  // A method of the SDK codegen writes: `sdk.signIn(variables)` (P281).
  const sdk = sdkCallOf(call);
  if (sdk === undefined) return undefined;
  return {
    library: 'codegen-sdk',
    document: sdk.document,
    reading: sdk.reading,
    ...(sdk.endpoint === undefined ? {} : { endpoint: sdk.endpoint }),
    ...(sdk.endpointUnread === undefined ? {} : { endpointUnread: sdk.endpointUnread }),
  };
};

/**
 * What a `fetch` sends as `query`, where its body is `JSON.stringify({ query })`:
 * a document or not. The object is written in place or held in a `const`
 * (`const body = { query: … }; fetch(url, { body: JSON.stringify(body) })`, P279).
 */
export const fetchedQuery = (call: CallExpression): TsNode | undefined => {
  const init = objectAt(call, 1);
  const body = init === undefined ? undefined : property(init, 'body');
  if (body === undefined || !Node.isCallExpression(body) || body.getExpression().getText() !== 'JSON.stringify') return undefined;
  const [payload] = optionObjects(body.getArguments()[0]);
  return payload === undefined ? undefined : property(payload, 'query');
};

/**
 * Whether what a `fetch` sends as `query` is written as a GraphQL operation
 * (P279): text that opens with `query`, `mutation`, `subscription` or `{`. Such
 * a document this could not read is a GraphQL request whose fields are unread,
 * not some other API's search term.
 */
export const looksLikeOperation = (query: TsNode | undefined): boolean => {
  if (query === undefined) return false;
  const text = Node.isStringLiteral(query) || Node.isNoSubstitutionTemplateLiteral(query) || Node.isTemplateExpression(query) ? query.getText().slice(1) : '';
  return /^\s*(query|mutation|subscription)\b|^\s*\{/.test(text);
};

/** The document a `fetch` sends, where its body is `JSON.stringify({ query })` written in place. */
export const fetchedDocument = (call: CallExpression): TsNode | undefined => {
  const query = fetchedQuery(call);
  return isReadDocument(query) ? query : undefined;
};

/**
 * What a parameter was handed, along the calls a request was followed out
 * through, innermost first (P266): `graphqlRequest('/settings', QUERY)`
 * hands its `query` parameter the document its `fetch` sends. Undefined
 * where a step is not a parameter or the call hands nothing in its place.
 */
export const handedThrough = (value: TsNode, calls: readonly CallExpression[]): TsNode | undefined => {
  let at: TsNode = value;
  for (const call of calls) {
    if (!Node.isIdentifier(at)) return at;
    // `{ query }` names the binding, not the property.
    const holder = at.getParent();
    const symbol = holder !== undefined && Node.isShorthandPropertyAssignment(holder) ? holder.getValueSymbol() : at.getSymbol();
    const declaration = symbol?.getDeclarations()[0];
    if (declaration === undefined || !Node.isParameterDeclaration(declaration)) return at;
    const owner = declaration.getParent();
    const index = (owner as { getParameters?: () => TsNode[] }).getParameters?.().indexOf(declaration) ?? -1;
    const argument = index === -1 ? undefined : call.getArguments()[index];
    if (argument === undefined) return undefined;
    at = argument;
  }
  return at;
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
