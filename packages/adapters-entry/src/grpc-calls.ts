import {
  evaluateExpression,
  forEachCall,
  grpcCallKind,
  grpcEntryKey,
  hasAnyDependency,
  makeLeafId,
  siteOf,
  writtenKeysOf,
  type GraphBuilder,
  type PackageJson,
  type ProtoMethod,
  type TypeCollector,
  type Unresolved,
} from '@flowatlas/core';
import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type Project } from 'ts-morph';
import { declaredSpelling, methodNamed, type Contracts } from './grpc-contracts.js';
import { bare, calleeNameOf, contractsFor, GRPC_PACKAGES, valueOf, type ServiceReading } from './grpc-reading.js';
import { grpcTransportOptions, nestServiceNamed, type GrpcTransportOptions } from './grpc-services.js';
import { sentType, typeRefOf, type LinkAddress, type ProcedureCallHolder, type ReadProcedureCall } from './procedure-calls.js';
import { readServiceSpelling } from './grpc-reading.js';

/** What the half reading a server hands the gRPC calls reader (P274). */
export interface GrpcCallReading {
  readonly repo: string;
  readonly repoDir: string;
  readonly pkg: PackageJson;
  readonly builder: GraphBuilder;
  readonly project: Project;
  /** Repo-relative POSIX path of whatever declared this node. */
  fileOf(node: TsNode): string;
  /** An address handed to a client, read as this half reads any address. */
  addressOf(address: TsNode): LinkAddress;
  report(row: Unresolved): void;
  /** What a call hands and reads back is typed with this, where the half has one (P287). */
  readonly types?: Pick<TypeCollector, 'collectType' | 'unwrapAsync'>;
}

/**
 * What a call hands the method and what it reads back (P287), as the contract
 * check compares a procedure's request: the request is the first argument of
 * a method that takes one, typed as the code types it and with the keys an
 * object written in place writes; a stream the client writes is written
 * later. The answer is the second parameter of the callback written in place,
 * or what the call returns where it returns the answer - a promise or an
 * observable a NestJS client gives.
 */
const exchangedAt = (
  call: CallExpression,
  declared: ProtoMethod | undefined,
  types: Pick<TypeCollector, 'collectType' | 'unwrapAsync'> | undefined,
): Record<string, unknown> => {
  if (declared?.requestStream === true) return { inputLater: true };
  const args = call.getArguments();
  const first = args[0];
  const input = first === undefined || Node.isArrowFunction(first) || Node.isFunctionExpression(first) ? undefined : first;
  const inputKeys = input === undefined ? undefined : writtenKeysOf([input]);
  const inputType = input === undefined || types === undefined ? undefined : sentType(input, types);
  let outputType: string | undefined;
  if (types !== undefined && declared?.responseStream !== true) {
    const callback = args.slice(1).find((arg) => Node.isArrowFunction(arg) || Node.isFunctionExpression(arg));
    if (callback !== undefined && (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))) {
      const answer = callback.getParameters()[1];
      const type = answer?.getType();
      if (answer !== undefined && type !== undefined && !type.isAny() && !type.isUnknown()) outputType = typeRefOf(types, type, answer);
    } else if (callback === undefined) {
      const returned = types.unwrapAsync(call.getType());
      const name = returned.getSymbol()?.getName() ?? '';
      // A call object of the library's own (`ClientUnaryCall`) is not the answer.
      if (!returned.isAny() && !returned.isUnknown() && !returned.isVoid() && !/^Client\w*Call$|Stream$/.test(name)) outputType = typeRefOf(types, returned, call);
    }
  }
  return {
    ...(inputKeys === undefined ? {} : { inputKeys }),
    ...(inputType === undefined ? {} : { inputType }),
    ...(input === undefined ? { inputNone: true } : {}),
    ...(outputType === undefined ? {} : { outputType }),
  };
};

/** The methods every client has that are not methods of its service. */
const CLIENT_METHODS = new Set([
  'close',
  'getChannel',
  'waitForReady',
  'makeUnaryRequest',
  'makeClientStreamRequest',
  'makeServerStreamRequest',
  'makeBidiStreamRequest',
  'getService',
  'getClientByServiceName',
  'bind',
  'call',
  'apply',
  'pipe',
  'then',
]);

/** NestJS's microservices package, whose `ClientGrpc.getService('X')` hands a service's client. */
const NEST_MICROSERVICES = ['@nestjs/microservices'];

/** A client the reader recognised: the service it calls and where it sends. */
interface Client {
  readonly reading: Extract<ServiceReading, { kind: 'named' }>;
  readonly address?: TsNode;
  /** The expression the client was made with, for the rows that name it. */
  readonly made: TsNode;
}

/**
 * Calls a server makes to a gRPC service (P274), each an `http_out` of kind
 * `rpc` keyed as the server's way in is, `grpc:shop.CartService/GetCart`, so
 * the linker joins it to the method of the service its address names by the
 * rules a request for a procedure is joined by.
 *
 * A client is recognised by how it was made, never by the name a call is
 * made through:
 *
 * - `new CartServiceClient(address, credentials)`, the constructor generated
 *   from the contract or taken from a loaded contract
 *   (`loadPackageDefinition(...).shop.CartService`), named as the server
 *   reader names a service (`grpc-reading.ts`); the address is its first
 *   argument;
 * - NestJS's `client.getService<CartService>('CartService')`, the package
 *   from the client's transport options, the address their `url`.
 *
 * The client is followed from the call to where it was made: a constant, a
 * property the class gives itself, an argument of `promisify`. A method of
 * the client that is no method of the contract - `close()`, `waitForReady()` -
 * is not a call of the service.
 */
export const readGrpcCalls = (holders: Iterable<ProcedureCallHolder>, reading: GrpcCallReading): readonly ReadProcedureCall[] => {
  const read: ReadProcedureCall[] = [];
  const nest = hasAnyDependency(reading.pkg, NEST_MICROSERVICES);
  if (!hasAnyDependency(reading.pkg, [...GRPC_PACKAGES])) return read;
  let options: GrpcTransportOptions[] | undefined;
  const transportOptions = (): GrpcTransportOptions[] => {
    options ??= grpcTransportOptions({ project: reading.project, repoDir: reading.repoDir });
    return options;
  };
  const clients = new Map<TsNode, Client | undefined>();
  const unread = new Set<TsNode>();
  const contractless = new Set<string>();

  const clientMadeBy = (made: TsNode, contracts: Contracts): Client | 'not-a-client' | { why: string } => {
    if (Node.isNewExpression(made)) {
      const ctor = made.getExpression();
      const reading = readServiceSpelling(ctor, contracts);
      if (reading.kind === 'unread') return looksGenerated(ctor) ? { why: reading.why } : 'not-a-client';
      const [address] = made.getArguments();
      return { reading, made, ...(address === undefined ? {} : { address }) };
    }
    if (Node.isCallExpression(made) && calleeNameOf(made) === 'getService' && nest) {
      const [name] = made.getArguments();
      const value = name === undefined ? undefined : evaluateExpression(valueOf(name));
      if (value?.resolved !== true || typeof value.value !== 'string') return { why: `the service is named by ${name?.getText().slice(0, 40) ?? 'nothing'}, a value decided at run time` };
      const named = nestServiceNamed(value.value, contracts, transportOptions());
      if ('why' in named) return { why: named.why };
      const pkg = named.fullName.slice(0, named.fullName.lastIndexOf('.'));
      const url = transportOptions().find((each) => each.url !== undefined && each.packages.includes(pkg))?.url;
      return {
        reading: { kind: 'named', fullName: named.fullName, via: 'contract-name', ...(named.declared === undefined ? {} : { declared: named.declared }) },
        made,
        ...(url === undefined ? {} : { address: url }),
      };
    }
    return 'not-a-client';
  };

  /**
   * A client handed in rather than made here - a decorator of a package injects
   * it, a context carries it - known by the type it is declared with: a
   * generated client's interface, `CartServiceClient`, whose service a contract
   * of the repository declares. Where it is sent is the injector's business, so
   * it has no address.
   */
  const clientTyped = (receiver: TsNode, contracts: Contracts): Client | undefined => {
    const type = receiver.getType();
    const symbol = type.getAliasSymbol() ?? type.getSymbol();
    const name = symbol?.getName();
    if (name === undefined || !/ServiceClient$/.test(name)) return undefined;
    const declaredIn = symbol?.getDeclarations()[0]?.getSourceFile().getFilePath();
    const found = contracts.byShortName(name.replace(/Client$/, ''), declaredIn);
    if (found.length !== 1) return undefined;
    const [declared] = found as [NonNullable<Extract<ServiceReading, { kind: 'named' }>['declared']>];
    return { reading: { kind: 'named', fullName: declared.service.fullName, via: 'contract-name', declared }, made: receiver };
  };

  const clientOf = (receiver: TsNode, site: CallExpression, file: string): Client | undefined => {
    const made = valueOf(receiver);
    if (clients.has(made)) return clients.get(made);
    const contracts = contractsFor(site.getSourceFile(), reading.repoDir);
    if (!Node.isNewExpression(made) && !Node.isCallExpression(made)) {
      const typed = clientTyped(receiver, contracts);
      if (typed !== undefined) {
        clients.set(made, typed);
        return typed;
      }
    }
    const found = clientMadeBy(made, contracts);
    const client = found === 'not-a-client' || 'why' in found ? undefined : found;
    clients.set(made, client);
    if (found !== 'not-a-client' && 'why' in found && !unread.has(made)) {
      unread.add(made);
      const at = siteOf(made);
      reading.report({
        file: reading.fileOf(made) || file,
        line: at.line,
        reason: 'grpc-service-unread',
        message: `${made.getText().slice(0, 80)} makes a gRPC client of a service this cannot name: ${found.why}, so no call made through it is drawn.`,
        hint: 'Keep the .proto file the client is generated from in the repository, or name the service as text, so its calls can be named and joined.',
        symbol: made.getText().slice(0, 80),
        meta: { why: 'client' },
      });
    }
    return client;
  };

  /** The client and method a call names: `client.getCart(...)`, `getCart(...)` where `getCart = promisify(client.getCart)`. */
  const askedOf = (call: CallExpression): { receiver: TsNode; method: string } | undefined => {
    const callee = bare(call.getExpression());
    const member = (node: TsNode): { receiver: TsNode; method: string } | undefined => {
      const at = bare(node);
      if (Node.isPropertyAccessExpression(at)) return { receiver: at.getExpression(), method: at.getName() };
      if (Node.isElementAccessExpression(at)) {
        const key = at.getArgumentExpression();
        const value = key === undefined ? undefined : evaluateExpression(key);
        if (value?.resolved === true && typeof value.value === 'string') return { receiver: at.getExpression(), method: value.value };
      }
      return undefined;
    };
    // `promisify(client.getCart).bind(client)`, `promisify(client.getCart.bind(client))`, `client.getCart.bind(client)`.
    const promised = (value: TsNode): { receiver: TsNode; method: string } | undefined => {
      let at = bare(value);
      for (let depth = 0; depth < 4; depth += 1) {
        if (Node.isCallExpression(at)) {
          const name = calleeNameOf(at);
          if (name === 'bind') {
            const target = bare(at.getExpression());
            at = Node.isPropertyAccessExpression(target) ? target.getExpression() : target;
            continue;
          }
          if (name === 'promisify') {
            const [handed] = at.getArguments();
            if (handed === undefined) return undefined;
            at = bare(handed);
            continue;
          }
          return undefined;
        }
        return member(at);
      }
      return undefined;
    };
    if (Node.isIdentifier(callee) || (Node.isPropertyAccessExpression(callee) && callee.getExpression().getKind() === SyntaxKind.ThisKeyword)) {
      const value = valueOf(callee);
      if (value !== callee && Node.isCallExpression(value) && ['promisify', 'bind'].includes(calleeNameOf(value) ?? '')) return promised(value);
    }
    const asked = member(callee);
    if (asked === undefined) return undefined;
    // The promised method held on an object of them: `this.cart.getCartAsync(...)` is out of reach; the method itself is not.
    return asked;
  };

  const record = (holder: ProcedureCallHolder, call: CallExpression, client: Client, method: string): void => {
    const { reading: service } = client;
    const declared = service.declared === undefined ? undefined : methodNamed(service.declared.service, method);
    let methodName: string;
    if (service.declared !== undefined) {
      if (declared === undefined) return;
      methodName = declared.name;
    } else {
      const path = service.paths?.get(method);
      if (service.paths !== undefined && path === undefined) return;
      methodName = path === undefined ? declaredSpelling(method) : (path.split('/')[2] as string);
      if (!contractless.has(service.fullName)) {
        contractless.add(service.fullName);
        const at = siteOf(client.made);
        reading.report({
          file: reading.fileOf(client.made),
          line: at.line,
          reason: 'grpc-contract-unread',
          level: 'info',
          message: `${service.fullName} is declared by no .proto file of the repository, so the methods called on it are named ${path === undefined ? 'as the code writes them, the first letter raised' : 'by the generated paths'} and how each is called is not known.`,
          hint: 'Keep the .proto file the client is generated from in the repository, so its methods are named as declared.',
          symbol: service.fullName,
        });
      }
    }
    const { file } = holder;
    const at = siteOf(call);
    read.push({ file, line: at.line, call });
    const id = makeLeafId('http_out', reading.repo, file, at.line, at.column);
    const key = grpcEntryKey(service.fullName, methodName);
    const address = client.address === undefined ? undefined : addressOf(client.address);
    reading.builder.addNode({
      id,
      type: 'http_out',
      label: `grpc ${service.fullName}/${methodName}`,
      repo: reading.repo,
      file,
      line: at.line,
      kind: 'rpc',
      meta: {
        // The string the server's entry carries as `meta.key`.
        procedure: key,
        ...(declared === undefined ? {} : { call: grpcCallKind(declared) }),
        operation: method,
        client: 'grpc',
        service: service.fullName,
        method: methodName,
        ...(service.declared === undefined ? {} : { contract: contractsFor(call.getSourceFile(), reading.repoDir).pathOf(service.declared.contract) }),
        ...(address === undefined ? {} : { link: { protocol: 'grpc', ...address } }),
        ...exchangedAt(call, declared, reading.types),
      },
    });
    holder.ensure();
    reading.builder.addEdge({ from: holder.id, to: id, type: 'calls', confidence: 'static', file, line: at.line });
  };

  /** Where a client sends: a setting, or a host and port written as text. */
  const addressOf = (address: TsNode): Record<string, string> | undefined => {
    const literal = evaluateExpression(valueOf(address));
    if (literal.resolved && typeof literal.value === 'string') {
      const host = literal.value.replace(/^(?:dns|ipv4|ipv6|unix):(?:\/\/\/?)?/, '').replace(/\/.*$/, '');
      return host === '' ? undefined : { host };
    }
    const read = reading.addressOf(address);
    const out: Record<string, string> = {
      ...(read.baseUrlEnv === null ? {} : { baseUrlEnv: read.baseUrlEnv }),
      ...(read.baseUrlDefault === undefined ? {} : { baseUrlDefault: read.baseUrlDefault }),
      ...(read.host === null ? {} : { host: read.host }),
    };
    return Object.keys(out).length === 0 ? undefined : out;
  };

  const seen = new Set<CallExpression>();
  for (const holder of holders) {
    if (holder.body === undefined) continue;
    forEachCall(holder.body, (node) => {
      if (!Node.isCallExpression(node) || seen.has(node)) return;
      const asked = askedOf(node);
      if (asked === undefined || CLIENT_METHODS.has(asked.method)) return;
      const client = clientOf(asked.receiver, node, holder.file);
      if (client === undefined) return;
      seen.add(node);
      record(holder, node, client, asked.method);
    });
  }
  return read;
};

/** Whether a constructor is spelled as a generated client is, so that one this cannot name is said rather than passed over. */
const looksGenerated = (ctor: TsNode): boolean => {
  const at = bare(ctor);
  const name = Node.isIdentifier(at) ? at.getText() : Node.isPropertyAccessExpression(at) ? at.getName() : '';
  return /ServiceClient$/.test(name);
};
