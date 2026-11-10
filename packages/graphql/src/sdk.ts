import type { CallExpression, Node as TsNode, ObjectLiteralExpression, Project } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { codegenDocument } from './codegen.js';
import { documentOf, type DocumentReading } from './documents.js';

/**
 * A call through an SDK GraphQL Code Generator writes (P281).
 *
 * The `typescript-generic-sdk` plugin writes `getSdk(requester)`, answering
 * an object with one method per operation of the documents it is given -
 * `sdk.signIn(variables, options)` calls `requester(SignInDocument, variables,
 * options)` - and `typescript-graphql-request` writes the same `getSdk`
 * handed a `GraphQLClient`, each method sending its document with
 * `client.request`. A call of a method is then the operation of that name,
 * sent where the requester sends:
 *
 * - **The SDK** is followed from the receiver of the call to the `getSdk(...)`
 *   that made it: through names, casts, imports, a class's field, and
 *   functions of the repository that answer it (`export const sdk =
 *   getSdk(requester)`, `getClient().signIn(...)`).
 * - **The operation** is the document the method sends, read from the
 *   generated module where it is committed; where it is not, the operation
 *   of the method's name among the documents the codegen configuration lists
 *   (P275), the plugins naming each method after its operation.
 * - **Where it goes** is where the requester sends: a `GraphQLClient` the
 *   SDK is handed is made with its address; a function of the repository is
 *   followed through the functions it calls to the `fetch`, graphql-request
 *   call or `axios.post` that sends, and that call's address is the
 *   operation's. One that sends nowhere this could read, or to more than one
 *   address, is said at the call.
 */
export interface SdkCall {
  /** The expression the document is, where the generated module is committed. */
  readonly document: TsNode | undefined;
  /** The operation read, committed or from the codegen documents. */
  readonly reading: DocumentReading;
  /** The address the requester sends to. */
  readonly endpoint?: TsNode;
  /** Why the address could not be read. */
  readonly endpointUnread?: string;
}

/** How far an SDK is followed back through names and functions, and a requester through the functions it calls. */
const DEPTH = 8;
const REQUESTER_DEPTH = 4;

/** The name both plugins give the function that makes the SDK. */
const FACTORY = 'getSdk';

/** A cast, parentheses or `!` round an expression, taken off. */
const bare = (node: TsNode | undefined): TsNode | undefined => {
  let value = node;
  while (value !== undefined && (Node.isAsExpression(value) || Node.isSatisfiesExpression(value) || Node.isParenthesizedExpression(value) || Node.isNonNullExpression(value) || Node.isTypeAssertion(value))) value = value.getExpression();
  return value;
};

const isRepositoryCode = (node: TsNode): boolean => !node.getSourceFile().isInNodeModules() && !node.getSourceFile().isDeclarationFile();

/** The function a name stands for, where the repository declares it: a declaration, or a `const` holding an arrow or a function. */
const functionNamed = (name: TsNode): TsNode | undefined => {
  const value = bare(name);
  if (value === undefined) return undefined;
  if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) return value;
  if (!Node.isIdentifier(value)) return undefined;
  const symbol = value.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (!isRepositoryCode(declaration)) return undefined;
    if (Node.isFunctionDeclaration(declaration)) return declaration;
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = bare(declaration.getInitializer());
      if (initializer !== undefined && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) return initializer;
    }
  }
  return undefined;
};

/** What a function answers: its expression body, or each expression it returns in its own body. */
const answered = (fn: TsNode): TsNode[] => {
  const body = (fn as { getBody?: () => TsNode | undefined }).getBody?.();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [body];
  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => statement.getFirstAncestor((node) => Node.isFunctionLikeDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) === fn)
    .flatMap((statement) => {
      const expression = statement.getExpression();
      return expression === undefined ? [] : [expression];
    });
};

/** Where `getSdk` comes from: the function written in the repository, or a module codegen writes and nobody committed. */
type Factory =
  | { readonly kind: 'committed'; readonly fn: TsNode }
  | { readonly kind: 'generated'; readonly specifier: string; readonly importingFile: string };

const factoryOf = (callee: TsNode): Factory | undefined => {
  const value = bare(callee);
  if (value === undefined || !Node.isIdentifier(value)) return undefined;
  const symbol = value.getSymbol();
  for (const declaration of symbol?.getDeclarations() ?? []) {
    if (!Node.isImportSpecifier(declaration)) continue;
    if (declaration.getName() !== FACTORY) return undefined;
    const holder = declaration.getImportDeclaration();
    const committed = functionNamed(value);
    if (committed !== undefined) return { kind: 'committed', fn: committed };
    // A module codegen writes at install, which the repository does not commit.
    if (holder.getModuleSpecifierSourceFile() === undefined || holder.getModuleSpecifierSourceFile()?.isDeclarationFile() === true) {
      return { kind: 'generated', specifier: holder.getModuleSpecifierValue(), importingFile: value.getSourceFile().getFilePath() };
    }
    return undefined;
  }
  if (value.getText() !== FACTORY) return undefined;
  const local = functionNamed(value);
  return local === undefined ? undefined : { kind: 'committed', fn: local };
};

/** The `getSdk(...)` call an SDK value was made by, followed back from where it is used. */
const madeBy = (receiver: TsNode | undefined, depth: number, seen: Set<TsNode>): { call: CallExpression; factory: Factory } | undefined => {
  const value = bare(receiver);
  if (value === undefined || depth > DEPTH || seen.has(value)) return undefined;
  seen.add(value);
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    const factory = factoryOf(callee);
    if (factory !== undefined) return { call: value, factory };
    // A function of the repository that answers an SDK: `getClient().signIn(...)`.
    const fn = functionNamed(callee);
    if (fn === undefined) return undefined;
    for (const expression of answered(fn)) {
      const found = madeBy(expression, depth + 1, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (Node.isAwaitExpression(value)) return madeBy(value.getExpression(), depth + 1, seen);
  if (Node.isIdentifier(value)) {
    const symbol = value.getSymbol();
    for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
      if (!Node.isVariableDeclaration(declaration) || !Node.isIdentifier(declaration.getNameNode())) continue;
      const found = madeBy(declaration.getInitializer(), depth + 1, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (Node.isPropertyAccessExpression(value) && value.getExpression().getKind() === SyntaxKind.ThisKeyword) {
    for (const declaration of value.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isPropertyDeclaration(declaration)) {
        const found = madeBy(declaration.getInitializer(), depth + 1, seen);
        if (found !== undefined) return found;
      }
      // `this.sdk = getSdk(...)` in the constructor.
      const owner = declaration.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      for (const constructor of owner?.getConstructors() ?? []) {
        for (const assignment of constructor.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
          const left = assignment.getLeft();
          if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken || !Node.isPropertyAccessExpression(left) || left.getName() !== value.getName() || left.getExpression().getKind() !== SyntaxKind.ThisKeyword) continue;
          const found = madeBy(assignment.getRight(), depth + 1, seen);
          if (found !== undefined) return found;
        }
      }
    }
  }
  return undefined;
};

/** The object of methods a committed `getSdk` answers. */
const methodsObject = (fn: TsNode): ObjectLiteralExpression | undefined => {
  for (const expression of answered(fn)) {
    const value = bare(expression);
    if (value !== undefined && Node.isObjectLiteralExpression(value)) return value;
  }
  return undefined;
};

/** The body of the member of that name, written as a method, an arrow or a function. */
const memberBody = (object: ObjectLiteralExpression, name: string): TsNode | undefined => {
  const member = object.getProperty(name);
  if (member === undefined) return undefined;
  if (Node.isMethodDeclaration(member)) return member;
  if (Node.isPropertyAssignment(member)) {
    const value = bare(member.getInitializer());
    if (value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value))) return value;
  }
  return undefined;
};

/** The document a generated method sends: an argument of a call in it, or the `document` it hands one. */
const sentDocument = (method: TsNode): TsNode | undefined => {
  const candidates: TsNode[] = [];
  for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) candidates.push(...call.getArguments());
  for (const property of method.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (['document', 'query'].includes(property.getName())) {
      const initializer = property.getInitializer();
      if (initializer !== undefined) candidates.push(initializer);
    }
  }
  const read = candidates.find((candidate) => documentOf(candidate).kind === 'read');
  if (read !== undefined) return read;
  // A `…Document` this could not read is still the one it sends: its reason is the row.
  return candidates.find((candidate) => /Document$/.test(bare(candidate)?.getText() ?? ''));
};

/** The operation a method of the SDK sends. */
const operationOf = (factory: Factory, method: string, project: Project): { document: TsNode | undefined; reading: DocumentReading } => {
  if (factory.kind === 'committed') {
    const object = methodsObject(factory.fn);
    const body = object === undefined ? undefined : memberBody(object, method);
    if (body === undefined) return { document: undefined, reading: { kind: 'dynamic', why: `${method} is not a method the ${FACTORY} of the generated module writes` } };
    const document = sentDocument(body);
    return { document, reading: document === undefined ? { kind: 'dynamic', why: `the method ${method} of ${FACTORY} sends no document this could find` } : documentOf(document) };
  }
  const generated = codegenDocument(project, factory.importingFile, factory.specifier, `${method}Document`);
  return { document: undefined, reading: generated ?? { kind: 'dynamic', why: `${FACTORY} is imported from ${factory.specifier}, which is not committed and is not a module the codegen configuration generates` } };
};

/** The address a `new GraphQLClient(url)` an expression stands for is made with. */
const graphqlClientAddress = (node: TsNode | undefined, depth = 0): TsNode | undefined => {
  const value = bare(node);
  if (value === undefined || depth > DEPTH) return undefined;
  if (Node.isNewExpression(value)) return value.getExpression().getText().replace(/^.*\./, '') === 'GraphQLClient' ? value.getArguments()[0] : undefined;
  if (Node.isIdentifier(value)) {
    const symbol = value.getSymbol();
    for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
      if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration)) {
        const found = graphqlClientAddress(declaration.getInitializer(), depth + 1);
        if (found !== undefined) return found;
      }
    }
  }
  if (Node.isPropertyAccessExpression(value) && value.getExpression().getKind() === SyntaxKind.ThisKeyword) {
    for (const declaration of value.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isPropertyDeclaration(declaration)) {
        const found = graphqlClientAddress(declaration.getInitializer(), depth + 1);
        if (found !== undefined) return found;
      }
    }
  }
  return undefined;
};

/** The module a callee is imported from, when it is. */
const moduleOf = (callee: TsNode): string | undefined => {
  if (!Node.isIdentifier(callee)) return undefined;
  for (const declaration of callee.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isImportSpecifier(declaration)) return declaration.getImportDeclaration().getModuleSpecifierValue();
    if (Node.isImportClause(declaration)) {
      const holder = declaration.getParent();
      if (Node.isImportDeclaration(holder)) return holder.getModuleSpecifierValue();
    }
  }
  return undefined;
};

const FETCH_MODULES = new Set([undefined, 'node-fetch', 'cross-fetch', 'undici', 'isomorphic-fetch']);

/** The address a call that sends a request names, where it is one: `fetch(url)`, graphql-request's `request(url, …)`, `client.request(…)`, `axios.post(url, …)`. */
const sentTo = (call: CallExpression): TsNode | undefined => {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) {
    const name = callee.getText();
    const module = moduleOf(callee);
    if (name === 'fetch' && FETCH_MODULES.has(module)) return call.getArguments()[0];
    if (module === 'graphql-request' && ['request', 'rawRequest'].includes(name)) {
      const [first] = call.getArguments();
      const options = bare(first);
      if (options !== undefined && Node.isObjectLiteralExpression(options)) {
        const url = options.getProperty('url');
        return url !== undefined && Node.isPropertyAssignment(url) ? url.getInitializer() : undefined;
      }
      return first;
    }
    return undefined;
  }
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.getName();
  if (['request', 'rawRequest'].includes(method)) return graphqlClientAddress(callee.getExpression());
  if (method === 'post' && /^axios$/i.test(callee.getExpression().getText())) return call.getArguments()[0];
  return undefined;
};

/** Every address a requester sends to, through the functions of the repository it calls. */
const requesterSends = (fn: TsNode): TsNode[] => {
  const found: TsNode[] = [];
  const seen = new Set<TsNode>();
  const visit = (at: TsNode, depth: number): void => {
    if (seen.has(at) || depth > REQUESTER_DEPTH) return;
    seen.add(at);
    for (const call of at.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const address = sentTo(call);
      if (address !== undefined) {
        found.push(address);
        continue;
      }
      const inner = functionNamed(call.getExpression());
      if (inner !== undefined) visit(inner, depth + 1);
    }
  };
  visit(fn, 0);
  return found;
};

/** Where what the SDK is handed sends its requests. */
const addressOfRequester = (handed: TsNode | undefined): { endpoint?: TsNode; endpointUnread?: string } => {
  if (handed === undefined) return { endpointUnread: `${FACTORY} is handed no requester` };
  const client = graphqlClientAddress(handed);
  if (client !== undefined) return { endpoint: client };
  const fn = functionNamed(handed);
  if (fn === undefined) return { endpointUnread: `the requester ${handed.getText()} handed to ${FACTORY} is not a function or a GraphQLClient this could follow` };
  const sends = requesterSends(fn);
  const texts = [...new Set(sends.map((each) => each.getText()))];
  const [first] = sends;
  if (first === undefined) return { endpointUnread: `the requester ${handed.getText()} handed to ${FACTORY} sends no request this could find` };
  if (texts.length > 1) return { endpointUnread: `the requester ${handed.getText()} handed to ${FACTORY} sends to ${texts.length} addresses: ${texts.join(', ')}` };
  return { endpoint: first };
};

/** Whether any file of a project names the factory: what spares every other repository the walk back from each method call. */
const naming = new WeakMap<Project, boolean>();
const namesFactory = (project: Project): boolean => {
  const known = naming.get(project);
  if (known !== undefined) return known;
  const found = project.getSourceFiles().some((file) => !file.isInNodeModules() && file.getFullText().includes(FACTORY));
  naming.set(project, found);
  return found;
};

/** The operation a call of a method of a codegen SDK sends, and where; undefined where the call is not one. */
export const sdkCallOf = (call: CallExpression): SdkCall | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || !namesFactory(call.getProject())) return undefined;
  const made = madeBy(callee.getExpression(), 0, new Set());
  if (made === undefined) return undefined;
  const operation = operationOf(made.factory, callee.getName(), call.getProject());
  return { ...operation, ...addressOfRequester(made.call.getArguments()[0]) };
};
