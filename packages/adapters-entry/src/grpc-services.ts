import type { EntryAdapter, EntryHandler, EntryNode, ExtractContext, ProtoMethod } from '@flowatlas/core';
import {
  decoratorArgs,
  evaluateExpression,
  findDecorators,
  grpcCallKind,
  grpcEntryKey,
  hasAnyDependency,
  makeEntryId,
  namedFunction,
  startLineOf,
} from '@flowatlas/core';
import { dirname } from 'node:path';
import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type SourceFile } from 'ts-morph';
import { declaredSpelling, methodNamed, type Contract, type Contracts, type ContractService } from './grpc-contracts.js';
import { bare, contractsFor, GRPC_PACKAGES, protoSpecsOf, readServiceSpelling, valueOf, type ServiceReading } from './grpc-reading.js';
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
    for (const source of repoSources(ctx)) {
      const contracts = contractsFor(source, ctx.repoDir);
      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        for (const entry of registeredOf(call, ctx, contracts)) keep(entry);
      }
      for (const entry of decoratedOf(source, ctx, contracts, options)) keep(entry);
    }
    return entries;
  },
};

/** One member of an implementation: the name it is held under and what it holds. */
interface Implemented {
  readonly name: string;
  readonly node: TsNode;
}

/** The members of an implementation object, or of an instance of a class of the repository's. */
const implementationOf = (expression: TsNode, depth = 0): Implemented[] | undefined => {
  const value = valueOf(expression);
  if (Node.isObjectLiteralExpression(value)) {
    const members: Implemented[] = [];
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
      } else if (Node.isSpreadAssignment(property) && depth < 4) {
        members.push(...(implementationOf(property.getExpression(), depth + 1) ?? []));
      }
    }
    return members;
  }
  if (Node.isNewExpression(value)) {
    const made = bare(value.getExpression());
    const declaration = Node.isIdentifier(made) ? made.getSymbol()?.getAliasedSymbol()?.getDeclarations()[0] ?? made.getSymbol()?.getDeclarations()[0] : undefined;
    if (declaration === undefined || !Node.isClassDeclaration(declaration)) return undefined;
    return declaration
      .getMethods()
      .filter((method) => !method.isStatic() && method.getScope() !== 'private' && method.getScope() !== 'protected')
      .map((method) => ({ name: method.getName(), node: method }));
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

/** What every gRPC entry carries, from the service and the method. */
const entryOf = (
  ctx: ExtractContext,
  contracts: Contracts,
  site: TsNode,
  fullName: string,
  method: string,
  call: string,
  declared: ContractService | undefined,
  declaredMethod: ProtoMethod | undefined,
  handler: { handler?: EntryHandler; via: string },
  registration: string,
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
      ...(declared === undefined ? {} : { contract: contracts.pathOf(declared.contract) }),
      adapter: ADAPTER,
      registration,
      handlerVia: handler.via,
    },
  };
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
  const reading = readServiceSpelling(service, contracts);
  if (reading.kind === 'unread') {
    // A health or reflection service a package hands over is not this server's own.
    if (isPackageService(service)) return [];
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
  const members = implementationOf(implementation);
  const entries: EntryNode[] = [];
  if (members === undefined) {
    // The service is named and its implementation is not read: its methods are
    // still ways in, drawn from the contract with nothing behind them.
    for (const method of reading.declared?.service.methods ?? []) {
      entries.push(entryOf(ctx, contracts, call, reading.fullName, method.name, grpcCallKind(method), reading.declared, method, { via: 'none' }, callee.getName()));
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
  for (const member of members) {
    const method = methodOfMember(reading, member.name);
    if (method === undefined) continue;
    const label = `grpc ${reading.fullName}/${method.name}`;
    const kind = method.declared === undefined ? 'unary' : grpcCallKind(method.declared);
    entries.push(entryOf(ctx, contracts, call, reading.fullName, method.name, kind, reading.declared, method.declared, handlerOfMember(member, label, ctx), callee.getName()));
  }
  if (reading.declared === undefined) contractUnread(ctx, file, line, reading.fullName, reading.paths === undefined);
  return entries;
};

/** A service a package hands the server - health checking, reflection - named by a module nobody here wrote. */
const isPackageService = (expression: TsNode): boolean => {
  let at = bare(expression);
  while (Node.isPropertyAccessExpression(at)) at = bare(at.getExpression());
  if (!Node.isIdentifier(at)) return false;
  const value = valueOf(at);
  const root = Node.isCallExpression(value) ? value : at;
  const text = root.getText();
  return /^require\(['"][^.]/.test(text) || isImportedPackage(at);
};

const isImportedPackage = (identifier: TsNode): boolean => {
  for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
    const statement = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (statement !== undefined) return !statement.getModuleSpecifierValue().startsWith('.');
    if (Node.isVariableDeclaration(declaration) || Node.isBindingElement(declaration)) {
      const holder = Node.isBindingElement(declaration) ? declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration) : declaration;
      const text = holder?.getInitializer()?.getText() ?? '';
      if (/^require\(['"][^.]/.test(text)) return true;
    }
  }
  return false;
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

/** The ways in a NestJS controller's gRPC decorators declare. */
const decoratedOf = (source: SourceFile, ctx: ExtractContext, contracts: Contracts, options: readonly GrpcTransportOptions[]): EntryNode[] => {
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
        entries.push(
          entryOf(ctx, contracts, method, named.fullName, methodName, call, named.declared, declaredMethod, { handler: handlerOf(method, ctx), via: 'method' }, decorator.getName()),
        );
      }
    }
  }
  return entries;
};
