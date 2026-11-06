import { readFileSync } from 'node:fs';
import type { ClassDeclaration, Decorator, MethodDeclaration, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { documentOf } from './documents.js';
import { isSupergraph } from './federation.js';
import { readGraphqlGateway, type GatewayReading } from './gateway.js';
import { tryParse, type AppliedDirective, type Document } from './parse.js';
import { fieldFederationOf, mergeSchemas, schemaOf, typeFederationOf, type FieldFederation, type SchemaField, type SchemaSummary, type TypeFederation } from './schema.js';

/**
 * What a GraphQL server declares (P232): every field a resolver answers, the
 * schema, the endpoint, and whether it is one subgraph of several.
 *
 * Three ways a TypeScript server writes its resolvers, read into one shape:
 *
 * - **Decorated classes**: `@Resolver(() => Order)` with `@Query()`,
 *   `@Mutation()`, `@Subscription()` and `@ResolveField()` methods, as
 *   NestJS writes them code-first and schema-first, and type-graphql the
 *   same way (`@FieldResolver()`).
 * - **Resolver maps**: `resolvers: { Query: { orders }, Order: { customer } }`
 *   handed to Apollo Server, graphql-yoga, mercurius or
 *   `makeExecutableSchema`, followed through constants, imports, spreads and
 *   arrays of maps.
 * - **The schema**: SDL in `.graphql` files and `gql` type definitions, and
 *   the classes a code-first server decorates as its types.
 *
 * And whether it is federated (P241): a subgraph, with the federation
 * directives its schema writes and the reference resolvers an entity call
 * runs (`__resolveReference`, `@ResolveReference()`), or a gateway, which
 * resolves nothing and says where its subgraphs are.
 */
export interface ResolvedField {
  readonly type: string;
  readonly field: string;
  readonly root: boolean;
  /** The code that answers it: a method of a class, or a function. */
  readonly handler: { readonly kind: 'method'; readonly method: MethodDeclaration } | { readonly kind: 'function'; readonly fn: TsNode; readonly name: string };
  /** Where it is declared, for the entry's position. */
  readonly at: TsNode;
  /** The type it returns and the arguments it takes, where the code says. */
  readonly returns?: string;
  readonly args?: Readonly<Record<string, { readonly type: string; readonly required: boolean }>>;
  /** The reference resolver an entity call from another subgraph runs (`T.__resolveReference`). */
  readonly reference?: true;
  /** What `@Directive(...)` on a code-first resolver method says of its field (P241). */
  readonly federation?: FieldFederation;
}

/** The name a reference resolver is an entry under, beside the type's fields. */
export const REFERENCE_FIELD = '__resolveReference';

export interface ServerReading {
  readonly fields: readonly ResolvedField[];
  readonly schema: SchemaSummary;
  /** The path the server answers at, and where the server is made, when it is in these files. */
  readonly endpoint: string;
  readonly endpointAt?: TsNode;
  /** One subgraph of a federated graph. */
  readonly federated: boolean;
  /** The federation version it is a subgraph of, when it is one. */
  readonly federation?: 1 | 2;
  /** The gateway these files make, when they make one (P241). */
  readonly gateway?: GatewayReading;
  /** Type definitions that could not be read, and why. */
  readonly unread: ReadonlyArray<{ readonly at: TsNode; readonly why: string }>;
}

const DECORATOR_PACKAGES = ['@nestjs/graphql', 'type-graphql'];
const ROOTS = new Map([
  ['Query', 'Query'],
  ['Mutation', 'Mutation'],
  ['Subscription', 'Subscription'],
]);
const FIELD_DECORATORS = new Set(['ResolveField', 'FieldResolver', 'ResolveProperty', 'ResolveReference']);

/** A decorator of one of the GraphQL packages, by the name it is imported under. */
const graphqlDecorator = (node: { getDecorators(): Decorator[] }, names: ReadonlySet<string> | readonly string[]): Decorator | undefined =>
  graphqlDecorators(node, names)[0];

/** Every decorator of one of the GraphQL packages of these names, in the order written. */
const graphqlDecorators = (node: { getDecorators(): Decorator[] }, names: ReadonlySet<string> | readonly string[]): Decorator[] =>
  node.getDecorators().filter((decorator) => {
    const name = decorator.getName();
    if (!(names instanceof Set ? names.has(name) : (names as readonly string[]).includes(name))) return false;
    const identifier = decorator.getCallExpression()?.getExpression() ?? decorator.getNameNode();
    for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isImportSpecifier(declaration)) return DECORATOR_PACKAGES.includes(declaration.getImportDeclaration().getModuleSpecifierValue());
    }
    // A decorator with no import resolves to nothing: a stub-less fixture, read by name.
    return identifier.getSymbol() === undefined;
  });

/** `() => Order`, `() => [Order]`, `of => Order`, `'Order'`: the type a decorator's first argument names. */
const typeArgument = (argument: TsNode | undefined): { name: string; list: boolean } | undefined => {
  if (argument === undefined) return undefined;
  if (Node.isStringLiteral(argument)) return { name: argument.getLiteralValue(), list: false };
  if (!Node.isArrowFunction(argument) && !Node.isFunctionExpression(argument)) return undefined;
  const body = argument.getBody();
  if (Node.isArrayLiteralExpression(body)) {
    const [inner] = body.getElements();
    return inner === undefined ? undefined : { name: inner.getText(), list: true };
  }
  if (Node.isBlock(body)) return undefined;
  return { name: body.getText(), list: false };
};

/** An options object among a decorator's arguments: `{ name, nullable }`. */
const optionsOf = (decorator: Decorator): ObjectLiteralExpression | undefined =>
  decorator.getArguments().find((argument): argument is ObjectLiteralExpression => Node.isObjectLiteralExpression(argument));

const option = (options: ObjectLiteralExpression | undefined, key: string): TsNode | undefined => {
  const property = options?.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

const stringOption = (options: ObjectLiteralExpression | undefined, key: string): string | undefined => {
  const value = option(options, key);
  return value !== undefined && Node.isStringLiteral(value) ? value.getLiteralValue() : undefined;
};

const booleanOption = (options: ObjectLiteralExpression | undefined, key: string): boolean => {
  const property = options?.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) && property.getInitializer()?.getText() === 'true';
};

const SCALARS: Readonly<Record<string, string>> = { string: 'String', number: 'Float', boolean: 'Boolean', Date: 'DateTime', ID: 'ID', Int: 'Int', Float: 'Float', String: 'String', Boolean: 'Boolean' };

/** A TypeScript type as the GraphQL type a code-first server makes of it. */
const graphqlTypeOf = (written: string, list: boolean, nullable: boolean): string => {
  const base = SCALARS[written] ?? written.replace(/\[\]$/, '');
  const inner = list || written.endsWith('[]') ? `[${base}!]` : base;
  return nullable ? inner : `${inner}!`;
};

/**
 * The directives `@Directive('@key(fields: "id")')` writes on a class or a
 * field, read as the SDL they are (P241).
 */
const writtenDirectives = (node: { getDecorators(): Decorator[] }): AppliedDirective[] =>
  graphqlDecorators(node, ['Directive']).flatMap((decorator) => {
    const [text] = decorator.getArguments();
    if (text === undefined || !(Node.isStringLiteral(text) || Node.isNoSubstitutionTemplateLiteral(text))) return [];
    const [definition] = tryParse(`scalar Written ${text.getLiteralValue()}`)?.definitions ?? [];
    return definition?.kind === 'type' ? [...definition.applied] : [];
  });

const plainName = (name: string): string => name;

/** The GraphQL name of each class a code-first server decorates as a type, and its fields. */
const codeFirstTypes = (sources: readonly SourceFile[]): { names: Map<string, string>; schema: SchemaSummary } => {
  const names = new Map<string, string>();
  const types: Record<string, { kind: 'object' | 'input' | 'interface'; fields: Record<string, SchemaField>; federation?: TypeFederation }> = {};
  for (const sourceFile of sources) {
    for (const declaration of sourceFile.getClasses()) {
      const decorator = graphqlDecorator(declaration, ['ObjectType', 'InputType', 'InterfaceType', 'ArgsType']);
      if (decorator === undefined) continue;
      const className = declaration.getName() ?? '';
      const [first] = decorator.getArguments();
      const name = first !== undefined && Node.isStringLiteral(first) ? first.getLiteralValue() : className;
      names.set(className, name);
      if (decorator.getName() === 'ArgsType') continue;
      const fields: Record<string, SchemaField> = {};
      for (const member of declaration.getProperties()) {
        const field = graphqlDecorator(member, ['Field']);
        if (field === undefined) continue;
        const written = typeArgument(field.getArguments()[0]);
        const options = optionsOf(field);
        const type = written === undefined ? graphqlTypeOf(member.getTypeNode()?.getText() ?? 'String', false, booleanOption(options, 'nullable') || member.hasQuestionToken()) : graphqlTypeOf(written.name, written.list, booleanOption(options, 'nullable') || member.hasQuestionToken());
        const federation = fieldFederationOf(writtenDirectives(member), plainName);
        fields[stringOption(options, 'name') ?? member.getName()] = { type, ...(federation === undefined ? {} : { federation }) };
      }
      const federation = typeFederationOf(writtenDirectives(declaration), false, plainName);
      types[name] = { kind: decorator.getName() === 'InputType' ? 'input' : decorator.getName() === 'InterfaceType' ? 'interface' : 'object', fields, ...(federation === undefined ? {} : { federation }) };
    }
  }
  return { names, schema: { roots: { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }, types } };
};

/**
 * The arguments a resolver method takes: `@Args('id') id`, `@Arg('id')`, with
 * the options written after the name (`@Args('take', { type: () => Int })`,
 * type-graphql's `@Arg('id', () => ID)`) or in place of it
 * (`@Args({ name: 'id', type: () => ID, nullable: true })`); or every field of
 * an `@ArgsType` class. A type the options name is the argument's type over
 * the one TypeScript writes: a `number` is a `Float` unless it says `Int`.
 */
const argumentsOf = (method: MethodDeclaration, argsTypes: ReadonlyMap<string, ClassDeclaration>, names: ReadonlyMap<string, string>): Record<string, { type: string; required: boolean }> => {
  const found: Record<string, { type: string; required: boolean }> = {};
  for (const parameter of method.getParameters()) {
    const decorator = graphqlDecorator(parameter, ['Args', 'Arg']);
    if (decorator === undefined) continue;
    const [first, second] = decorator.getArguments();
    const options = optionsOf(decorator);
    const typeFunction = second !== undefined && (Node.isArrowFunction(second) || Node.isFunctionExpression(second)) ? second : undefined;
    const typed = typeArgument(option(options, 'type') ?? typeFunction);
    const written = parameter.getTypeNode()?.getText() ?? 'String';
    const name = first !== undefined && Node.isStringLiteral(first) ? first.getLiteralValue() : stringOption(options, 'name');
    if (name !== undefined) {
      const nullable = booleanOption(options, 'nullable') || parameter.hasQuestionToken() || parameter.hasInitializer();
      const type = typed === undefined ? graphqlTypeOf(written, false, nullable) : graphqlTypeOf(names.get(typed.name) ?? typed.name, typed.list, nullable);
      found[name] = { type, required: !nullable };
      continue;
    }
    const argsType = argsTypes.get(typed?.name ?? written);
    for (const member of argsType?.getProperties() ?? []) {
      const field = graphqlDecorator(member, ['Field']);
      if (field === undefined) continue;
      const nullable = booleanOption(optionsOf(field), 'nullable') || member.hasQuestionToken();
      found[member.getName()] = { type: graphqlTypeOf(member.getTypeNode()?.getText() ?? 'String', false, nullable), required: !nullable };
    }
  }
  return found;
};

/** Every field a decorated resolver class answers. */
const decoratedFields = (sources: readonly SourceFile[], names: ReadonlyMap<string, string>): ResolvedField[] => {
  const argsTypes = new Map<string, ClassDeclaration>();
  for (const sourceFile of sources) for (const declaration of sourceFile.getClasses()) if (graphqlDecorator(declaration, ['ArgsType']) !== undefined) argsTypes.set(declaration.getName() ?? '', declaration);
  const found: ResolvedField[] = [];
  for (const sourceFile of sources) {
    for (const declaration of sourceFile.getClasses()) {
      const resolver = graphqlDecorator(declaration, ['Resolver']);
      if (resolver === undefined) continue;
      const of = typeArgument(resolver.getArguments()[0]);
      const parent = of === undefined ? undefined : (names.get(of.name) ?? of.name);
      for (const method of declaration.getMethods()) {
        const root = graphqlDecorator(method, [...ROOTS.keys()]);
        const field = root === undefined ? graphqlDecorator(method, FIELD_DECORATORS) : undefined;
        const decorator = root ?? field;
        if (decorator === undefined) continue;
        const [first] = decorator.getArguments();
        const options = optionsOf(decorator);
        const reference = decorator.getName() === 'ResolveReference';
        const named = reference ? REFERENCE_FIELD : first !== undefined && Node.isStringLiteral(first) ? first.getLiteralValue() : (stringOption(options, 'name') ?? method.getName());
        const written = typeArgument(first !== undefined && Node.isStringLiteral(first) ? decorator.getArguments()[1] : first);
        const nullable = booleanOption(options, 'nullable');
        const type = root === undefined ? parent : ROOTS.get(root.getName());
        if (type === undefined) continue;
        const args = argumentsOf(method, argsTypes, names);
        const federation = fieldFederationOf(writtenDirectives(method), plainName);
        found.push({
          type,
          field: named,
          root: root !== undefined,
          handler: { kind: 'method', method },
          at: method,
          ...(written === undefined || reference ? {} : { returns: graphqlTypeOf(names.get(written.name) ?? written.name, written.list, nullable) }),
          ...(Object.keys(args).length === 0 ? {} : { args }),
          ...(reference ? { reference: true as const } : {}),
          ...(federation === undefined ? {} : { federation }),
        });
      }
    }
  }
  return found;
};

/** The object literals a resolver map is, through constants, imports, spreads, arrays and `mergeResolvers`. */
const resolverObjects = (value: TsNode | undefined, depth = 0): ObjectLiteralExpression[] => {
  if (value === undefined || depth > 8) return [];
  if (Node.isObjectLiteralExpression(value)) {
    const found = [value];
    for (const property of value.getProperties()) if (Node.isSpreadAssignment(property)) found.push(...resolverObjects(property.getExpression(), depth + 1));
    return found;
  }
  if (Node.isArrayLiteralExpression(value)) return value.getElements().flatMap((element) => resolverObjects(Node.isSpreadElement(element) ? element.getExpression() : element, depth + 1));
  if (Node.isCallExpression(value)) return value.getArguments().flatMap((argument) => resolverObjects(argument, depth + 1));
  if (Node.isAsExpression(value) || Node.isSatisfiesExpression(value) || Node.isParenthesizedExpression(value)) return resolverObjects(value.getExpression(), depth + 1);
  if (Node.isIdentifier(value)) {
    const symbol = value.getSymbol();
    return ((symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []).flatMap((declaration) =>
      Node.isVariableDeclaration(declaration) ? resolverObjects(declaration.getInitializer(), depth + 1) : [],
    );
  }
  return [];
};

/** The function a resolver map's entry is: a method, an arrow, a named function, or `{ resolve }` / `{ subscribe }`. */
const mapHandler = (property: TsNode, name: string): { fn: TsNode; name: string } | undefined => {
  if (Node.isMethodDeclaration(property)) return { fn: property, name };
  const value = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
  if (value === undefined) return undefined;
  if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) return { fn: value, name };
  if (Node.isObjectLiteralExpression(value)) {
    const inner = value.getProperty('resolve') ?? value.getProperty('subscribe');
    return inner === undefined ? undefined : mapHandler(inner, name);
  }
  if (Node.isIdentifier(value)) {
    const symbol = value.getSymbol();
    for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
      if (Node.isFunctionDeclaration(declaration)) return { fn: declaration, name: declaration.getName() ?? name };
      if (Node.isVariableDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) return { fn: declaration, name: declaration.getName() };
      }
    }
  }
  return undefined;
};

/** The calls a server is made by, and the key of their options that holds its resolvers and its type definitions. */
const SERVER_CALLS = new Set(['ApolloServer', 'createYoga', 'createSchema', 'makeExecutableSchema', 'buildSubgraphSchema', 'mercurius', 'createHandler', 'buildSchema']);

/** Every field a resolver map answers, and the type definitions handed beside it. */
const mappedFields = (sources: readonly SourceFile[], roots: ReadonlyMap<string, string>): { fields: ResolvedField[]; typeDefs: TsNode[] } => {
  const fields: ResolvedField[] = [];
  const typeDefs: TsNode[] = [];
  const seen = new Set<ObjectLiteralExpression>();
  /** One server's options, or one module of a subgraph: its type definitions and its resolver map. */
  const readModule = (options: ObjectLiteralExpression): void => {
    const valueOf = (key: string): TsNode | undefined => {
      const property = options.getProperty(key);
      if (property !== undefined && Node.isPropertyAssignment(property)) return property.getInitializer();
      if (property === undefined || !Node.isShorthandPropertyAssignment(property)) return undefined;
      // `{ resolvers }`: the value is whatever the name is bound to, not the property.
      for (const declaration of property.getValueSymbol()?.getDeclarations() ?? []) {
        if (Node.isVariableDeclaration(declaration)) return declaration.getInitializer();
        if (Node.isImportSpecifier(declaration)) {
          for (const found of declaration.getNameNode().getSymbol()?.getAliasedSymbol()?.getDeclarations() ?? []) {
            if (Node.isVariableDeclaration(found)) return found.getInitializer();
          }
        }
      }
      return property.getNameNode();
    };
    const defs = valueOf('typeDefs') ?? valueOf('schema');
    if (defs !== undefined) typeDefs.push(defs);
    for (const map of resolverObjects(valueOf('resolvers'))) {
      if (seen.has(map)) continue;
      seen.add(map);
      for (const typeProperty of map.getProperties()) {
        if (!Node.isPropertyAssignment(typeProperty)) continue;
        const type = typeProperty.getName();
        if (!/^[A-Z_]/.test(type)) continue;
        for (const object of resolverObjects(typeProperty.getInitializer())) {
          for (const property of object.getProperties()) {
            if (Node.isSpreadAssignment(property)) continue;
            const field = (property as { getName?: () => string }).getName?.() ?? '';
            // How an abstract type picks its member is not a field anybody selects.
            if (field === '__resolveType' || field === '__isTypeOf') continue;
            const handler = mapHandler(property, `${type}.${field}`);
            if (handler === undefined || field === '') continue;
            fields.push({
              type: roots.get(type) ?? type,
              field,
              root: roots.has(type),
              handler: { kind: 'function', fn: handler.fn, name: handler.name },
              at: property,
              ...(field === REFERENCE_FIELD ? { reference: true as const } : {}),
            });
          }
        }
      }
    }
  };
  for (const sourceFile of sources) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isNewExpression(node) && !Node.isCallExpression(node)) return;
      const callee = node.getExpression().getText().replace(/^.*\./, '');
      const written = node.getArguments().find((argument): argument is ObjectLiteralExpression => Node.isObjectLiteralExpression(argument));
      if (!SERVER_CALLS.has(callee) && !(callee === 'register' && written !== undefined && written.getProperty('resolvers') !== undefined)) return;
      // `buildSubgraphSchema([{ typeDefs, resolvers }, ...])`: a list of modules, each read as one (P241).
      const listed = node
        .getArguments()
        .flatMap((argument) => (Node.isArrayLiteralExpression(argument) ? argument.getElements() : []))
        .filter((element): element is ObjectLiteralExpression => Node.isObjectLiteralExpression(element));
      for (const options of written === undefined ? listed : [written]) readModule(options);
    });
  }
  return { fields, typeDefs };
};

/** The SDL a `typeDefs` value holds: templates, arrays of them, files read with `readFileSync`. */
const sdlOf = (value: TsNode, unread: Array<{ at: TsNode; why: string }>, depth = 0): Document[] => {
  if (depth > 6) return [];
  if (Node.isArrayLiteralExpression(value)) return value.getElements().flatMap((element) => sdlOf(element, unread, depth + 1));
  if (Node.isCallExpression(value) && value.getExpression().getText().endsWith('readFileSync')) {
    const [path] = value.getArguments();
    const written = path !== undefined && (Node.isStringLiteral(path) || Node.isNoSubstitutionTemplateLiteral(path)) ? path.getLiteralValue() : undefined;
    if (written === undefined) return [];
    try {
      const text = readFileSync(written.startsWith('/') ? written : `${value.getSourceFile().getDirectoryPath()}/${written}`, 'utf8');
      const document = tryParse(text);
      return document === undefined ? [] : [document];
    } catch {
      return [];
    }
  }
  if (Node.isIdentifier(value) && value.getSymbol() !== undefined) {
    const declarations = (value.getSymbol()?.getAliasedSymbol() ?? value.getSymbol())?.getDeclarations() ?? [];
    const initializer = declarations.map((declaration) => (Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined)).find((each) => each !== undefined);
    if (initializer !== undefined && !Node.isCallExpression(initializer)) return sdlOf(initializer, unread, depth + 1);
  }
  const reading = documentOf(value);
  if (reading.kind === 'read') return [reading.document];
  // A schema built by another call (`buildSchema(...)`, `loadSchemaSync`) is read from the `.graphql` files instead.
  if (Node.isCallExpression(value)) return [];
  unread.push({ at: value, why: reading.why });
  return [];
};

/** Every `.graphql` / `.gql` file of the repository, as documents, in the order given; undefined for one that does not parse. */
const schemaFiles = (files: readonly string[]): Array<Document | undefined> =>
  files.map((file) => {
    try {
      return tryParse(readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  });

/** The path the server answers at: written in its options, or its library's own default. */
const endpointOf = (sources: readonly SourceFile[]): { path: string; at?: TsNode } => {
  let standalone = false;
  let written: string | undefined;
  let at: TsNode | undefined;
  for (const sourceFile of sources) {
    sourceFile.forEachDescendant((node) => {
      if (Node.isNewExpression(node) && node.getExpression().getText().endsWith('ApolloServer')) at ??= node;
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression().getText();
      if (callee.endsWith('startStandaloneServer')) standalone = true;
      const options = node.getArguments().find((argument): argument is ObjectLiteralExpression => Node.isObjectLiteralExpression(argument));
      if (/GraphQLModule\.forRoot(Async)?$/.test(callee) || /(?:^|\.)(?:createYoga|makeExecutableSchema)$/.test(callee)) at ??= node;
      if (/GraphQLModule\.forRoot(Async)?$/.test(callee) || callee.endsWith('createYoga') || callee.endsWith('register')) {
        written ??= stringOption(options, 'path') ?? stringOption(options, 'graphqlEndpoint');
      }
      // `app.use('/graphql', expressMiddleware(server))`
      if (callee.endsWith('.use')) {
        const [path, handler] = node.getArguments();
        if (path !== undefined && Node.isStringLiteral(path) && handler !== undefined && /expressMiddleware|graphqlHTTP|createHandler|yoga/i.test(handler.getText())) written ??= path.getLiteralValue();
      }
    });
  }
  return { path: written ?? (standalone ? '/' : '/graphql'), ...(at === undefined ? {} : { at }) };
};

/** Whether the service is one subgraph of a federated graph, and of which version. */
const federationIn = (sources: readonly SourceFile[], schema: SchemaSummary, dependencies: ReadonlySet<string>): 1 | 2 | undefined => {
  const texts = sources.map((sourceFile) => sourceFile.getFullText());
  const federated =
    schema.federation !== undefined ||
    dependencies.has('@apollo/subgraph') ||
    dependencies.has('@apollo/federation') ||
    Object.values(schema.types).some((type) => type.directives?.includes('key') === true || type.federation?.keys !== undefined) ||
    texts.some((text) => /\bbuildSubgraphSchema\b|\bbuildFederatedSchema\b|ApolloFederationDriver/.test(text));
  if (!federated) return undefined;
  // NestJS says federation 2 in its driver's options; SDL says it by linking the specification.
  if (schema.federation === 2 || texts.some((text) => /ApolloFederationDriver/.test(text) && /federation\s*:\s*2\b/.test(text))) return 2;
  return schema.federation ?? 1;
};

/** Everything a GraphQL server in these files declares. */
export const readGraphqlServer = (
  sources: readonly SourceFile[],
  options: { readonly schemaFiles: readonly string[]; readonly dependencies: ReadonlySet<string>; readonly repoDir?: string; readonly roverFiles?: readonly string[] },
): ServerReading => {
  const unread: Array<{ at: TsNode; why: string }> = [];
  const codeFirst = codeFirstTypes(sources);
  // A supergraph is what a gateway serves, not a schema the service declares (P241).
  const documents = schemaFiles(options.schemaFiles);
  const supergraphs = options.schemaFiles.filter((_, index) => documents[index] !== undefined && isSupergraph(documents[index] as Document));
  const filed = documents.filter((document): document is Document => document !== undefined && !isSupergraph(document));
  const roots = new Map(ROOTS);
  for (const document of filed) for (const definition of document.definitions) if (definition.kind === 'schema') for (const [operation, type] of Object.entries(definition.roots)) roots.set(type as string, operation === 'query' ? 'Query' : operation === 'mutation' ? 'Mutation' : 'Subscription');
  const decorated = decoratedFields(sources, codeFirst.names);
  const mapped = mappedFields(sources, roots);
  const written = mapped.typeDefs.flatMap((value) => sdlOf(value, unread));
  let schema = mergeSchemas(schemaOf([...filed, ...written]), codeFirst.schema);
  // The root fields a resolver answers are fields of its root type, with what the code says they return.
  const fields = [...decorated, ...mapped.fields];
  const rootTypes: Record<string, { kind: 'object'; fields: Record<string, SchemaField> }> = {};
  for (const field of fields) {
    if (field.returns === undefined) continue;
    const owner = (rootTypes[field.type] ??= { kind: 'object', fields: {} });
    owner.fields[field.field] = { type: field.returns, ...(field.args === undefined ? {} : { args: field.args }), ...(field.federation === undefined ? {} : { federation: field.federation }) };
  }
  schema = mergeSchemas(schema, { roots: schema.roots, types: rootTypes });
  // What the schema says a field returns and takes, where the code did not.
  const filled = fields.map((field): ResolvedField => {
    const declared = schema.types[field.type]?.fields?.[field.field];
    if (declared === undefined) return field;
    return { ...field, ...(field.returns === undefined ? { returns: declared.type } : {}), ...(field.args === undefined && declared.args !== undefined ? { args: declared.args } : {}) };
  });
  const endpoint = endpointOf(sources);
  const gateway = readGraphqlGateway(sources, { repoDir: options.repoDir ?? '', supergraphs, rover: options.roverFiles ?? [] });
  const federation = gateway === undefined ? federationIn(sources, schema, options.dependencies) : undefined;
  return {
    fields: filled,
    schema: federation === undefined ? schema : { ...schema, federation },
    endpoint: endpoint.path,
    ...(endpoint.at === undefined ? {} : { endpointAt: endpoint.at }),
    federated: federation !== undefined,
    ...(federation === undefined ? {} : { federation }),
    ...(gateway === undefined ? {} : { gateway }),
    unread,
  };
};

export type { SchemaField };
