import type { CallExpression, ClassDeclaration, Decorator, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { posix } from 'node:path';
import { isTestFile, resolveStaticString } from '@flowatlas/core';
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
 *
 * A module made by a function of the repository (P281) -
 * `configureApi(settings => ({ apiPath: …, resolverModule: StoreApiModule }))`
 * called once per API, the function's `forRootAsync` answering its options
 * from what each call hands it, through a function of the repository
 * (`useFactory: () => createOptions(…, getOptions(config))`) - is one
 * endpoint per call, its options read with what that call handed. A path
 * read from a setting the code does not write is the default its
 * declaration documents (`@default 'store-api'`), said beside it.
 */
export interface ServedEndpoint {
  readonly path: string;
  readonly at?: TsNode;
  /** The resolver classes the modules `include:` names provide, with what they import; every one where it names none. */
  readonly include?: ReadonlySet<ClassDeclaration>;
  /** The tag the module's options name, which the resolvers it serves carry. */
  readonly scope?: string;
  /**
   * Where the library gives a resolver tagged with none of the scopes this
   * one: the scopes every endpoint names, and the patch that says so (P275).
   */
  readonly untagged?: { readonly scopes: readonly string[]; readonly from: string };
  /** Why fields no resolver declares may still be answered here. */
  readonly open?: string;
  /** What of the module could not be read, and why. */
  readonly unread: readonly string[];
  /** What was read from a documented default rather than the code, and why it may differ (P281). */
  readonly defaulted?: readonly string[];
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

/**
 * What the parameters of the functions a module's options are read through
 * were handed (P281): each parameter, the expression its call handed it and
 * what that call's own parameters were handed.
 */
type Bindings = ReadonlyMap<TsNode, Valued>;
interface Valued {
  readonly node: TsNode;
  readonly bindings: Bindings;
}

const NONE: Bindings = new Map();

/** How far a value is followed through parameters, names and functions. */
const BOUND_DEPTH = 10;

const parametersOf = (fn: TsNode): TsNode[] => (fn as { getParameters?: () => TsNode[] }).getParameters?.() ?? [];

/** The bindings a call of a function makes: each parameter to what the call hands it, read under the caller's bindings. */
const boundBy = (fn: TsNode, call: TsNode & { getArguments(): TsNode[] }, bindings: Bindings, outer: Bindings): Bindings => {
  const own = new Map<TsNode, Valued>([...outer, ...bindings]);
  parametersOf(fn).forEach((parameter, index) => {
    const argument = call.getArguments()[index];
    if (argument !== undefined) own.set(parameter, { node: argument, bindings });
  });
  return own;
};

/** An expression followed through what its parameters were handed and the constants it names. */
const resolved = (node: TsNode | undefined, bindings: Bindings, depth = 0): Valued | undefined => {
  const value = bare(node);
  if (value === undefined) return undefined;
  if (depth > BOUND_DEPTH) return { node: value, bindings };
  if (Node.isAwaitExpression(value)) return resolved(value.getExpression(), bindings, depth + 1);
  if (!Node.isIdentifier(value)) return { node: value, bindings };
  const symbol = value.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    const bound = bindings.get(declaration);
    if (bound !== undefined) return resolved(bound.node, bound.bindings, depth + 1);
    if (Node.isVariableDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode()) && declaration.getInitializer() !== undefined) {
      return resolved(declaration.getInitializer(), bindings, depth + 1);
    }
  }
  return { node: value, bindings };
};

/** Every expression a function answers: its expression body, or what each of its own `return`s hands back. */
const answers = (fn: TsNode): TsNode[] => {
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

/** The function a value is, with the bindings it was written under. */
const functionIn = (node: TsNode | undefined, bindings: Bindings): Valued | undefined => {
  const value = resolved(node, bindings);
  if (value === undefined) return undefined;
  const fn = functionOf(value.node);
  if (fn === undefined || fn.getSourceFile().isInNodeModules() || fn.getSourceFile().isDeclarationFile()) return undefined;
  return { node: fn, bindings: value.bindings };
};

/**
 * The object literal an expression is, or a function it calls answers: written
 * in place, through a name, a parameter or `await`, or the object a function
 * of the repository - or one handed in - answers when called with what the
 * call hands it.
 */
const objectIn = (node: TsNode | undefined, bindings: Bindings, depth = 0): { object: ObjectLiteralExpression; bindings: Bindings } | undefined => {
  if (depth > BOUND_DEPTH) return undefined;
  const value = resolved(node, bindings);
  if (value === undefined) return undefined;
  if (Node.isObjectLiteralExpression(value.node)) return { object: value.node, bindings: value.bindings };
  if (Node.isPropertyAccessExpression(value.node)) {
    const member = memberIn(value.node, value.bindings, depth + 1);
    return member === undefined ? undefined : objectIn(member.node, member.bindings, depth + 1);
  }
  if (!Node.isCallExpression(value.node)) return undefined;
  const fn = functionIn(value.node.getExpression(), value.bindings);
  if (fn === undefined) return undefined;
  const inner = boundBy(fn.node, value.node, value.bindings, fn.bindings);
  for (const expression of answers(fn.node)) {
    const found = objectIn(expression, inner, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

/** What a member of an object read with its bindings holds: `options.apiPath`. */
const memberIn = (access: TsNode, bindings: Bindings, depth = 0): Valued | undefined => {
  if (!Node.isPropertyAccessExpression(access)) return undefined;
  const holder = objectIn(access.getExpression(), bindings, depth + 1);
  if (holder === undefined) return undefined;
  const value = valueOf(holder.object, access.getName());
  return value === undefined ? undefined : { node: value, bindings: holder.bindings };
};

/** The default the declaration a member is read from documents: `@default 'store-api'` on the property of a settings type. */
const documentedDefault = (access: TsNode): string | undefined => {
  if (!Node.isPropertyAccessExpression(access)) return undefined;
  for (const declaration of access.getNameNode().getSymbol()?.getDeclarations() ?? []) {
    const docs = (declaration as { getJsDocs?: () => Array<{ getTags(): Array<{ getTagName(): string; getCommentText(): string | undefined }> }> }).getJsDocs?.() ?? [];
    for (const doc of docs) {
      for (const tag of doc.getTags()) {
        if (tag.getTagName() !== 'default') continue;
        const text = (tag.getCommentText() ?? '').trim();
        const quoted = /^(['"`])(.*)\1$/.exec(text);
        if (quoted !== null) return quoted[2];
      }
    }
  }
  return undefined;
};

/** A mock or a story, by its name: `config.service.mock.ts`, `settings.stories.tsx`. */
const NOT_THE_APPLICATION = /\.(?:mocks?|stories)\./;

/**
 * Whether a file a value is written in is the application's own, not a test's
 * or a mock's (P285): asked of its name, and of its directories below the
 * project's tsconfig, never of the path a clone lives at.
 */
const ofTheApplication = (file: SourceFile): boolean => {
  const configFile = file.getProject().getCompilerOptions().configFilePath;
  const path = file.getFilePath();
  const below = typeof configFile === 'string' && path.startsWith(`${posix.dirname(configFile)}/`) ? path.slice(posix.dirname(configFile).length + 1) : file.getBaseName();
  return !isTestFile(below) && !NOT_THE_APPLICATION.test(file.getBaseName());
};

/** A value the repository writes for a setting, and the file it is written in. */
interface WrittenValue {
  readonly value: string;
  readonly file: string;
}

const writtenValues = new WeakMap<TsNode, readonly WrittenValue[]>();

/**
 * The values the repository writes as text for the member a setting is read
 * from (P285): `apiOptions: { storePath: 'shop' }` in an object whose type is
 * the one that declares the member, whatever function hands it on, in the
 * application's own files. What overrides a documented default where the
 * configuration is written, as a literal or a constant.
 */
const writtenFor = (access: TsNode): readonly WrittenValue[] => {
  if (!Node.isPropertyAccessExpression(access)) return [];
  const declarations = access.getNameNode().getSymbol()?.getDeclarations() ?? [];
  const [first] = declarations;
  if (first === undefined) return [];
  const known = writtenValues.get(first);
  if (known !== undefined) return known;
  const name = access.getName();
  const found: WrittenValue[] = [];
  for (const file of access.getProject().getSourceFiles()) {
    if (file.isInNodeModules() || file.isDeclarationFile() || !ofTheApplication(file) || !file.getFullText().includes(name)) continue;
    for (const assignment of file.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      if (assignment.getName() !== name) continue;
      const object = assignment.getParent();
      if (!Node.isObjectLiteralExpression(object)) continue;
      const member = object.getContextualType()?.getProperty(name);
      if (member === undefined || !member.getDeclarations().some((declaration) => declarations.includes(declaration))) continue;
      const value = stringValue(assignment.getInitializer());
      if (value !== undefined) found.push({ value, file: file.getBaseName() });
    }
  }
  writtenValues.set(first, found);
  return found;
};

/** A string read with bindings: a literal or constant, a member of an object handed in, `+` of two, or a member's documented default. */
const stringIn = (node: TsNode | undefined, bindings: Bindings, defaulted: string[], depth = 0): string | undefined => {
  if (depth > BOUND_DEPTH) return undefined;
  const value = resolved(node, bindings);
  if (value === undefined) return undefined;
  const written = stringValue(value.node);
  if (written !== undefined) return written;
  if (Node.isBinaryExpression(value.node) && value.node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    const left = stringIn(value.node.getLeft(), value.bindings, defaulted, depth + 1);
    const right = left === undefined ? undefined : stringIn(value.node.getRight(), value.bindings, defaulted, depth + 1);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  if (Node.isPropertyAccessExpression(value.node)) {
    const member = memberIn(value.node, value.bindings, depth + 1);
    if (member !== undefined) return stringIn(member.node, member.bindings, defaulted, depth + 1);
    const documented = documentedDefault(value.node);
    // A value the repository's configuration writes for it overrides the default (P285).
    const written = writtenFor(value.node);
    const values = [...new Set(written.map((each) => each.value))];
    const [only] = values;
    if (only !== undefined && values.length === 1 && only !== documented) {
      const where = [...new Set(written.map((each) => each.file))].join(', ');
      defaulted.push(`${value.node.getText()} is a setting the code does not write where it is read, read as '${only}', the value ${where} writes for it${documented === undefined ? '' : ` over the default '${documented}' its declaration documents`}`);
      return only;
    }
    if (documented !== undefined) {
      const also = values.length > 1 ? `; the repository writes ${values.length} values for it (${written.map((each) => `'${each.value}' in ${each.file}`).join(', ')}) and which one runs is not read` : '';
      defaulted.push(`${value.node.getText()} is a setting the code does not write, read as '${documented}', the default its declaration documents${also}`);
      return documented;
    }
  }
  return undefined;
};

/** The classes a list read with bindings names: `[options.resolverModule]`, spreads and all. */
const classesIn = (node: TsNode | undefined, bindings: Bindings, depth = 0): ClassDeclaration[] => {
  if (depth > BOUND_DEPTH) return [];
  const value = resolved(node, bindings);
  if (value === undefined) return [];
  if (Node.isArrayLiteralExpression(value.node)) {
    return value.node.getElements().flatMap((element) => classesIn(Node.isSpreadElement(element) ? element.getExpression() : element, value.bindings, depth + 1));
  }
  if (Node.isPropertyAccessExpression(value.node)) {
    const member = memberIn(value.node, value.bindings, depth + 1);
    if (member !== undefined) return classesIn(member.node, member.bindings, depth + 1);
  }
  return listedClasses(value.node);
};

/** The options a `GraphQLModule.forRoot*` call is handed, with what the calls they are read through handed, or why they could not be read. */
const moduleOptions = (
  call: TsNode & { getArguments(): TsNode[] },
  asynchronous: boolean,
  bindings: Bindings,
): { options?: ObjectLiteralExpression; bindings?: Bindings; why?: string } => {
  const read = objectIn(call.getArguments()[0], bindings);
  if (read === undefined) return { why: 'its options are not an object written here' };
  const handed = read.object;
  if (!asynchronous) return { options: handed, bindings: read.bindings };
  const factory = valueOf(handed, 'useFactory');
  if (factory !== undefined) {
    const fn = functionIn(factory, read.bindings);
    let found: { object: ObjectLiteralExpression; bindings: Bindings } | undefined;
    for (const expression of fn === undefined ? [] : answers(fn.node)) {
      found = objectIn(expression, fn?.bindings ?? NONE);
      if (found !== undefined) break;
    }
    return found === undefined ? { why: 'its useFactory does not answer an object written in it' } : { options: found.object, bindings: found.bindings };
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
const metadataSetBy = (decorator: Decorator): Array<{ key?: string; value: string }> => {
  const found: Array<{ key?: string; value: string }> = [];
  const read = (call: TsNode, depth: number): void => {
    if (!Node.isCallExpression(call) || depth > 3) return;
    const callee = call.getExpression();
    if (callee.getText() === 'SetMetadata') {
      const [key, value] = call.getArguments();
      const written = stringValue(value);
      const named = stringValue(key);
      if (written !== undefined && key !== undefined) found.push({ ...(named === undefined ? {} : { key: named }), value: written });
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
export const tagsOfClass = (declaration: ClassDeclaration): string[] => [...new Set(declaration.getDecorators().flatMap(metadataSetBy).map((pair) => pair.value))].sort();

/** The keys a resolver class is tagged under by `SetMetadata`, where they read as strings. */
export const tagKeysOfClass = (declaration: ClassDeclaration): string[] =>
  [...new Set(declaration.getDecorators().flatMap(metadataSetBy).flatMap((pair) => (pair.key === undefined ? [] : [pair.key])))].sort();

/** `Reflect.getMetadata(KEY, target) || 'scope'` on a line a patch adds: the scope a resolver with no tag is given. */
const DEFAULTED = /Reflect\.getMetadata\(\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*,[^)]*\)\s*(?:\|\||\?\?)\s*(['"])([^'"]+)\2/;

/**
 * The scope a patched GraphQL library gives a resolver tagged with none
 * (P275), where a patch the repository commits to it says so plainly: a line
 * it adds reading the tag with `Reflect.getMetadata(KEY, …) || 'scope'`,
 * whose key - written there, or a constant the patch declares - is one the
 * repository's resolvers are tagged under, and whose scope is one of their
 * tags. Patches that disagree say nothing.
 */
export const untaggedScopeIn = (
  patches: ReadonlyArray<{ readonly path: string; readonly text: string }>,
  keys: ReadonlySet<string>,
  tags: ReadonlySet<string>,
): { scope: string; from: string } | undefined => {
  const found = new Map<string, string>();
  for (const patch of patches) {
    const lines = patch.text.split('\n');
    const constant = (name: string): string | undefined => {
      for (const line of lines) {
        if (!line.startsWith('+') && !line.startsWith(' ')) continue;
        const declared = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*(['"])([^'"]+)\\1`).exec(line);
        if (declared !== null) return declared[2];
      }
      return undefined;
    };
    for (const line of lines) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const matched = DEFAULTED.exec(line);
      if (matched === null) continue;
      const written = matched[1] as string;
      const key = /^['"]/.test(written) ? written.slice(1, -1) : constant(written);
      const scope = matched[3] as string;
      if (key !== undefined && keys.has(key) && tags.has(scope) && !found.has(scope)) found.set(scope, patch.path);
    }
  }
  if (found.size !== 1) return undefined;
  const [[scope, from]] = [...found] as [[string, string]];
  return { scope, from };
};

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

/**
 * Where a module is made, and what it is made with (P281): the `forRoot*`
 * call itself, or - where it is written in a function of the repository that
 * takes parameters - each call of that function, with what it hands. A
 * function nothing here calls is read as written.
 */
const madeAt = (forRoot: TsNode): Array<{ at: TsNode; bindings: Bindings }> => {
  const fn = forRoot.getFirstAncestor((node) => Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node));
  if (fn === undefined || parametersOf(fn).length === 0) return [{ at: forRoot, bindings: NONE }];
  const holder = fn.getParent();
  const name = Node.isFunctionDeclaration(fn) ? fn.getNameNode() : holder !== undefined && Node.isVariableDeclaration(holder) ? holder.getNameNode() : undefined;
  if (name === undefined || !Node.isIdentifier(name)) return [{ at: forRoot, bindings: NONE }];
  const calls = name
    .findReferencesAsNodes()
    .map((reference) => reference.getParent())
    .filter((parent): parent is CallExpression => parent !== undefined && Node.isCallExpression(parent) && parent.getExpression().getText() === name.getText())
    .filter((call) => !call.getSourceFile().isInNodeModules() && !call.getSourceFile().isDeclarationFile())
    .sort((a, b) => (a.getSourceFile().getFilePath() === b.getSourceFile().getFilePath() ? a.getStart() - b.getStart() : a.getSourceFile().getFilePath() < b.getSourceFile().getFilePath() ? -1 : 1));
  if (calls.length === 0) return [{ at: forRoot, bindings: NONE }];
  return calls.map((call) => ({ at: call, bindings: boundBy(fn, call, NONE, NONE) }));
};

/** Every endpoint a NestJS server's `GraphQLModule.forRoot*` calls serve, in the order of the files. */
export const nestEndpointsIn = (sources: readonly SourceFile[], tags: ReadonlySet<string>, untagged?: { readonly scope: string; readonly from: string }): ServedEndpoint[] => {
  let modules: Map<ClassDeclaration, ModuleReading> | undefined;
  const endpoints: ServedEndpoint[] = [];
  for (const sourceFile of sources) {
    if (!sourceFile.getFullText().includes('GraphQLModule')) continue;
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression().getText();
      const matched = /(?:^|\.)GraphQLModule\.forRoot(Async)?$/.exec(callee);
      if (matched === null) return;
      for (const made of madeAt(node)) {
        const unread: string[] = [];
        const defaulted: string[] = [];
        const reading = moduleOptions(node, matched[1] !== undefined, made.bindings);
        if (reading.why !== undefined) unread.push(reading.why);
        const options = reading.options;
        const bound = reading.bindings ?? NONE;
        let path = '/graphql';
        const written = options === undefined ? undefined : valueOf(options, 'path');
        if (written !== undefined) {
          const value = stringIn(written, bound, defaulted);
          if (value === undefined) unread.push(`its path ${written.getText()} is not a string this could read`);
          else path = value.startsWith('/') ? value : `/${value}`;
        }
        let include: Set<ClassDeclaration> | undefined;
        const included = options === undefined ? undefined : valueOf(options, 'include');
        if (included !== undefined) {
          const named = classesIn(included, bound);
          modules ??= modulesIn(sources);
          include = providedUnder(named, modules);
          if (named.length === 0) unread.push(`its include ${included.getText()} names no module this could read`);
        }
        let scope: string | undefined;
        for (const property of options?.getProperties() ?? []) {
          if (!Node.isPropertyAssignment(property) || property.getName() === 'path') continue;
          const value = stringIn(property.getInitializer(), bound, []);
          if (value !== undefined && tags.has(value)) scope = value;
        }
        const open = options === undefined ? undefined : openReason(options);
        endpoints.push({
          path,
          at: made.at,
          ...(include === undefined ? {} : { include }),
          ...(scope === undefined ? {} : { scope }),
          ...(open === undefined ? {} : { open }),
          unread,
          ...(defaulted.length === 0 ? {} : { defaulted }),
        });
      }
    });
  }
  if (untagged === undefined) return endpoints;
  // The endpoint whose scope the library gives a resolver with none serves those too.
  const scopes = [...new Set(endpoints.flatMap((endpoint) => (endpoint.scope === undefined ? [] : [endpoint.scope])))].sort();
  return endpoints.map((endpoint) => (endpoint.scope === untagged.scope ? { ...endpoint, untagged: { scopes, from: untagged.from } } : endpoint));
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
  if (endpoint.scope !== undefined) return tags.includes(endpoint.scope) || (endpoint.untagged !== undefined && !tags.some((tag) => endpoint.untagged?.scopes.includes(tag)));
  if (resolver === undefined) return endpoint.include === undefined;
  return endpoint.include === undefined || endpoint.include.has(resolver);
};
