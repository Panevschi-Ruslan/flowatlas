import type { EntryAdapter, EntryHandler, EntryNode, ExtractContext, ProtoMethod, ProtoTypes } from '@flowatlas/core';
import {
  decoratorArgs,
  evaluateExpression,
  findDecorators,
  GRPC_PACKAGE_CONTRACTS,
  IMPLEMENTED_BY_META,
  grpcCallKind,
  grpcEntryKey,
  hasAnyDependency,
  makeEntryId,
  namedFunction,
  packageOfSpecifier,
  parseProto,
  protoTypes,
  startLineOf,
} from '@flowatlas/core';
import { dirname } from 'node:path';
import { Node, SyntaxKind, type CallExpression, type ClassDeclaration, type Node as TsNode, type SourceFile } from 'ts-morph';
import { declaredSpelling, methodNamed, type Contract, type Contracts, type ContractService } from './grpc-contracts.js';
import { bare, contractsFor, GRPC_PACKAGES, moduleOfName, protoSpecsOf, readServiceSpelling, valueOf, type ServiceReading } from './grpc-reading.js';
import { fileOfNode, handlerOf, handlerOfFunction, inlineHandlerOf, repoFunctionOf, repoSources } from './shared.js';
import { unwrapWork } from './wrapped-work.js';

const ADAPTER = 'grpc-server';

const NEST_MICROSERVICES = ['@nestjs/microservices'];

/**
 * The decorators a NestJS controller answers a gRPC method with, and the kind
 * of call each answers where no contract says: a stream method takes a stream.
 */
const NEST_DECORATORS: ReadonlyMap<string, 'unary' | 'bidi-stream'> = new Map([
  ['GrpcMethod', 'unary'],
  ['GrpcStreamMethod', 'bidi-stream'],
  ['GrpcStreamCall', 'bidi-stream'],
]);

/** The methods a server is handed its services with. */
const REGISTRATIONS = new Set(['addService', 'addProtoService']);

/**
 * A gRPC server's services, each method a way in (P274).
 *
 * A client calls a method of a service by its path, `/shop.CartService/GetCart`,
 * which the contract the two share declares; so each method a server
 * implements is an `rpc` entry keyed `grpc:shop.CartService/GetCart`, with
 * the function that implements it as its handler. Two spellings of a server:
 *
 * - `server.addService(definition, { getCart: impl, ... })` on the library
 *   itself, the definition named by a loaded contract
 *   (`loadPackageDefinition(loadSync('shop.proto')).shop.CartService.service`),
 *   by generated code, or by a generated name a contract declares
 *   (`grpc-reading.ts`). The implementation is an object of functions, or an
 *   instance of a class of the repository's.
 * - A NestJS controller's `@GrpcMethod('CartService', 'GetCart')` (and the
 *   stream decorators), with the package from the microservice's options,
 *   `transport: Transport.GRPC, options: { package, protoPath }`.
 *
 * The contract, where the repository holds one, names each method as declared
 * and says how it is called. A service no contract here declares is still
 * drawn from what the code writes, and a row says the names were taken as
 * written. A service that cannot be named at all is a row and nothing else.
 */
export const grpcServerAdapter: EntryAdapter = {
  name: ADAPTER,
  // A NestJS gRPC transport needs the library installed beside it, so the
  // library alone turns this on: a microservice over another transport is not read.
  detect: (pkg) => hasAnyDependency(pkg, [...GRPC_PACKAGES]),
  extractEntries: (ctx) => {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const keep = (entry: EntryNode): void => {
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      entries.push(entry);
    };
    const options = grpcTransportOptions(ctx);
    const nest: NestServed = { services: new Map(), unread: false };
    let contracts: Contracts | undefined;
    for (const source of repoSources(ctx)) {
      contracts = contractsFor(source, ctx.repoDir);
      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        for (const entry of registeredOf(call, ctx, contracts)) keep(entry);
        for (const entry of handedToServerOf(call, ctx)) keep(entry);
      }
      for (const entry of decoratedOf(source, ctx, contracts, options, nest)) keep(entry);
    }
    unimplementedByControllers(ctx, nest);
    // The messages a way in takes and answers, registered once every way in is read.
    for (const types of [contracts?.types(ctx.repo), packageTypes.get(ctx.repo)]) {
      if (types === undefined) continue;
      for (const [id, entry] of Object.entries(types.registry())) ctx.builder.addType(id, entry);
    }
    return entries;
  },
};

/**
 * The payload types of the contracts packages hand a server, per repository
 * (P287): a health service's messages are registered under the server's own.
 */
const packageTypes = new Map<string, ProtoTypes>();

const packageTypesOf = (repo: string): ProtoTypes => {
  const found =
    packageTypes.get(repo) ??
    protoTypes(
      GRPC_PACKAGE_CONTRACTS.map((contract) => ({ path: contract.path, file: parseProto(contract.text) })),
      repo,
    );
  packageTypes.set(repo, found);
  return found;
};

/**
 * What a method takes and answers, as the contract's messages (P287): the
 * signature a procedure's way in carries, which the contract check compares a
 * caller's request with.
 */
const signatureOf = (types: ProtoTypes, pkg: string | undefined, method: ProtoMethod): { params: { name: string; type: string }[]; returns: string } => ({
  params: [{ name: 'request', type: types.refOf(method.request, pkg) }],
  returns: types.refOf(method.response, pkg),
});

/** One member of an implementation: the name it is held under and what it holds. */
interface Implemented {
  readonly name: string;
  readonly node: TsNode;
}

/**
 * What an implementation holds: its members, whether they were written in an
 * object or are a class's methods, and whether every member was read - a
 * spread of something unread leaves members nobody can name.
 */
interface Implementation {
  readonly members: Implemented[];
  readonly from: 'object' | 'class';
  readonly complete: boolean;
}

/** The members of an implementation object, or of an instance of a class of the repository's. */
const implementationOf = (expression: TsNode, depth = 0): Implementation | undefined => {
  const value = valueOf(expression);
  if (Node.isObjectLiteralExpression(value)) {
    const members: Implemented[] = [];
    let complete = true;
    for (const property of value.getProperties()) {
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        if (initializer !== undefined) members.push({ name: property.getName().replace(/^['"]|['"]$/g, ''), node: initializer });
      } else if (Node.isShorthandPropertyAssignment(property)) {
        // `{ getCart }`: the value is whatever the name was declared as, not the property.
        const declared = property.getValueSymbol()?.getDeclarations()[0];
        const node =
          declared !== undefined && Node.isFunctionDeclaration(declared)
            ? declared
            : declared !== undefined && Node.isVariableDeclaration(declared) && declared.getInitializer() !== undefined
              ? (declared.getInitializer() as TsNode)
              : property.getNameNode();
        members.push({ name: property.getName(), node });
      } else if (Node.isMethodDeclaration(property)) {
        members.push({ name: property.getName(), node: property });
      } else if (Node.isSpreadAssignment(property)) {
        const spread = depth < 4 ? implementationOf(property.getExpression(), depth + 1) : undefined;
        members.push(...(spread?.members ?? []));
        if (spread?.complete !== true) complete = false;
      } else complete = false;
    }
    return { members, from: 'object', complete };
  }
  if (Node.isNewExpression(value)) {
    const made = bare(value.getExpression());
    const declaration = Node.isIdentifier(made) ? made.getSymbol()?.getAliasedSymbol()?.getDeclarations()[0] ?? made.getSymbol()?.getDeclarations()[0] : undefined;
    if (declaration === undefined || !Node.isClassDeclaration(declaration)) return undefined;
    // A class's own methods and those it inherits from classes of the repository.
    const members: Implemented[] = [];
    const seen = new Set<string>();
    let complete = true;
    let at: ClassDeclaration | undefined = declaration;
    for (let level = 0; at !== undefined && level < 8; level += 1) {
      for (const method of at.getMethods()) {
        if (method.isStatic() || method.getScope() === 'private' || method.getScope() === 'protected' || seen.has(method.getName())) continue;
        seen.add(method.getName());
        members.push({ name: method.getName(), node: method });
      }
      const base: ClassDeclaration | undefined = at.getBaseClass();
      if (base === undefined && at.getExtends() !== undefined) complete = false;
      at = base;
    }
    return { members, from: 'class', complete };
  }
  return undefined;
};

/** The code behind one member. */
const handlerOfMember = (member: Implemented, label: string, ctx: ExtractContext): { handler?: EntryHandler; via: string } => {
  if (Node.isMethodDeclaration(member.node)) {
    if (Node.isClassDeclaration(member.node.getParent())) return { handler: handlerOf(member.node, ctx), via: 'method' };
    const inline = inlineHandlerOf(member.node, label, ctx);
    return inline === undefined ? { via: 'none' } : { handler: inline, via: 'inline' };
  }
  if (Node.isFunctionDeclaration(member.node)) {
    const declared = namedFunction(member.node);
    if (declared !== undefined) return { handler: handlerOfFunction(declared, ctx), via: 'function' };
  }
  const work = unwrapWork(member.node).work;
  const named = repoFunctionOf(work);
  if (named !== undefined) return { handler: handlerOfFunction(named, ctx), via: 'function' };
  const inline = inlineHandlerOf(work, label, ctx);
  return inline === undefined ? { via: 'none' } : { handler: inline, via: 'inline' };
};

/** The method a member implements: the contract's, the generated path's, or its own name with the first letter raised. */
const methodOfMember = (
  reading: Extract<ServiceReading, { kind: 'named' }>,
  name: string,
): { name: string; declared?: ProtoMethod } | undefined => {
  if (reading.declared !== undefined) {
    const declared = methodNamed(reading.declared.service, name);
    return declared === undefined ? undefined : { name: declared.name, declared };
  }
  const path = reading.paths?.get(name);
  if (path !== undefined) return { name: path.split('/')[2] as string };
  return { name: declaredSpelling(name) };
};

/** Where a method's contract is, and the types its messages are registered as. */
interface Declaration {
  /** The contract's path as a node records it. */
  readonly path: string;
  readonly pkg: string | undefined;
  readonly types: ProtoTypes;
}

const declarationOf = (ctx: ExtractContext, contracts: Contracts, declared: ContractService | undefined): Declaration | undefined =>
  declared === undefined
    ? undefined
    : { path: contracts.pathOf(declared.contract), pkg: declared.contract.file.package, types: contracts.types(ctx.repo) };

/** What every gRPC entry carries, from the service and the method. */
const entryOf = (
  ctx: ExtractContext,
  declaration: Declaration | undefined,
  site: TsNode,
  fullName: string,
  method: string,
  call: string,
  declaredMethod: ProtoMethod | undefined,
  handler: { handler?: EntryHandler; via: string },
  registration: string,
  extra: Record<string, unknown> = {},
): EntryNode => {
  const key = grpcEntryKey(fullName, method);
  return {
    id: makeEntryId(ctx.repo, 'rpc', key),
    kind: 'rpc',
    label: `grpc ${fullName}/${method}`,
    key,
    ...(handler.handler === undefined ? {} : { handler: handler.handler }),
    file: fileOfNode(site, ctx),
    line: startLineOf(site),
    meta: {
      key,
      // How it is called, in the word a procedure's caller is matched on.
      call,
      service: fullName,
      method,
      ...(declaredMethod === undefined ? {} : { request: declaredMethod.request, response: declaredMethod.response }),
      ...(declaration === undefined ? {} : { contract: declaration.path }),
      // The messages as a procedure's input and output (P287).
      ...(declaration === undefined || declaredMethod === undefined ? {} : { signature: signatureOf(declaration.types, declaration.pkg, declaredMethod) }),
      adapter: ADAPTER,
      registration,
      handlerVia: handler.via,
      ...extra,
    },
  };
};

/**
 * The ways in of a service a package implements (P287), drawn from the
 * package's contract with nothing of the repository's behind them; or, for a
 * package whose service is none this knows, a row saying so.
 */
const packageServiceOf = (ctx: ExtractContext, site: TsNode, pkg: string, registration: string, symbol: string): EntryNode[] => {
  const known = GRPC_PACKAGE_CONTRACTS.filter((contract) => pkg.toLowerCase().includes(contract.word));
  if (known.length === 0) {
    ctx.builder.addUnresolved({
      file: fileOfNode(site, ctx),
      line: startLineOf(site),
      reason: 'grpc-package-service',
      level: 'info',
      message: `${symbol} registers a gRPC service the package ${pkg} implements, and its contract is none this knows, so its methods are not drawn.`,
      hint: 'Nothing to change if the service is the package\'s business. Load its .proto file from the repository and register it by name, so its methods are drawn.',
      symbol,
      adapter: ADAPTER,
      meta: { package: pkg },
    });
    return [];
  }
  const types = packageTypesOf(ctx.repo);
  const entries: EntryNode[] = [];
  for (const contract of known) {
    const file = parseProto(contract.text);
    const declaration: Declaration = { path: contract.path, pkg: file.package, types };
    for (const service of file.services) {
      for (const method of service.methods) {
        entries.push(entryOf(ctx, declaration, site, service.fullName, method.name, grpcCallKind(method), method, { via: 'package' }, registration, { [IMPLEMENTED_BY_META]: pkg }));
      }
    }
  }
  return entries;
};

/** The package a name of a service comes from, by its import or its `require`, where it is a package's. */
const packageOfService = (expression: TsNode): string | undefined => {
  let at = bare(expression);
  while (Node.isPropertyAccessExpression(at) || Node.isCallExpression(at) || Node.isNewExpression(at)) at = bare(at.getExpression());
  if (!Node.isIdentifier(at)) return undefined;
  const value = valueOf(at);
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    const [first] = value.getArguments();
    if (Node.isIdentifier(callee) && callee.getText() === 'require' && first !== undefined && Node.isStringLiteral(first)) {
      const specifier = first.getLiteralValue();
      return specifier.startsWith('.') ? undefined : packageOfSpecifier(specifier);
    }
  }
  const specifier = moduleOfName(at);
  return specifier === undefined || specifier.startsWith('.') ? undefined : packageOfSpecifier(specifier);
};

/**
 * A service a package hands the server itself (P287): `new
 * HealthImplementation(statuses).addToServer(server)`, `new
 * ReflectionService(definition).addToServer(server)`, the instance made from
 * a package's class.
 */
const handedToServerOf = (call: CallExpression, ctx: ExtractContext): EntryNode[] => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'addToServer' || call.getArguments().length === 0) return [];
  const made = valueOf(callee.getExpression());
  if (!Node.isNewExpression(made)) return [];
  const pkg = packageOfService(made.getExpression());
  if (pkg === undefined || GRPC_PACKAGE_CONTRACTS.every((contract) => !pkg.toLowerCase().includes(contract.word))) return [];
  return packageServiceOf(ctx, call, pkg, 'addToServer', `${made.getExpression().getText().slice(0, 60)}.addToServer`);
};

/** The row for a method a contract declares that the implementation registered for it does not hold. */
const unimplemented = (ctx: ExtractContext, site: TsNode, fullName: string, methods: readonly ProtoMethod[], path: string, by: string): void => {
  for (const method of methods) {
    ctx.builder.addUnresolved({
      file: fileOfNode(site, ctx),
      line: startLineOf(site),
      reason: 'grpc-method-unimplemented',
      level: 'info',
      message: `${fullName}/${method.name} is declared by ${path} and ${by} does not implement it, so a client calling it is answered UNIMPLEMENTED.`,
      hint: 'Implement the method where the service is registered, or take it out of the contract if no client is meant to call it.',
      symbol: `${fullName}/${method.name}`,
      adapter: ADAPTER,
      meta: { service: fullName, method: method.name, contract: path },
    });
  }
};

/** The row for a member of an implementation, or a decorated method, that is no method of the contract. */
const undeclared = (ctx: ExtractContext, site: TsNode, fullName: string, name: string, path: string, drawn: boolean): void => {
  ctx.builder.addUnresolved({
    file: fileOfNode(site, ctx),
    line: startLineOf(site),
    reason: 'grpc-method-undeclared',
    level: 'info',
    message: `${name} is implemented for ${fullName} and ${path} declares no such method, so no client of the contract can call it${drawn ? '; it is drawn as written' : ', and it is not drawn'}.`,
    hint: 'Declare the method in the contract, or correct its name to the one the contract declares; a helper the implementation holds belongs outside it.',
    symbol: `${fullName}/${name}`,
    adapter: ADAPTER,
    meta: { service: fullName, method: name, contract: path },
  });
};

/** The ways in one `addService(...)` call registers. */
const registeredOf = (call: CallExpression, ctx: ExtractContext, contracts: Contracts): EntryNode[] => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || !REGISTRATIONS.has(callee.getName())) return [];
  const [definition, implementation] = call.getArguments();
  if (definition === undefined || implementation === undefined) return [];
  const file = fileOfNode(call, ctx);
  const line = startLineOf(call);
  const spelled = bare(definition);
  const service = Node.isPropertyAccessExpression(spelled) && spelled.getName() === 'service' ? spelled.getExpression() : spelled;
  const read = readServiceSpelling(service, contracts);
  const reading: ServiceReading & { package?: Declaration } = read.kind === 'named' && read.declared === undefined ? (packageDeclared(read, ctx.repo) ?? read) : read;
  if (reading.kind === 'unread') {
    // A health or reflection service a package hands over: the package's contract says its methods (P287).
    const pkg = packageOfService(service);
    if (pkg !== undefined) return packageServiceOf(ctx, call, pkg, callee.getName(), `${callee.getName()}(${definition.getText().slice(0, 60)})`);
    ctx.builder.addUnresolved({
      file,
      line,
      reason: 'grpc-service-unread',
      message: `${callee.getText()}(${definition.getText().slice(0, 60)}, ...) registers a gRPC service this cannot name: ${reading.why}, so none of its methods is drawn.`,
      hint: 'Load the service from a .proto file of the repository, or register the generated definition by its name, so the service and its methods can be named.',
      symbol: `${callee.getName()}(${definition.getText().slice(0, 60)})`,
      adapter: ADAPTER,
      meta: { why: 'service' },
    });
    return [];
  }
  const implemented = implementationOf(implementation);
  const declaration = reading.package === undefined ? declarationOf(ctx, contracts, reading.declared) : reading.package;
  const entries: EntryNode[] = [];
  if (implemented === undefined) {
    // The service is named and its implementation is not read: its methods are
    // still ways in, drawn from the contract with nothing behind them.
    for (const method of reading.declared?.service.methods ?? []) {
      entries.push(entryOf(ctx, declaration, call, reading.fullName, method.name, grpcCallKind(method), method, { via: 'none' }, callee.getName()));
    }
    ctx.builder.addUnresolved({
      file,
      line,
      reason: 'grpc-service-unread',
      message: `${reading.fullName} is registered with an implementation this cannot read (${implementation.getText().slice(0, 60)}), so ${entries.length === 0 ? 'none of its methods is drawn' : 'its methods are drawn from the contract with no code behind them'}.`,
      hint: 'Hand the server an object of the functions that implement the methods, or an instance of a class of the repository, where it is registered.',
      symbol: `${callee.getName()}(${reading.fullName})`,
      adapter: ADAPTER,
      meta: { why: 'implementation', service: reading.fullName },
    });
    return entries;
  }
  const served = new Set<string>();
  for (const member of implemented.members) {
    const method = methodOfMember(reading, member.name);
    if (method === undefined) {
      // A member the contract does not declare: said where it was written in
      // an object handed over for the service, not for a class's other methods.
      if (implemented.from === 'object' && declaration !== undefined) undeclared(ctx, member.node, reading.fullName, member.name, declaration.path, false);
      continue;
    }
    served.add(method.name);
    const label = `grpc ${reading.fullName}/${method.name}`;
    const kind = method.declared === undefined ? 'unary' : grpcCallKind(method.declared);
    entries.push(entryOf(ctx, declaration, call, reading.fullName, method.name, kind, method.declared, handlerOfMember(member, label, ctx), callee.getName()));
  }
  if (reading.declared !== undefined && declaration !== undefined && implemented.complete) {
    unimplemented(ctx, call, reading.fullName, reading.declared.service.methods.filter((method) => !served.has(method.name)), declaration.path, `the implementation registered at this call`);
  }
  if (reading.declared === undefined) contractUnread(ctx, file, line, reading.fullName, reading.paths === undefined);
  return entries;
};

/**
 * A service named by a contract no file of the repository holds and a package
 * implements (P287): `loadSync(require.resolve('<health package>/health.proto'))`
 * names `grpc.health.v1.Health`, which the protocol's own contract declares.
 */
const packageDeclared = (reading: Extract<ServiceReading, { kind: 'named' }>, repo: string): (Extract<ServiceReading, { kind: 'named' }> & { package: Declaration }) | undefined => {
  for (const contract of GRPC_PACKAGE_CONTRACTS) {
    const file = parseProto(contract.text);
    const service = file.services.find((each) => each.fullName === reading.fullName);
    if (service === undefined) continue;
    return { ...reading, declared: { contract: { path: contract.path, file }, service }, package: { path: contract.path, pkg: file.package, types: packageTypesOf(repo) } };
  }
  return undefined;
};

/** The row for a service no contract of the repository declares. */
const contractUnread = (ctx: ExtractContext, file: string, line: number, fullName: string, asWritten: boolean): void => {
  ctx.builder.addUnresolved({
    file,
    line,
    reason: 'grpc-contract-unread',
    level: 'info',
    message: `${fullName} is declared by no .proto file of the repository, so ${asWritten ? 'its methods are named as the code writes them, the first letter raised' : 'its methods are named by the generated paths'} and how each is called is not known.`,
    hint: 'Keep the .proto file the service is generated from in the repository, so its methods are named as declared.',
    symbol: fullName,
    adapter: ADAPTER,
  });
};

/** What a NestJS gRPC transport's options say: its packages, its contracts and where it is reached. */
export interface GrpcTransportOptions {
  readonly packages: readonly string[];
  readonly contracts: readonly Contract[];
  /** The `url` option, as written. */
  readonly url?: TsNode;
}

/**
 * Every `transport: Transport.GRPC` options object of the repository: a
 * microservice's (`createMicroservice(App, { transport, options })`) and a
 * client's (`ClientsModule.register([{ name, transport, options }])`) alike.
 */
export const grpcTransportOptions = (ctx: Pick<ExtractContext, 'project' | 'repoDir'>): GrpcTransportOptions[] => {
  const found: GrpcTransportOptions[] = [];
  for (const source of ctx.project.getSourceFiles()) {
    if (source.getFilePath().includes('/node_modules/')) continue;
    if (!source.getText().includes('GRPC')) continue;
    const contracts = contractsFor(source, ctx.repoDir);
    for (const object of source.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const transport = object.getProperty('transport');
      if (transport === undefined || !Node.isPropertyAssignment(transport)) continue;
      if (!/\bGRPC$/.test(transport.getInitializer()?.getText() ?? '')) continue;
      const optionsProperty = object.getProperty('options');
      const options = optionsProperty !== undefined && Node.isPropertyAssignment(optionsProperty) ? optionsProperty.getInitializer() : undefined;
      const value = options === undefined ? undefined : valueOf(options);
      if (value === undefined || !Node.isObjectLiteralExpression(value)) {
        found.push({ packages: [], contracts: [] });
        continue;
      }
      const read = (name: string): TsNode | undefined => {
        const property = value.getProperty(name);
        return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
      };
      const pkg = read('package');
      const evaluated = pkg === undefined ? undefined : evaluateExpression(valueOf(pkg));
      const packages =
        evaluated?.resolved === true
          ? (Array.isArray(evaluated.value) ? evaluated.value : [evaluated.value]).filter((each): each is string => typeof each === 'string')
          : [];
      const from = dirname(source.getFilePath());
      const specs = protoSpecsOf(read('protoPath'));
      const url = read('url');
      found.push({
        packages,
        contracts: specs.map((spec) => contracts.file(spec, from)).filter((contract): contract is Contract => contract !== undefined),
        ...(url === undefined ? {} : { url }),
      });
    }
  }
  return found;
};

/**
 * The service a NestJS decorator's short name is, in the packages the
 * transport options name: the contract's, or the package's where one package
 * is named and no contract declares it.
 */
export const nestServiceNamed = (
  name: string,
  contracts: Contracts,
  options: readonly GrpcTransportOptions[],
): { fullName: string; declared?: ContractService } | { why: string } => {
  const packages = [...new Set(options.flatMap((each) => each.packages))];
  for (const pkg of packages) {
    const declared = contracts.byFullName(`${pkg}.${name}`);
    if (declared !== undefined) return { fullName: declared.service.fullName, declared };
  }
  const loaded = options.flatMap((each) => each.contracts).flatMap((contract) => contract.file.services.filter((service) => service.name === name).map((service) => ({ contract, service })));
  if (loaded.length === 1) return { fullName: (loaded[0] as ContractService).service.fullName, declared: loaded[0] as ContractService };
  const anywhere = contracts.byShortName(name);
  if (anywhere.length === 1) return { fullName: (anywhere[0] as ContractService).service.fullName, declared: anywhere[0] as ContractService };
  if (anywhere.length > 1) return { why: `${anywhere.map((each) => each.service.fullName).join(' and ')} are all named ${name}, and the transport's options name none of their packages` };
  if (packages.length === 1) return { fullName: `${packages[0] as string}.${name}` };
  return { why: packages.length === 0 ? `no .proto file of the repository declares a service ${name}, and no package is named in the transport's options` : `the transport's options name several packages, and no .proto file of the repository says which holds ${name}` };
};

/**
 * The methods of each declared service NestJS controllers answer, by the
 * service's full name, for the methods none answers; and whether a decorator
 * of the repository names what it answers at run time, which might be any of
 * them.
 */
interface NestServed {
  readonly services: Map<string, { readonly declared: ContractService; readonly declaration: Declaration; readonly site: TsNode; readonly served: Set<string> }>;
  unread: boolean;
}

/**
 * A row per method of a service the controllers answer some of and not this
 * one (P287); none where a decorator could not be read, since it may be the
 * one that answers it.
 */
const unimplementedByControllers = (ctx: ExtractContext, served: NestServed): void => {
  if (served.unread) return;
  for (const [fullName, each] of served.services) {
    const missing = each.declared.service.methods.filter((method) => !each.served.has(method.name));
    unimplemented(ctx, each.site, fullName, missing, each.declaration.path, 'no controller');
  }
};

/** The ways in a NestJS controller's gRPC decorators declare. */
const decoratedOf = (
  source: SourceFile,
  ctx: ExtractContext,
  contracts: Contracts,
  options: readonly GrpcTransportOptions[],
  served: NestServed,
): EntryNode[] => {
  const entries: EntryNode[] = [];
  for (const declaration of source.getClasses()) {
    for (const method of declaration.getMethods()) {
      for (const decorator of findDecorators(method, { names: [...NEST_DECORATORS.keys()], fromModules: NEST_MICROSERVICES })) {
        const [serviceArg, methodArg] = decoratorArgs(decorator);
        const file = fileOfNode(method, ctx);
        const line = startLineOf(method);
        const serviceName = serviceArg === undefined ? declaration.getName() : serviceArg.resolved && typeof serviceArg.value === 'string' ? serviceArg.value : undefined;
        const rpc = methodArg === undefined ? declaredSpelling(method.getName()) : methodArg.resolved && typeof methodArg.value === 'string' ? methodArg.value : undefined;
        if (serviceName === undefined || rpc === undefined) {
          served.unread = true;
          ctx.builder.addUnresolved({
            file,
            line,
            reason: 'grpc-service-unread',
            message: `@${decorator.getName()}(${decorator.getArguments().map((arg) => arg.getText()).join(', ').slice(0, 60)}) names its ${serviceName === undefined ? 'service' : 'method'} with a value decided at run time, so the way in is not drawn.`,
            hint: 'Name the service and the method as text in the decorator.',
            symbol: `${declaration.getName() ?? '<anonymous>'}.${method.getName()}`,
            adapter: ADAPTER,
            meta: { why: 'name' },
          });
          continue;
        }
        const named = nestServiceNamed(serviceName, contracts, options);
        if ('why' in named) {
          ctx.builder.addUnresolved({
            file,
            line,
            reason: 'grpc-service-unread',
            message: `@${decorator.getName()}('${serviceName}') answers a service this cannot name: ${named.why}.`,
            hint: 'Keep the .proto file in the repository and name its package in the transport options, `options: { package, protoPath }`.',
            symbol: `${declaration.getName() ?? '<anonymous>'}.${method.getName()}`,
            adapter: ADAPTER,
            meta: { why: 'service' },
          });
          continue;
        }
        const declaredMethod = named.declared === undefined ? undefined : methodNamed(named.declared.service, rpc);
        const methodName = declaredMethod?.name ?? rpc;
        const call = declaredMethod === undefined ? (NEST_DECORATORS.get(decorator.getName()) ?? 'unary') : grpcCallKind(declaredMethod);
        if (named.declared === undefined) contractUnread(ctx, file, line, named.fullName, true);
        const contract = declarationOf(ctx, contracts, named.declared);
        if (named.declared !== undefined && contract !== undefined) {
          // Said once per service, at the first controller that answers it.
          const answered = served.services.get(named.fullName) ?? { declared: named.declared, declaration: contract, site: declaration, served: new Set<string>() };
          served.services.set(named.fullName, answered);
          if (declaredMethod === undefined) undeclared(ctx, method, named.fullName, methodName, contract.path, true);
          else answered.served.add(declaredMethod.name);
        }
        entries.push(
          entryOf(ctx, contract, method, named.fullName, methodName, call, declaredMethod, { handler: handlerOf(method, ctx), via: 'method' }, decorator.getName()),
        );
      }
    }
  }
  return entries;
};
