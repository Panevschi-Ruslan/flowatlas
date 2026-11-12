import type { Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { isTestName } from '@flowatlas/core';
import { clientEndpointIn, type GraphqlCall } from './calls.js';
import { followed } from './gateway.js';

/**
 * Which client a GraphQL operation is sent with, and the address that client
 * is made with (P266).
 *
 * An application with more than one endpoint makes more than one client: one
 * the whole page is wrapped in (`<ApolloProvider client={…}>`), and others a
 * call names for itself (`useMutation(DOC, { client: adminClient })`,
 * `adminClient.query(…)`). Taking the first client in the repository's files
 * for every call sent each operation to whichever endpoint sorted first. So a
 * call's client is followed to where it is made:
 *
 * - `new ApolloClient({ uri })`, or `{ link }` holding an `HttpLink`,
 *   `createHttpLink` or `BatchHttpLink` made with one;
 * - a function of the repository called with `{ uri }` - a factory handed
 *   the address - or, called without one, the `uri` written in its body that
 *   the options it is handed are spread over: the factory's default;
 * - a hook answering `useContext(SomeClientContext)`: the value its
 *   `<SomeClientContext.Provider value={…}>` hands down, followed the same way;
 * - Apollo's `useApolloClient()`: the client the page is wrapped in.
 *
 * The page's client is the one `<ApolloProvider client>` is handed, where
 * every provider hands one address; the first client made in the files
 * where none does, as before. A client a call names and nothing here follows
 * is said (`graphql-client-unread`), never sent to the page's.
 */
export type ClientAddress =
  | { readonly kind: 'address'; readonly node: TsNode }
  | { readonly kind: 'default' }
  | { readonly kind: 'unread'; readonly why: string };

/** How far a client is followed through names, hooks and providers. */
const DEPTH = 8;

const LINKS = new Set(['HttpLink', 'createHttpLink', 'BatchHttpLink', 'createUploadLink', 'UploadHttpLink']);

/** A cast or parentheses round an expression, taken off. */
const bare = (node: TsNode | undefined): TsNode | undefined => {
  let value = node;
  while (value !== undefined && (Node.isAsExpression(value) || Node.isSatisfiesExpression(value) || Node.isParenthesizedExpression(value) || Node.isNonNullExpression(value))) value = value.getExpression();
  return value;
};

const propertyOf = (object: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const found = object.getProperty(key);
  if (found === undefined) return undefined;
  if (Node.isPropertyAssignment(found)) return found.getInitializer();
  if (Node.isShorthandPropertyAssignment(found)) {
    for (const declaration of found.getValueSymbol()?.getDeclarations() ?? []) if (Node.isVariableDeclaration(declaration)) return declaration.getInitializer();
    return found.getNameNode();
  }
  return undefined;
};

/** The object literal an expression is, through a name. */
const objectOf = (node: TsNode | undefined): ObjectLiteralExpression | undefined => {
  const value = bare(followed(bare(node)));
  return value !== undefined && Node.isObjectLiteralExpression(value) ? value : undefined;
};

/** The address an HTTP link inside a client's `link` is made with. */
const linkAddress = (link: TsNode | undefined, depth: number): TsNode | undefined => {
  const value = bare(followed(bare(link)));
  if (value === undefined || depth > DEPTH) return undefined;
  const made: TsNode[] = [value, ...value.getDescendants()];
  for (const node of made) {
    if (Node.isNewExpression(node) || Node.isCallExpression(node)) {
      const name = node.getExpression().getText().replace(/^.*\./, '');
      if (LINKS.has(name)) {
        const options = objectOf(node.getArguments()[0]);
        const uri = options === undefined ? undefined : propertyOf(options, 'uri');
        if (uri !== undefined) return uri;
      }
      // A link named in a list (`from([auth, http])`): followed once.
      if (node !== value) continue;
    }
    if (Node.isIdentifier(node) && node !== value) {
      const inner = bare(followed(node));
      if (inner !== undefined && inner !== node && (Node.isNewExpression(inner) || Node.isCallExpression(inner))) {
        const found = linkAddress(inner, depth + 1);
        if (found !== undefined) return found;
      }
    }
  }
  return undefined;
};

/** The function a callee names, where the repository declares it. */
const declaredFunction = (callee: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(callee)) return undefined;
  const symbol = callee.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (declaration.getSourceFile().isInNodeModules() || declaration.getSourceFile().isDeclarationFile()) return undefined;
    if (Node.isFunctionDeclaration(declaration)) return declaration;
    if (Node.isVariableDeclaration(declaration)) {
      const value = bare(declaration.getInitializer());
      if (value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value))) return value;
    }
  }
  return undefined;
};

/** The module a callee is imported from, when it is. */
const importedFrom = (callee: TsNode): { module: string; name: string } | undefined => {
  if (!Node.isIdentifier(callee)) return undefined;
  for (const declaration of callee.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isImportSpecifier(declaration)) return { module: declaration.getImportDeclaration().getModuleSpecifierValue(), name: declaration.getName() };
  }
  return undefined;
};

const isApollo = (module: string): boolean => module.startsWith('@apollo/client');

/**
 * Whether a file only stages the application: a test, a story, a mock. A
 * provider there hands a stand-in client the application never makes.
 */
const staging = (sourceFile: SourceFile): boolean => {
  const path = sourceFile.getFilePath();
  return isTestName(sourceFile.getBaseName()) || /\.stories\.[cm]?[jt]sx?$/.test(path) || /\/(__stories__|__tests__|__mocks__|stories|testing)\//.test(path);
};

/** The values handed down by `<Context.Provider value={…}>` for a context, across the files. */
const providedValues = (context: TsNode, sources: readonly SourceFile[]): TsNode[] => {
  const symbol = context.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  if (target === undefined) return [];
  const name = context.getText();
  const values: TsNode[] = [];
  for (const sourceFile of sources) {
    if (staging(sourceFile) || !sourceFile.getFullText().includes('.Provider')) continue;
    for (const opening of [...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement), ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]) {
      const tag = opening.getTagNameNode();
      if (!Node.isPropertyAccessExpression(tag) || tag.getName() !== 'Provider') continue;
      const holder = tag.getExpression();
      const held = holder.getSymbol();
      if ((held?.getAliasedSymbol() ?? held) !== target && holder.getText() !== name) continue;
      const attribute = opening.getAttribute('value');
      if (attribute === undefined || !Node.isJsxAttribute(attribute)) continue;
      const initializer = attribute.getInitializer();
      if (initializer !== undefined && Node.isJsxExpression(initializer)) {
        const expression = initializer.getExpression();
        if (expression !== undefined) values.push(expression);
      }
    }
  }
  return values;
};

/** One answer of several, where they agree: one address, or the page's client. */
const agreeing = (answers: readonly ClientAddress[], what: string): ClientAddress => {
  const [first] = answers;
  if (first === undefined) return { kind: 'unread', why: `no ${what} hands a client` };
  const texts = new Set(answers.map((answer) => (answer.kind === 'address' ? answer.node.getText() : answer.kind)));
  if (texts.size === 1 && first.kind !== 'unread') return first;
  const unread = answers.find((answer): answer is Extract<ClientAddress, { kind: 'unread' }> => answer.kind === 'unread');
  return unread ?? { kind: 'unread', why: `the ${what}s hand clients made with different addresses` };
};

/** The address the client an expression stands for is made with. */
export const clientAddressOf = (client: TsNode, sources: readonly SourceFile[], depth = 0): ClientAddress => {
  if (depth > DEPTH) return { kind: 'unread', why: `${client.getText()} is followed through too many steps` };
  const value = bare(client);
  if (value === undefined) return { kind: 'unread', why: 'no client is handed' };
  if (Node.isIdentifier(value)) {
    // `{ client }` names the binding, not the property.
    const holder = value.getParent();
    const symbol = holder !== undefined && Node.isShorthandPropertyAssignment(holder) ? holder.getValueSymbol() : value.getSymbol();
    for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
      if (Node.isVariableDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined && Node.isIdentifier(declaration.getNameNode())) return clientAddressOf(initializer, sources, depth + 1);
        // `const { client } = useQuery(...)`, `const client = useApolloClient()` destructured: the page's.
        if (initializer !== undefined && Node.isCallExpression(bare(initializer) as TsNode)) {
          const callee = (bare(initializer) as TsNode & { getExpression(): TsNode }).getExpression();
          const imported = importedFrom(callee);
          if (imported !== undefined && isApollo(imported.module)) return { kind: 'default' };
        }
      }
      if (Node.isPropertyDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined) return clientAddressOf(initializer, sources, depth + 1);
      }
    }
    return { kind: 'unread', why: `${value.getText()} is not bound to a client made in the repository` };
  }
  if (Node.isPropertyAccessExpression(value) && value.getExpression().getKind() === SyntaxKind.ThisKeyword) {
    for (const declaration of value.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isPropertyDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined) return clientAddressOf(initializer, sources, depth + 1);
      }
    }
    return { kind: 'unread', why: `${value.getText()} is not given a client where it is declared` };
  }
  if (Node.isNewExpression(value) && value.getExpression().getText().replace(/^.*\./, '') === 'ApolloClient') {
    const options = objectOf(value.getArguments()[0]);
    const uri = options === undefined ? undefined : (propertyOf(options, 'uri') ?? linkAddress(propertyOf(options, 'link'), depth + 1));
    return uri === undefined ? { kind: 'unread', why: 'the client is made with no uri and no HTTP link this could read' } : { kind: 'address', node: uri };
  }
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    const imported = importedFrom(callee);
    if (imported !== undefined && isApollo(imported.module) && imported.name === 'useApolloClient') return { kind: 'default' };
    if (imported !== undefined && imported.module === 'react' && imported.name === 'useContext') {
      const [context] = value.getArguments();
      if (context === undefined) return { kind: 'unread', why: 'useContext is handed no context' };
      return agreeing(providedValues(context, sources).map((provided) => clientAddressOf(provided, sources, depth + 1)), `${context.getText()}.Provider`);
    }
    // `useMemo(() => new ApolloClient(...), [])`: what the function answers.
    if (imported !== undefined && imported.module === 'react' && imported.name === 'useMemo') {
      const [fn] = value.getArguments();
      const body = fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) ? fn.getBody() : undefined;
      if (body !== undefined && !Node.isBlock(body)) return clientAddressOf(body, sources, depth + 1);
    }
    // A method on a client (`factory.getClient()`, `client.withOptions()`) is the receiver's.
    if (Node.isPropertyAccessExpression(callee) && declaredFunction(callee) === undefined) return clientAddressOf(callee.getExpression(), sources, depth + 1);
    const fn = declaredFunction(callee);
    if (fn === undefined) return { kind: 'unread', why: `${callee.getText()}() is not a function of the repository this could follow` };
    // A factory handed the address.
    const handed = value.getArguments().map(objectOf).find((options) => options?.getProperty('uri') !== undefined);
    const uri = handed === undefined ? undefined : propertyOf(handed, 'uri');
    if (uri !== undefined) return { kind: 'address', node: uri };
    const body = (fn as { getBody?: () => TsNode | undefined }).getBody?.();
    if (body === undefined) return { kind: 'unread', why: `${callee.getText()}() has no body to read` };
    // A hook that answers what a context hands down.
    for (const inner of [...(Node.isCallExpression(body) ? [body] : []), ...body.getDescendantsOfKind(SyntaxKind.CallExpression)]) {
      const named = importedFrom(inner.getExpression());
      if (named?.module === 'react' && named.name === 'useContext') return clientAddressOf(inner, sources, depth + 1);
    }
    // The address a factory writes, which the options it is handed are spread over.
    for (const object of body.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const written = propertyOf(object, 'uri');
      if (written !== undefined) return { kind: 'address', node: written };
    }
    for (const made of body.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (made.getExpression().getText().replace(/^.*\./, '') === 'ApolloClient') return clientAddressOf(made, sources, depth + 1);
    }
    return { kind: 'unread', why: `${callee.getText()}() makes no client with an address this could read` };
  }
  return { kind: 'unread', why: `${value.getText().slice(0, 60)} is not a client this could follow` };
};

/**
 * The address of the client the page is wrapped in: what every
 * `<ApolloProvider client={…}>` hands, where they agree; otherwise the first
 * client made in the files, in path order.
 */
export const pageClientIn = (sources: readonly SourceFile[]): TsNode | undefined => {
  const answers: ClientAddress[] = [];
  for (const sourceFile of [...sources].sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : 1))) {
    if (staging(sourceFile) || !sourceFile.getFullText().includes('ApolloProvider')) continue;
    for (const opening of [...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement), ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]) {
      const tag = opening.getTagNameNode();
      const imported = importedFrom(tag);
      if (imported === undefined || !isApollo(imported.module) || imported.name !== 'ApolloProvider') continue;
      const attribute = opening.getAttribute('client');
      if (attribute === undefined || !Node.isJsxAttribute(attribute)) continue;
      const initializer = attribute.getInitializer();
      const expression = initializer !== undefined && Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined;
      if (expression !== undefined) answers.push(clientAddressOf(expression, sources));
    }
  }
  const agreed = answers.length === 0 ? undefined : agreeing(answers, 'ApolloProvider');
  return agreed?.kind === 'address' ? agreed.node : clientEndpointIn(sources);
};

/**
 * Where a call sends its operation: the address it names, the client it
 * names, or the page's client.
 */
export const callAddressOf = (found: GraphqlCall, sources: readonly SourceFile[], pageClient: () => TsNode | undefined): { kind: 'address'; node: TsNode | undefined } | { kind: 'unread'; why: string } => {
  if (found.endpointUnread !== undefined) return { kind: 'unread', why: found.endpointUnread };
  if (found.endpoint !== undefined) return { kind: 'address', node: found.endpoint };
  if (found.client === undefined) return { kind: 'address', node: pageClient() };
  const chosen = clientAddressOf(found.client.node, sources);
  if (chosen.kind === 'address') return chosen;
  if (chosen.kind === 'default') return { kind: 'address', node: pageClient() };
  // A receiver nothing follows was always read as the page's client; a client the call hands itself is said.
  return found.client.named ? chosen : { kind: 'address', node: pageClient() };
};
