import { dirname } from 'node:path';
import { evaluateExpression, packageOfSpecifier, type ProtoFieldNames, type ProtoService } from '@flowatlas/core';
import { Node, SyntaxKind, type ClassDeclaration, type Node as TsNode, type SourceFile } from 'ts-morph';
import { contractsOf, type Contract, type Contracts, type ContractService } from './grpc-contracts.js';

/**
 * How a gRPC service is named where code registers or calls it (P274), read
 * the same way by the server reader and the calls reader.
 *
 * Three spellings name one, and each says the service's full name its own
 * way:
 *
 * - **A loaded contract.** `grpc.loadPackageDefinition(loadSync('shop.proto'))`
 *   hands back the contract's packages as nested objects, so
 *   `.shop.CartService` after it is the full name, member by member, and the
 *   file handed to the loader is the contract.
 * - **Generated code.** A definition generated from the contract,
 *   `CartServiceService = { getCart: { path: '/shop.CartService/GetCart' } }`,
 *   and a client constructor made from one, write each method's path; where
 *   the generated module is in the repository, those paths are read.
 * - **A generated name with nothing to read.** Generated code is very often
 *   not committed (`module-not-installed`): `CartServiceClient` imported from
 *   a module nobody generated still names a service, `CartService`, which a
 *   contract of the repository declares. The contract is then what says its
 *   package, and the module's name says which file where two declare one.
 *
 * A name read any other way - a variable handed in, a service chosen at run
 * time - is not a guess: the reader that asked says it could not name it.
 */

/** The libraries a server or a client is written with, and the loader beside them. */
export const GRPC_PACKAGES = ['@grpc/grpc-js', 'grpc', '@grpc/proto-loader'] as const;

/** How far a name is followed to the value it was given. */
const MAX_FOLLOW = 8;

/** What reading a service's spelling found. */
export type ServiceReading =
  | {
      readonly kind: 'named';
      /** `shop.CartService`. */
      readonly fullName: string;
      /** The contract that declares it, where one of the repository's does. */
      readonly declared?: ContractService;
      /** Each method a generated definition writes the path of, by the member that holds it. */
      readonly paths?: ReadonlyMap<string, string>;
      /** How the name was found. */
      readonly via: 'loader' | 'generated' | 'contract-name';
      /**
       * How the loader that made it names the messages' fields, where it says
       * (P293): `proto` under `keepCase: true`, `unread` where its options
       * are not read; the libraries' camelCase otherwise.
       */
      readonly fieldNames?: ProtoFieldNames | 'unread';
    }
  | { readonly kind: 'unread'; readonly why: string };

/** The expression a cast, a bang, an await or a pair of brackets is wrapped round. */
export const bare = (node: TsNode): TsNode => {
  let at = node;
  while (
    Node.isParenthesizedExpression(at) ||
    Node.isAsExpression(at) ||
    Node.isNonNullExpression(at) ||
    Node.isSatisfiesExpression(at) ||
    Node.isAwaitExpression(at) ||
    Node.isTypeAssertion(at)
  ) {
    at = at.getExpression();
  }
  return at;
};

/** The name a call is made by: `f()` is `f`, `a.b.f()` is `f`. */
export const calleeNameOf = (node: TsNode): string | undefined => {
  if (!Node.isCallExpression(node)) return undefined;
  const callee = bare(node.getExpression());
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

/** The module a `require('...')` call loads, where the call is one. */
export const requiredModule = (node: TsNode | undefined): string | undefined => {
  if (node === undefined || !Node.isCallExpression(node)) return undefined;
  const callee = node.getExpression();
  if (!Node.isIdentifier(callee) || callee.getText() !== 'require') return undefined;
  const [first] = node.getArguments();
  return first !== undefined && Node.isStringLiteral(first) ? first.getLiteralValue() : undefined;
};

/** The module a name was imported from, by `import` or by `require`, where either says. */
export const moduleOfName = (identifier: TsNode): string | undefined => {
  if (!Node.isIdentifier(identifier)) return undefined;
  for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
    const statement = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (statement !== undefined) return statement.getModuleSpecifierValue();
    if (Node.isVariableDeclaration(declaration)) {
      const loaded = requiredModule(declaration.getInitializer());
      if (loaded !== undefined) return loaded;
    }
    if (Node.isBindingElement(declaration)) {
      const holder = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const loaded = requiredModule(holder?.getInitializer());
      if (loaded !== undefined) return loaded;
    }
  }
  return undefined;
};

/** Whether a name comes from one of these packages, by its import or its `require`. */
export const isFromPackages = (identifier: TsNode, packages: readonly string[]): boolean => {
  const specifier = moduleOfName(identifier);
  const pkg = specifier === undefined ? undefined : packageOfSpecifier(specifier);
  return pkg !== undefined && packages.includes(pkg);
};

/** The one declaration a name stands for, through an import into this repository. */
const declarationOfName = (identifier: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(identifier)) return undefined;
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return undefined;
  const aliased = symbol.getAliasedSymbol() ?? symbol;
  const declarations = aliased.getDeclarations().length > 0 ? aliased.getDeclarations() : symbol.getDeclarations();
  // A generated client is an interface and a constant of one name: the value is the constant.
  const declaration =
    declarations.find((each) => Node.isVariableDeclaration(each) || Node.isBindingElement(each) || Node.isClassDeclaration(each) || Node.isFunctionDeclaration(each)) ??
    declarations[0];
  if (declaration === undefined || declaration.getSourceFile().getFilePath().includes('/node_modules/')) return undefined;
  return declaration;
};

/**
 * What a name was given, followed through constants, re-exports and the
 * properties a class writes on itself, or the name itself where nothing
 * further is written.
 */
export const valueOf = (node: TsNode, depth = 0): TsNode => {
  const at = bare(node);
  if (depth >= MAX_FOLLOW) return at;
  if (Node.isIdentifier(at)) {
    const declaration = declarationOfName(at);
    if (declaration !== undefined && Node.isVariableDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode())) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return valueOf(initializer, depth + 1);
    }
    return at;
  }
  if (Node.isPropertyAccessExpression(at) && at.getExpression().getKind() === SyntaxKind.ThisKeyword) {
    const assigned = classMemberValue(at);
    return assigned === undefined ? at : valueOf(assigned, depth + 1);
  }
  return at;
};

/**
 * The value a class gives `this.name`: its property's initializer, or the
 * first assignment to it in any of its methods - `onModuleInit() { this.cart =
 * this.client.getService('CartService') }` is how a client is kept.
 */
export const classMemberValue = (access: TsNode): TsNode | undefined => {
  if (!Node.isPropertyAccessExpression(access)) return undefined;
  const owner = access.getFirstAncestor((node): node is ClassDeclaration => Node.isClassDeclaration(node) || Node.isClassExpression(node));
  if (owner === undefined || !Node.isClassDeclaration(owner)) return undefined;
  const name = access.getName();
  const property = owner.getProperty(name);
  const initializer = property?.getInitializer();
  if (initializer !== undefined) return initializer;
  for (const assignment of owner.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = assignment.getLeft();
    if (Node.isPropertyAccessExpression(left) && left.getExpression().getKind() === SyntaxKind.ThisKeyword && left.getName() === name) {
      return assignment.getRight();
    }
  }
  return undefined;
};

/** A loader's call: `loadPackageDefinition(...)`, or the older `grpc.load(...)`. */
const LOADERS = new Set(['loadPackageDefinition', 'load']);

/** The `.proto` files a loader is handed, as written: a string, or strings inside a path built round one. */
export const protoSpecsOf = (argument: TsNode | undefined): string[] => {
  if (argument === undefined) return [];
  const at = valueOf(argument);
  const evaluated = evaluateExpression(at);
  if (evaluated.resolved && typeof evaluated.value === 'string') return evaluated.value.endsWith('.proto') ? [evaluated.value] : [];
  if (evaluated.resolved && Array.isArray(evaluated.value)) return evaluated.value.filter((each): each is string => typeof each === 'string' && each.endsWith('.proto'));
  const found: string[] = [];
  const visit = (node: TsNode): void => {
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.getLiteralValue();
      if (text.endsWith('.proto')) found.push(text);
      return;
    }
    if (Node.isIdentifier(node) && node !== at) {
      const followed = valueOf(node);
      if (followed !== node) visit(followed);
      return;
    }
    node.forEachChild(visit);
  };
  visit(at);
  return found;
};

/**
 * How a loader's options name the fields of the messages it hands over
 * (P293): `@grpc/proto-loader`'s `keepCase: true` keeps them as the contract
 * writes them, `user_id`; without it they are camelCase, `userId`. `unread`
 * where the options are a value this cannot read, or `keepCase` one decided
 * at run time.
 */
export const loaderFieldNames = (options: TsNode | undefined, option = 'keepCase', keeps = true): ProtoFieldNames | 'unread' => {
  if (options === undefined) return keeps ? 'json' : 'proto';
  const value = valueOf(options);
  if (!Node.isObjectLiteralExpression(value)) return 'unread';
  const property = value.getProperty(option);
  if (property === undefined) {
    if (value.getProperties().some((each) => Node.isSpreadAssignment(each))) return 'unread';
    return keeps ? 'json' : 'proto';
  }
  const written = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
  const evaluated = written === undefined ? undefined : evaluateExpression(valueOf(written));
  if (evaluated?.resolved !== true || typeof evaluated.value !== 'boolean') return 'unread';
  return evaluated.value === keeps ? 'proto' : 'json';
};

/**
 * How the loader a loaded contract comes from names its fields: the options
 * handed `loadSync(file, options)` or `load(file, options)`, or the legacy
 * `grpc.load(file, format, options)`, which keeps the contract's names unless
 * told `convertFieldsToCamelCase` (P293).
 */
const loadedFieldNames = (loader: TsNode): ProtoFieldNames | 'unread' => {
  if (!Node.isCallExpression(loader)) return 'json';
  if (calleeNameOf(loader) === 'load') return loaderFieldNames(loader.getArguments()[2], 'convertFieldsToCamelCase', false);
  const [definition] = loader.getArguments();
  const made = definition === undefined ? undefined : valueOf(definition);
  if (made === undefined || !Node.isCallExpression(made) || !['loadSync', 'load'].includes(calleeNameOf(made) ?? '')) return 'json';
  return loaderFieldNames(made.getArguments()[1]);
};

/** The contracts a loader was handed: the call that loads the definition, `loadSync('shop.proto')`. */
const loadedContracts = (definition: TsNode | undefined, contracts: Contracts): Contract[] => {
  if (definition === undefined) return [];
  const made = valueOf(definition);
  const from = dirname(made.getSourceFile().getFilePath());
  const handed = Node.isCallExpression(made) ? made.getArguments()[0] : made;
  return protoSpecsOf(handed)
    .map((spec) => contracts.file(spec, from))
    .filter((contract): contract is Contract => contract !== undefined);
};

/** A member chain, `pkg.shop.CartService`, as the expression it starts at and its names in order. */
const chainOf = (node: TsNode, depth = 0): { root: TsNode; names: string[] } => {
  const at = bare(node);
  if (Node.isPropertyAccessExpression(at)) {
    const inner = chainOf(at.getExpression(), depth);
    return { root: inner.root, names: [...inner.names, at.getName()] };
  }
  if (Node.isElementAccessExpression(at)) {
    const key = at.getArgumentExpression();
    const value = key === undefined ? undefined : evaluateExpression(key);
    if (value?.resolved === true && typeof value.value === 'string') {
      const inner = chainOf(at.getExpression(), depth);
      return { root: inner.root, names: [...inner.names, value.value] };
    }
    return { root: at, names: [] };
  }
  if (Node.isIdentifier(at) && depth < MAX_FOLLOW) {
    const declaration = declarationOfName(at);
    // `const { shop } = grpc.loadPackageDefinition(...)`: the name is a member of what it is taken from.
    if (declaration !== undefined && Node.isBindingElement(declaration)) {
      const holder = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const initializer = holder?.getInitializer();
      const member = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
      if (initializer !== undefined && requiredModule(bare(initializer)) === undefined) {
        const inner = chainOf(initializer, depth + 1);
        return { root: inner.root, names: [...inner.names, member] };
      }
    }
    if (declaration !== undefined && Node.isVariableDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode())) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return chainOf(initializer, depth + 1);
    }
  }
  return { root: at, names: [] };
};

/** The paths a generated definition writes, `{ getCart: { path: '/shop.CartService/GetCart' } }`, by member. */
const pathsOfDefinition = (definition: TsNode | undefined): Map<string, string> | undefined => {
  if (definition === undefined) return undefined;
  const object = valueOf(definition);
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const paths = new Map<string, string>();
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const inner = bare(property.getInitializer() ?? property);
    if (!Node.isObjectLiteralExpression(inner)) continue;
    const path = inner.getProperty('path');
    const value = path !== undefined && Node.isPropertyAssignment(path) ? path.getInitializer() : undefined;
    const text = value === undefined ? undefined : evaluateExpression(value);
    if (text?.resolved === true && typeof text.value === 'string' && /^\/[^/]+\/[^/]+$/.test(text.value)) {
      paths.set(property.getName().replace(/^['"]|['"]$/g, ''), text.value);
    }
  }
  return paths.size === 0 ? undefined : paths;
};

/** The service a set of generated paths is of, where they agree on one. */
const serviceOfPaths = (paths: ReadonlyMap<string, string>): string | undefined => {
  const services = new Set([...paths.values()].map((path) => path.split('/')[1] as string));
  return services.size === 1 ? [...services][0] : undefined;
};

/** The names a generated identifier may stand for: `CartServiceClient` and `CartServiceService` are `CartService`. */
const namesOfGenerated = (name: string): string[] =>
  [...new Set([name, name.replace(/Client$/, ''), name.replace(/Service$/, ''), name.replace(/(?:Service)?(?:Client|Service)$/, '')])].filter((each) => each !== '');

/**
 * The service an expression names: the thing before `.service` in a server's
 * `addService(X.service, ...)`, a definition handed to it, or the constructor
 * a client is made with.
 */
export const readServiceSpelling = (expression: TsNode, contracts: Contracts): ServiceReading => {
  const { root, names } = chainOf(expression);
  const made = bare(root);

  // A loaded contract's packages, member by member.
  if (Node.isCallExpression(made) && LOADERS.has(calleeNameOf(made) ?? '')) {
    if (names.length === 0) return { kind: 'unread', why: 'the whole loaded contract is handed over, not one service of it' };
    const fullName = names.join('.');
    const loaded = loadedContracts(made.getArguments()[0], contracts);
    const declared =
      loaded.flatMap((contract) => contract.file.services.filter((service) => service.fullName === fullName).map((service) => ({ contract, service })))[0] ??
      contracts.byFullName(fullName);
    const fieldNames = loadedFieldNames(made);
    return { kind: 'named', fullName, via: 'loader', ...(declared === undefined ? {} : { declared }), ...(fieldNames === 'json' ? {} : { fieldNames }) };
  }

  // A constructor made from a definition: `makeGenericClientConstructor(definition, 'shop.CartService')`.
  if (Node.isCallExpression(made) && calleeNameOf(made) === 'makeGenericClientConstructor') {
    const [definition, serviceName] = made.getArguments();
    const paths = pathsOfDefinition(definition);
    const written = serviceName === undefined ? undefined : evaluateExpression(serviceName);
    const fullName = written?.resolved === true && typeof written.value === 'string' ? written.value : paths === undefined ? undefined : serviceOfPaths(paths);
    if (fullName === undefined) return { kind: 'unread', why: 'the client constructor is made from a definition whose service is not written' };
    const declared = contracts.byFullName(fullName);
    return { kind: 'named', fullName, via: 'generated', ...(declared === undefined ? {} : { declared }), ...(paths === undefined ? {} : { paths }) };
  }

  // A generated definition, written in the repository.
  const paths = pathsOfDefinition(made);
  const fromPaths = paths === undefined ? undefined : serviceOfPaths(paths);
  if (paths !== undefined && fromPaths !== undefined) {
    const declared = contracts.byFullName(fromPaths);
    return { kind: 'named', fullName: fromPaths, via: 'generated', paths, ...(declared === undefined ? {} : { declared }) };
  }

  // A generated name, with nothing of the generated code to read: the contract says which service it is.
  const name = names.length > 0 ? names[names.length - 1] : Node.isIdentifier(made) ? importedNameOf(made) : undefined;
  if (name === undefined) return { kind: 'unread', why: `${expression.getText().slice(0, 60)} is not a service this can name` };
  const hint = Node.isIdentifier(made) ? moduleOfName(made) : undefined;
  for (const candidate of namesOfGenerated(name)) {
    const found = contracts.byShortName(candidate, hint);
    if (found.length === 1) {
      const [declared] = found as [ContractService];
      return { kind: 'named', fullName: declared.service.fullName, via: 'contract-name', declared };
    }
    if (found.length > 1) {
      return { kind: 'unread', why: `${found.map((each) => each.service.fullName).join(' and ')} are all named ${candidate}, and nothing says which this is` };
    }
  }
  return { kind: 'unread', why: `no .proto file of the repository declares a service ${name.replace(/(?:Client|Service)$/, '') || name}` };
};

/** The name an identifier was exported under, where it was imported under another. */
const importedNameOf = (identifier: TsNode): string => {
  for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isImportSpecifier(declaration)) return declaration.getName();
  }
  return identifier.getText();
};

/** The contracts a source file's service can see. */
export const contractsFor = (source: SourceFile, repoDir: string): Contracts =>
  contractsOf(source.getProject().getFileSystem(), repoDir);

/** The service of a reading, where a contract declares it. */
export const declaredService = (reading: ServiceReading): ProtoService | undefined =>
  reading.kind === 'named' ? reading.declared?.service : undefined;
