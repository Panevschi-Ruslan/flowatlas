import type { ClassDeclaration, Decorator, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { resolveStaticString } from '@flowatlas/core';
import { followed } from './gateway.js';

/**
 * Every GraphQL endpoint a NestJS server serves, and which of its resolvers
 * each one serves (P266).
 *
 * A NestJS application may import `GraphQLModule.forRoot*` more than once:
 * one schema at `/graphql` for the product, another at `/settings` for its
 * configuration, a third at `/admin`. Each is a way in of its own, with its
 * own schema, and the same field name in two of them is two fields. Read for
 * each module:
 *
 * - **Its options**, written in place (`forRoot({...})`), answered by a
 *   factory (`forRootAsync({ useFactory })`, an arrow answering an object, or
 *   a function that returns one, in place or through a `const`), or by a
 *   class (`useClass` / `useExisting`, its `createGqlOptions()`).
 * - **Its path**, `path:` read as a string is read anywhere: a literal, a
 *   template, a constant or an enum member, through a package the services
 *   share; the library's `/graphql` where none is written.
 * - **The resolvers it serves**: those the modules `include:` names provide,
 *   with the modules they import, as the server collects them; and, where
 *   the server tags each resolver with which schema it belongs to - its own
 *   decorator applying `SetMetadata(KEY, 'settings')` beside `Resolver` -
 *   and hands each module the tag it serves as an option, those tagged so.
 * - **Whether its schema is all there is**: a plugin of the repository's own
 *   that answers a request itself (`endResponse` in its `onRequest`,
 *   `setResultAndStopExecution`) or replaces the schema (`setSchema`), or a
 *   `transformSchema` option, answers fields no resolver declares, so a field
 *   the schema lacks is said rather than called unknown.
 *
 * What cannot be read is said, never guessed: a path written as code keeps
 * the library's default with the reason beside it.
 */
export interface ServedEndpoint {
  readonly path: string;
  readonly at?: TsNode;
  /** The resolver classes the modules `include:` names provide, with what they import; every one where it names none. */
  readonly include?: ReadonlySet<ClassDeclaration>;
  /** The tag the module's options name, which the resolvers it serves carry. */
  readonly scope?: string;
  /** Why fields no resolver declares may still be answered here. */
  readonly open?: string;
  /** What of the module could not be read, and why. */
  readonly unread: readonly string[];
}

/** A cast, parentheses or `!` round an expression, taken off. */
const bare = (node: TsNode | undefined): TsNode | undefined => {
  let value = node;
  while (value !== undefined && (Node.isAsExpression(value) || Node.isSatisfiesExpression(value) || Node.isParenthesizedExpression(value) || Node.isNonNullExpression(value) || Node.isTypeAssertion(value))) value = value.getExpression();
  return value;
};

/** The value a key of an object literal holds: written, or a shorthand's binding. */
const valueOf = (object: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const property = object.getProperty(key);
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) {
    for (const declaration of property.getValueSymbol()?.getDeclarations() ?? []) {
      if (Node.isVariableDeclaration(declaration)) return declaration.getInitializer();
    }
    return property.getNameNode();
  }
  if (Node.isMethodDeclaration(property)) return property;
  return undefined;
};

/** A string as a value is read anywhere: a literal, a template, a constant, an enum member. */
const stringValue = (node: TsNode | undefined): string | undefined => {
  const value = bare(node);
  if (value === undefined) return undefined;
  const read = resolveStaticString(value);
  return read === null || read.envRefs.length > 0 || read.value.includes('${') ? undefined : read.value;
};

/** The class a name stands for, through an import. */
const classOf = (node: TsNode | undefined): ClassDeclaration | undefined => {
  const value = bare(node);
  if (value === undefined || !Node.isIdentifier(value)) return undefined;
  const symbol = value.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (Node.isClassDeclaration(declaration)) return declaration;
  }
  return undefined;
};

/** The function a value is: in place, or the declaration a name stands for. */
const functionOf = (node: TsNode | undefined): TsNode | undefined => {
  const value = bare(node);
  if (value === undefined) return undefined;
  if (Node.isArrowFunction(value) || Node.isFunctionExpression(value) || Node.isFunctionDeclaration(value) || Node.isMethodDeclaration(value)) return value;
  if (!Node.isIdentifier(value)) return undefined;
  const symbol = value.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (Node.isFunctionDeclaration(declaration)) return declaration;
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = bare(declaration.getInitializer());
      if (initializer !== undefined && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) return initializer;
    }
  }
  return undefined;
};

/** The object literal a function answers with: its expression body, or what it returns, in place or through a `const`. */
const answeredObject = (fn: TsNode): ObjectLiteralExpression | undefined => {
  const body = (fn as { getBody?: () => TsNode | undefined }).getBody?.();
  if (body === undefined) return undefined;
  const asObject = (node: TsNode | undefined): ObjectLiteralExpression | undefined => {
    const value = bare(followed(bare(node)));
    return value !== undefined && Node.isObjectLiteralExpression(value) ? value : undefined;
  };
  if (!Node.isBlock(body)) return asObject(body);
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    if (statement.getFirstAncestor((node) => Node.isFunctionLikeDeclaration(node) || Node.isArrowFunction(node)) !== fn) continue;
    const found = asObject(statement.getExpression());
    if (found !== undefined) return found;
  }
  return undefined;
};

/** The options a `GraphQLModule.forRoot*` call is handed, or why they could not be read. */
const moduleOptions = (call: TsNode & { getArguments(): TsNode[] }, asynchronous: boolean): { options?: ObjectLiteralExpression; why?: string } => {
  const handed = bare(followed(call.getArguments()[0]));
  if (handed === undefined || !Node.isObjectLiteralExpression(handed)) return { why: 'its options are not an object written here' };
  if (!asynchronous) return { options: handed };
  const factory = valueOf(handed, 'useFactory');
  if (factory !== undefined) {
    const fn = functionOf(factory);
    const options = fn === undefined ? undefined : answeredObject(fn);
    return options === undefined ? { why: 'its useFactory does not answer an object written in it' } : { options };
  }
  const named = classOf(valueOf(handed, 'useClass') ?? valueOf(handed, 'useExisting'));
  if (named !== undefined) {
    const method = named.getMethod('createGqlOptions');
    const options = method === undefined ? undefined : answeredObject(method);
    return options === undefined ? { why: `${named.getName() ?? 'its class'}.createGqlOptions() does not answer an object written in it` } : { options };
  }
  return { why: 'its options are made by something other than useFactory or useClass' };
};

/** The modules a `@Module` imports and the classes it provides. */
interface ModuleReading {
  readonly imports: readonly ClassDeclaration[];
  readonly providers: readonly ClassDeclaration[];
}

/** The classes of a list in a module's metadata: names, `{ useClass }`, `X.forRoot(...)`, `forwardRef(() => X)`, spreads of constants. */
const listedClasses = (node: TsNode | undefined, depth = 0): ClassDeclaration[] => {
  const value = bare(followed(bare(node)));
  if (value === undefined || depth > 6) return [];
  if (Node.isArrayLiteralExpression(value)) {
    return value.getElements().flatMap((element) => (Node.isSpreadElement(element) ? listedClasses(element.getExpression(), depth + 1) : listedClasses(element, depth + 1)));
  }
  if (Node.isObjectLiteralExpression(value)) return listedClasses(valueOf(value, 'useClass') ?? valueOf(value, 'module'), depth + 1);
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    if (Node.isPropertyAccessExpression(callee)) return listedClasses(callee.getExpression(), depth + 1);
    if (callee.getText() === 'forwardRef') {
      const fn = bare(value.getArguments()[0]);
      if (fn !== undefined && Node.isArrowFunction(fn)) return listedClasses(fn.getBody(), depth + 1);
    }
    return [];
  }
  const found = classOf(value);
  return found === undefined ? [] : [found];
};

/** The `@Module` of a class, by the name it is written under. */
const moduleDecorator = (declaration: ClassDeclaration): Decorator | undefined => declaration.getDecorators().find((decorator) => decorator.getName() === 'Module');

/** Every module of the repository, by its class. */
const modulesIn = (sources: readonly SourceFile[]): Map<ClassDeclaration, ModuleReading> => {
  const modules = new Map<ClassDeclaration, ModuleReading>();
  for (const sourceFile of sources) {
    if (!sourceFile.getFullText().includes('@Module')) continue;
    for (const declaration of sourceFile.getClasses()) {
      const decorator = moduleDecorator(declaration);
      if (decorator === undefined) continue;
      const metadata = bare(decorator.getArguments()[0]);
      if (metadata === undefined || !Node.isObjectLiteralExpression(metadata)) continue;
      modules.set(declaration, { imports: listedClasses(valueOf(metadata, 'imports')), providers: listedClasses(valueOf(metadata, 'providers')) });
    }
  }
  return modules;
};

/** The classes a set of modules provides, with every module they import, as the server collects its resolvers. */
const providedUnder = (roots: readonly ClassDeclaration[], modules: ReadonlyMap<ClassDeclaration, ModuleReading>): Set<ClassDeclaration> => {
  const provided = new Set<ClassDeclaration>();
  const seen = new Set<ClassDeclaration>();
  const visit = (module: ClassDeclaration): void => {
    if (seen.has(module)) return;
    seen.add(module);
    const reading = modules.get(module);
    if (reading === undefined) return;
    for (const provider of reading.providers) provided.add(provider);
    for (const imported of reading.imports) visit(imported);
  };
  for (const root of roots) visit(root);
  return provided;
};

/** The `KEY = value` pairs `SetMetadata` writes in a decorator, or in the body of one of the repository's own. */
const metadataSetBy = (decorator: Decorator): string[] => {
  const found: string[] = [];
  const read = (call: TsNode, depth: number): void => {
    if (!Node.isCallExpression(call) || depth > 3) return;
    const callee = call.getExpression();
    if (callee.getText() === 'SetMetadata') {
      const [key, value] = call.getArguments();
      const written = stringValue(value);
      if (written !== undefined && key !== undefined) found.push(written);
      return;
    }
    const fn = functionOf(callee);
    const body = fn === undefined ? undefined : (fn as { getBody?: () => TsNode | undefined }).getBody?.();
    if (body === undefined) return;
    for (const inner of [...(Node.isCallExpression(body) ? [body] : []), ...body.getDescendantsOfKind(SyntaxKind.CallExpression)]) read(inner, depth + 1);
  };
  const call = decorator.getCallExpression();
  if (call !== undefined) read(call, 0);
  return found;
};

/** The values a resolver class is tagged with by `SetMetadata`, directly or through its own decorator. */
export const tagsOfClass = (declaration: ClassDeclaration): string[] => [...new Set(declaration.getDecorators().flatMap(metadataSetBy))].sort();

/** What in a plugin the repository writes makes the server answer without its schema. */
const ANSWERS_ITSELF = /\b(endResponse|setResultAndStopExecution|setSchema)\s*\(/;

/** What a plugin that keeps the answers going out hooks: a cache, which answers nothing the schema did not. */
const KEEPS_ANSWERS = /\bon(Response|ResultProcess|ExecutionResult)\b/;

/** Why the schema a module serves may not be all there is: a plugin of the repository's that answers, or a schema transform. */
const openReason = (options: ObjectLiteralExpression): string | undefined => {
  if (options.getProperty('transformSchema') !== undefined) return 'its options transform the schema at start';
  const plugins = bare(followed(bare(valueOf(options, 'plugins'))));
  const listed = plugins !== undefined && Node.isArrayLiteralExpression(plugins) ? plugins.getElements() : [];
  for (const element of listed) {
    const value = bare(Node.isSpreadElement(element) ? element.getExpression() : element);
    const callee = value !== undefined && Node.isCallExpression(value) ? value.getExpression() : undefined;
    const fn = callee === undefined ? undefined : functionOf(callee);
    if (fn === undefined || fn.getSourceFile().isInNodeModules() || fn.getSourceFile().isDeclarationFile()) continue;
    // A cache answers what the schema answered once, which it keeps as it goes out.
    if (ANSWERS_ITSELF.test(fn.getText()) && !KEEPS_ANSWERS.test(fn.getText())) return `its plugin ${callee?.getText() ?? ''} answers requests itself`;
  }
  return undefined;
};

/** Every endpoint a NestJS server's `GraphQLModule.forRoot*` calls serve, in the order of the files. */
export const nestEndpointsIn = (sources: readonly SourceFile[], tags: ReadonlySet<string>): ServedEndpoint[] => {
  let modules: Map<ClassDeclaration, ModuleReading> | undefined;
  const endpoints: ServedEndpoint[] = [];
  for (const sourceFile of sources) {
    if (!sourceFile.getFullText().includes('GraphQLModule')) continue;
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression().getText();
      const matched = /(?:^|\.)GraphQLModule\.forRoot(Async)?$/.exec(callee);
      if (matched === null) return;
      const unread: string[] = [];
      const reading = moduleOptions(node, matched[1] !== undefined);
      if (reading.why !== undefined) unread.push(reading.why);
      const options = reading.options;
      let path = '/graphql';
      const written = options === undefined ? undefined : valueOf(options, 'path');
      if (written !== undefined) {
        const value = stringValue(written);
        if (value === undefined) unread.push(`its path ${written.getText()} is not a string this could read`);
        else path = value.startsWith('/') ? value : `/${value}`;
      }
      let include: Set<ClassDeclaration> | undefined;
      const included = options === undefined ? undefined : valueOf(options, 'include');
      if (included !== undefined) {
        const named = listedClasses(included);
        modules ??= modulesIn(sources);
        include = providedUnder(named, modules);
        if (named.length === 0) unread.push(`its include ${included.getText()} names no module this could read`);
      }
      let scope: string | undefined;
      for (const property of options?.getProperties() ?? []) {
        if (!Node.isPropertyAssignment(property) || property.getName() === 'path') continue;
        const value = stringValue(property.getInitializer());
        if (value !== undefined && tags.has(value)) scope = value;
      }
      const open = options === undefined ? undefined : openReason(options);
      endpoints.push({ path, at: node, ...(include === undefined ? {} : { include }), ...(scope === undefined ? {} : { scope }), ...(open === undefined ? {} : { open }), unread });
    });
  }
  return endpoints;
};

/**
 * Whether an endpoint serves the resolvers of a class with these tags.
 *
 * A scope the module names decides alone: a server that tags its resolvers
 * filters them by the tag, and its modules' `include` was measured to say
 * nothing more there - a resolver tagged for one schema is served by it from
 * a module only another schema's `include` reaches. Where no scope is named,
 * `include` decides. A resolver of a map, which no class holds, is any
 * endpoint's that filters by neither.
 */
export const serves = (endpoint: ServedEndpoint, resolver: ClassDeclaration | undefined, tags: readonly string[]): boolean => {
  if (endpoint.scope !== undefined) return tags.includes(endpoint.scope);
  if (resolver === undefined) return endpoint.include === undefined;
  return endpoint.include === undefined || endpoint.include.has(resolver);
};
