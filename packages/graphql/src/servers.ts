import { readFileSync } from 'node:fs';
import type { ClassDeclaration, Decorator, MethodDeclaration, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { documentOf } from './documents.js';
import { tryParse, type Document } from './parse.js';
import { mergeSchemas, schemaOf, type SchemaField, type SchemaSummary } from './schema.js';

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
}

export interface ServerReading {
  readonly fields: readonly ResolvedField[];
  readonly schema: SchemaSummary;
  /** The path the server answers at, and where the server is made, when it is in these files. */
  readonly endpoint: string;
  readonly endpointAt?: TsNode;
  /** One subgraph of a federated graph. */
  readonly federated: boolean;
  /** Type definitions that could not be read, and why. */
  readonly unread: ReadonlyArray<{ readonly at: TsNode; readonly why: string }>;
}

const DECORATOR_PACKAGES = ['@nestjs/graphql', 'type-graphql'];
const ROOTS = new Map([
  ['Query', 'Query'],
  ['Mutation', 'Mutation'],
  ['Subscription', 'Subscription'],
]);
const FIELD_DECORATORS = new Set(['ResolveField', 'FieldResolver', 'ResolveProperty']);

/** A decorator of one of the GraphQL packages, by the name it is imported under. */
const graphqlDecorator = (node: { getDecorators(): Decorator[] }, names: ReadonlySet<string> | readonly string[]): Decorator | undefined =>
  node.getDecorators().find((decorator) => {
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

const stringOption = (options: ObjectLiteralExpression | undefined, key: string): string | undefined => {
  const property = options?.getProperty(key);
  const value = property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
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

/** The GraphQL name of each class a code-first server decorates as a type, and its fields. */
const codeFirstTypes = (sources: readonly SourceFile[]): { names: Map<string, string>; schema: SchemaSummary } => {
  const names = new Map<string, string>();
  const types: Record<string, { kind: 'object' | 'input' | 'interface'; fields: Record<string, SchemaField> }> = {};
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
        fields[stringOption(options, 'name') ?? member.getName()] = { type };
      }
      types[name] = { kind: decorator.getName() === 'InputType' ? 'input' : decorator.getName() === 'InterfaceType' ? 'interface' : 'object', fields };
    }
  }
  return { names, schema: { roots: { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }, types } };
};

/** The arguments a resolver method takes: `@Args('id') id`, `@Arg('id')`, or every field of an `@ArgsType` class. */
const argumentsOf = (method: MethodDeclaration, argsTypes: ReadonlyMap<string, ClassDeclaration>): Record<string, { type: string; required: boolean }> => {
  const found: Record<string, { type: string; required: boolean }> = {};
  for (const parameter of method.getParameters()) {
    const decorator = graphqlDecorator(parameter, ['Args', 'Arg']);
    if (decorator === undefined) continue;
    const [first] = decorator.getArguments();
    const written = parameter.getTypeNode()?.getText() ?? 'String';
    if (first !== undefined && Node.isStringLiteral(first)) {
      const options = optionsOf(decorator);
      const nullable = booleanOption(options, 'nullable') || parameter.hasQuestionToken() || parameter.hasInitializer();
      found[first.getLiteralValue()] = { type: graphqlTypeOf(written, false, nullable), required: !nullable };
      continue;
    }
    const argsType = argsTypes.get(written);
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
        const named = first !== undefined && Node.isStringLiteral(first) ? first.getLiteralValue() : (stringOption(options, 'name') ?? method.getName());
        const written = typeArgument(first !== undefined && Node.isStringLiteral(first) ? decorator.getArguments()[1] : first);
        const nullable = booleanOption(options, 'nullable');
        const type = root === undefined ? parent : ROOTS.get(root.getName());
        if (type === undefined) continue;
        const args = argumentsOf(method, argsTypes);
        found.push({
          type,
          field: named,
          root: root !== undefined,
          handler: { kind: 'method', method },
          at: method,
          ...(written === undefined ? {} : { returns: graphqlTypeOf(names.get(written.name) ?? written.name, written.list, nullable) }),
          ...(Object.keys(args).length === 0 ? {} : { args }),
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
  for (const sourceFile of sources) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isNewExpression(node) && !Node.isCallExpression(node)) return;
      const callee = node.getExpression().getText().replace(/^.*\./, '');
      const options = node.getArguments().find((argument): argument is ObjectLiteralExpression => Node.isObjectLiteralExpression(argument));
      if (!SERVER_CALLS.has(callee) && !(callee === 'register' && options !== undefined && options.getProperty('resolvers') !== undefined)) return;
      if (options === undefined) return;
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
              const handler = mapHandler(property, `${type}.${field}`);
              if (handler === undefined || field === '') continue;
              fields.push({ type: roots.get(type) ?? type, field, root: roots.has(type), handler: { kind: 'function', fn: handler.fn, name: handler.name }, at: property });
            }
          }
        }
      }
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

/** Every `.graphql` / `.gql` file of the repository, as documents. */
const schemaFiles = (files: readonly string[]): Document[] =>
  files.flatMap((file) => {
    try {
      const document = tryParse(readFileSync(file, 'utf8'));
      return document === undefined ? [] : [document];
    } catch {
      return [];
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

/** Whether the service is one subgraph of a federated graph. */
const federatedIn = (sources: readonly SourceFile[], schema: SchemaSummary, dependencies: ReadonlySet<string>): boolean =>
  dependencies.has('@apollo/subgraph') ||
  dependencies.has('@apollo/federation') ||
  Object.values(schema.types).some((type) => type.directives?.includes('key') === true) ||
  sources.some((sourceFile) => /\bbuildSubgraphSchema\b|ApolloFederationDriver/.test(sourceFile.getFullText()));

/** Everything a GraphQL server in these files declares. */
export const readGraphqlServer = (sources: readonly SourceFile[], options: { readonly schemaFiles: readonly string[]; readonly dependencies: ReadonlySet<string> }): ServerReading => {
  const unread: Array<{ at: TsNode; why: string }> = [];
  const codeFirst = codeFirstTypes(sources);
  const filed = schemaFiles(options.schemaFiles);
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
    owner.fields[field.field] = { type: field.returns, ...(field.args === undefined ? {} : { args: field.args }) };
  }
  schema = mergeSchemas(schema, { roots: schema.roots, types: rootTypes });
  // What the schema says a field returns and takes, where the code did not.
  const filled = fields.map((field): ResolvedField => {
    const declared = schema.types[field.type]?.fields?.[field.field];
    if (declared === undefined) return field;
    return { ...field, ...(field.returns === undefined ? { returns: declared.type } : {}), ...(field.args === undefined && declared.args !== undefined ? { args: declared.args } : {}) };
  });
  const endpoint = endpointOf(sources);
  return {
    fields: filled,
    schema,
    endpoint: endpoint.path,
    ...(endpoint.at === undefined ? {} : { endpointAt: endpoint.at }),
    federated: federatedIn(sources, schema, options.dependencies),
    unread,
  };
};

export type { SchemaField };
