import {
  forEachCall,
  hasAnyDependency,
  makeLeafId,
  resolveStaticString,
  siteOf,
  startLineOf,
  writtenKeysOf,
  type GraphBuilder,
  type PackageJson,
  type Unresolved,
} from '@flowatlas/core';
import type { ArrayLiteralExpression, CallExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import {
  PROCEDURE_CLIENTS,
  type ProcedureClient,
  type ProcedureLink,
  type ProcedureOperation,
} from './procedure-clients.js';

/** How far a name is followed to the value it was assigned, before giving up. */
const MAX_ALIASES = 4;

/** How many names a tree is followed through to the procedure a value names. */
const MAX_TREE_STEPS = 16;

/** How deep links handed to links are followed, `splitLink` inside `splitLink`. */
const MAX_LINK_DEPTH = 4;

/** A body a request may be written in, and how to put its node in the graph. */
export interface ProcedureCallHolder {
  readonly body: TsNode | undefined;
  readonly id: string;
  /** Repo-relative path the body is written in. */
  readonly file: string;
  /** Puts the holder's node in the graph, once something hangs off it. */
  ensure(): void;
}

/** An address as the half reading it reads one: the browser's reader or the server's. */
export interface LinkAddress {
  /** The path, or null where it could not be read; empty where a setting holds the whole address. */
  readonly path: string | null;
  readonly baseUrlEnv: string | null;
  readonly host: string | null;
  /** What the code falls back to where the setting is not set (P77). */
  readonly baseUrlDefault?: string;
}

/**
 * What a half of the reading hands the procedure-call reader (P242).
 *
 * The browser reader and the server's request pass read one description with
 * one reader. What differs between them is said here and nothing else: which
 * node a request is - a browser's `ui_api_call` or a server's `http_out` -
 * and how the half reads an address, since a browser's settings are spelled
 * one way and a server's another.
 */
export interface ProcedureCallReading {
  readonly repo: string;
  readonly pkg: PackageJson;
  readonly builder: GraphBuilder;
  /** The node a request becomes. */
  readonly type: 'ui_api_call' | 'http_out';
  /** The repository's own sources, where the links a provider is handed are looked for. */
  sources(): readonly SourceFile[];
  /** Repo-relative POSIX path of whatever declared this node. */
  fileOf(node: TsNode): string;
  /** A link's URL, read as this half reads any address. */
  addressOf(url: TsNode): LinkAddress;
  report(row: Unresolved): void;
  /** The application a file is part of, where the service's applications are directories. */
  applicationOf?(file: string): string | undefined;
  /**
   * Whether another half of the same reading has recorded a request at this
   * site already: a full-stack repository is read by the browser half first,
   * and the server's pass leaves what it read alone.
   */
  readAlready?(file: string, line: number, column: number): boolean;
}

/**
 * A call read as a request for a procedure, where it is written: what a half
 * needs to withdraw what its other readers said about the same call, such as
 * a receiver they could not type (R173).
 */
export interface ReadProcedureCall {
  readonly file: string;
  readonly line: number;
  readonly call: CallExpression;
}

/** The expression a cast, a bang or a pair of brackets is wrapped round. */
const unwrap = (node: TsNode): TsNode => {
  let at = node;
  while (
    Node.isParenthesizedExpression(at) ||
    Node.isAsExpression(at) ||
    Node.isNonNullExpression(at) ||
    Node.isSatisfiesExpression(at) ||
    Node.isAwaitExpression(at)
  ) {
    at = at.getExpression();
  }
  return at;
};

/** The name a call is made by: `f()` is `f`, and `a.b.f()` is `f` too. */
const calleeName = (call: CallExpression): string | undefined => {
  const callee = unwrap(call.getExpression());
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

/** The value a name was declared with, through an import, or nothing. */
const initializerOf = (identifier: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(identifier)) return undefined;
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return undefined;
  for (const declaration of (symbol.getAliasedSymbol() ?? symbol).getDeclarations()) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) return unwrap(initializer);
  }
  return undefined;
};

/**
 * The value a class's own member holds, `this.orders` (P242): the member's
 * initializer, or what the constructor assigns it. A service keeps its client
 * there far more often than in a module-level name.
 */
const memberValueOf = (access: TsNode): TsNode | undefined => {
  if (!Node.isPropertyAccessExpression(access) || !Node.isThisExpression(unwrap(access.getExpression()))) return undefined;
  const name = access.getName();
  const owner = access.getFirstAncestor((node) => Node.isClassDeclaration(node) || Node.isClassExpression(node));
  if (owner === undefined || !(Node.isClassDeclaration(owner) || Node.isClassExpression(owner))) return undefined;
  const property = owner.getProperty(name);
  const initializer = property?.getInitializer();
  if (initializer !== undefined) return unwrap(initializer);
  for (const constructor of owner.getConstructors()) {
    let found: TsNode | undefined;
    constructor.getBody()?.forEachDescendant((node, traversal) => {
      if (found !== undefined) return traversal.stop();
      if (!Node.isBinaryExpression(node) || node.getOperatorToken().getText() !== '=') return undefined;
      const left = unwrap(node.getLeft());
      if (Node.isPropertyAccessExpression(left) && left.getName() === name && Node.isThisExpression(unwrap(left.getExpression()))) {
        found = unwrap(node.getRight());
      }
      return undefined;
    });
    if (found !== undefined) return found;
  }
  return undefined;
};

/** What an object's property is given, written out or by a name of the same spelling. */
const propertyValue = (property: TsNode): TsNode | undefined =>
  Node.isPropertyAssignment(property)
    ? property.getInitializer()
    : Node.isShorthandPropertyAssignment(property)
      ? property.getNameNode()
      : undefined;

/** What a name or a class member holds, or the expression itself. */
const valueOf = (expression: TsNode): TsNode => {
  const at = unwrap(expression);
  return (Node.isIdentifier(at) ? initializerOf(at) : memberValueOf(at)) ?? at;
};

/**
 * The call to one of a set of factories a value was made by.
 *
 * Asked of the value itself where the chain starts with a call —
 * `useTRPC().orders.list.queryOptions()` — and of whatever a name or a class
 * member was assigned otherwise, following it through imports and through
 * plain renamings. A name that is a parameter, or anything else with no
 * initializer to read, is not a proxy as far as this can tell, and nothing is
 * said about it: a row on every chain of four names in a repository would be
 * noise, and the chains that are requests are nearly always spelled on a
 * module-level proxy, a hook's result or a service's own member.
 */
const factoryOf = (expression: TsNode, factories: readonly string[], depth = 0): CallExpression | undefined => {
  const at = unwrap(expression);
  if (Node.isCallExpression(at)) {
    const name = calleeName(at);
    return name !== undefined && factories.includes(name) ? at : undefined;
  }
  if (depth >= MAX_ALIASES) return undefined;
  const assigned = Node.isIdentifier(at) ? initializerOf(at) : memberValueOf(at);
  return assigned === undefined ? undefined : factoryOf(assigned, factories, depth + 1);
};

/** The names between a proxy and the method that ends the chain. */
interface Path {
  readonly root: TsNode;
  readonly names: readonly string[];
  /** Set when one of the steps is computed, so the path cannot be named. */
  readonly dynamic: boolean;
}

/**
 * The names down a chain to its root. A chain that starts at a class's own
 * member, `this.orders.orders.place`, has that member as its root, since the
 * member is where the proxy is held (P242).
 */
const pathOf = (receiver: TsNode): Path => {
  const names: string[] = [];
  let dynamic = false;
  let at = unwrap(receiver);
  for (;;) {
    if (Node.isPropertyAccessExpression(at)) {
      if (Node.isThisExpression(unwrap(at.getExpression()))) return { root: at, names, dynamic };
      names.unshift(at.getName());
      at = unwrap(at.getExpression());
      continue;
    }
    if (Node.isElementAccessExpression(at)) {
      const key = at.getArgumentExpression();
      if (key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key))) {
        names.unshift(key.getLiteralText());
      } else {
        dynamic = true;
        names.unshift(`[${key?.getText() ?? '?'}]`);
      }
      at = unwrap(at.getExpression());
      continue;
    }
    return { root: at, names, dynamic };
  }
};

/** Where a client sends, as its link writes it (P58). */
type LinkReading =
  | {
      readonly kind: 'read';
      readonly protocol: string;
      readonly address: LinkAddress;
      /** The protocol of a branch that sends over a WebSocket, which a subscription takes (P242). */
      readonly socket?: string;
      /** Read from the one address the repository's links send to, not from this proxy's own (P242). */
      readonly fromRepository?: true;
    }
  | { readonly kind: 'dynamic'; readonly protocol: string; readonly why: string }
  /** Every way the link sends is a WebSocket, whose address is not read (P242). */
  | { readonly kind: 'socket'; readonly protocol: string };

/** The link a value builds, by the class it constructs or the function it calls. */
const linkMade = (made: TsNode, links: readonly ProcedureLink[]): ProcedureLink | undefined => {
  if (!Node.isNewExpression(made) && !Node.isCallExpression(made)) return undefined;
  const callee = unwrap(made.getExpression());
  const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
  const how = Node.isNewExpression(made) ? 'new' : 'call';
  return links.find((link) => link.name === name && (link.made ?? 'new') === how);
};

/** One address standing for the whole of what several readings say, or why there is none. */
const together = (readings: readonly LinkReading[], protocol: string, why: string): LinkReading | undefined => {
  const sent = readings.filter((reading) => reading.kind !== 'socket');
  // A socket a branch sends over, here or in a split further down.
  const socket = readings
    .map((reading) => (reading.kind === 'socket' ? reading.protocol : reading.kind === 'read' ? reading.socket : undefined))
    .find((protocol) => protocol !== undefined);
  if (sent.length === 0) return readings.length === 0 ? undefined : { kind: 'socket', protocol: readings[0]?.protocol ?? protocol };
  const unread = sent.find((reading) => reading.kind === 'dynamic');
  if (unread !== undefined) return unread;
  const addresses = new Map<string, LinkReading>();
  for (const reading of sent) {
    if (reading.kind !== 'read') continue;
    const { path, baseUrlEnv, host } = reading.address;
    addresses.set([reading.protocol, path, baseUrlEnv, host].join('\0'), reading);
  }
  if (addresses.size > 1) return { kind: 'dynamic', protocol, why };
  const [one] = addresses.values();
  if (one === undefined || one.kind !== 'read') return undefined;
  return socket === undefined ? one : { ...one, socket };
};

/**
 * How the link a factory is handed is read: built in place or named, a chain
 * of links whose last one sends, or a link that hands each request to one of
 * several (P242). Nothing where no link the description names is found, which
 * says nothing about the address rather than something wrong.
 */
const linkReader = (client: ProcedureClient, reading: ProcedureCallReading) => {
  const links = client.links ?? [];

  /** The URL a link's options carry, or why it cannot be read as an address. */
  const urlOf = (made: TsNode, link: ProcedureLink): LinkReading => {
    if (!Node.isNewExpression(made) && !Node.isCallExpression(made)) {
      return { kind: 'dynamic', protocol: link.protocol, why: 'the link is not built here' };
    }
    const options = made.getArguments()[link.optionsAt];
    const written = options === undefined ? undefined : valueOf(options);
    if (written === undefined || !Node.isObjectLiteralExpression(written)) {
      return { kind: 'dynamic', protocol: link.protocol, why: 'its options are not written where it is built' };
    }
    const urlKey = link.urlKey ?? 'url';
    const property = written.getProperty(urlKey);
    if (property === undefined) return { kind: 'dynamic', protocol: link.protocol, why: `its options name no ${urlKey}` };
    const value = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
    const url = value === undefined ? undefined : unwrap(value);
    if (url === undefined || Node.isArrowFunction(url) || Node.isFunctionExpression(url) || Node.isMethodDeclaration(property)) {
      return { kind: 'dynamic', protocol: link.protocol, why: `its ${urlKey} is worked out when each request is sent` };
    }
    const address = reading.addressOf(url);
    if (address.path === null) return { kind: 'dynamic', protocol: link.protocol, why: 'its URL is not written as text or a setting' };
    return { kind: 'read', protocol: link.protocol, address };
  };

  const readLink = (made: TsNode, link: ProcedureLink, depth: number): LinkReading | undefined => {
    if (link.socket === true) return { kind: 'socket', protocol: link.protocol };
    if (link.branches === undefined) return urlOf(made, link);
    if (!Node.isCallExpression(made) && !Node.isNewExpression(made)) return undefined;
    const options = made.getArguments()[link.optionsAt];
    const written = options === undefined ? undefined : valueOf(options);
    if (written === undefined || !Node.isObjectLiteralExpression(written)) {
      return { kind: 'dynamic', protocol: link.protocol, why: `the links ${link.name} chooses between are not written where it is built` };
    }
    const readings: LinkReading[] = [];
    for (const key of link.branches) {
      const property = written.getProperty(key);
      const branch = property === undefined ? undefined : propertyValue(property);
      if (branch === undefined) continue;
      const read = readSending(branch, depth + 1);
      readings.push(read ?? { kind: 'dynamic', protocol: link.protocol, why: `a link ${link.name} chooses is not one this reads` });
    }
    return together(readings, link.protocol, `the links ${link.name} chooses between send to different addresses`);
  };

  /** A chain of links: the last one sends, and the ones in front pass a request on. */
  const readChain = (chain: ArrayLiteralExpression, depth: number): LinkReading | undefined => {
    const elements = chain.getElements();
    const last = elements[elements.length - 1];
    if (last === undefined) return undefined;
    const protocol = links[0]?.protocol ?? client.name;
    if (Node.isSpreadElement(last)) return { kind: 'dynamic', protocol, why: 'its last link is spread from another list' };
    const made = valueOf(last);
    const link = linkMade(made, links);
    if (link === undefined) {
      return { kind: 'dynamic', protocol, why: `its last link, ${unwrap(last).getText().slice(0, 40)}, is not one this reads` };
    }
    return readLink(made, link, depth);
  };

  /** What a value handed to a factory or a link says about where requests go. */
  const readSending = (handed: TsNode, depth: number): LinkReading | undefined => {
    if (depth >= MAX_LINK_DEPTH) return undefined;
    const at = valueOf(handed);
    if (Node.isArrayLiteralExpression(at)) return readChain(at, depth);
    const link = linkMade(at, links);
    if (link !== undefined) return readLink(at, link, depth);
    if (client.linksKey !== undefined && Node.isObjectLiteralExpression(at)) {
      const property = at.getProperty(client.linksKey);
      const chain = property === undefined ? undefined : propertyValue(property);
      return chain === undefined ? undefined : readSending(chain, depth + 1);
    }
    return undefined;
  };

  /**
   * The link a proxy's factory was handed, followed through the proxies it was
   * made from: `createTanstackQueryUtils(client)` to `createORPCClient(link)` to
   * `new RPCLink({ url })`.
   */
  const linkOf = (factory: CallExpression, depth = 0): LinkReading | undefined => {
    if (links.length === 0 || depth >= MAX_ALIASES) return undefined;
    for (const argument of factory.getArguments()) {
      const found = readSending(argument, 0);
      if (found !== undefined) return found;
      const inner = factoryOf(argument, [...client.proxies, ...(client.untyped?.proxies ?? [])]);
      if (inner !== undefined) {
        const through = linkOf(inner, depth + 1);
        if (through !== undefined) return through;
      }
    }
    return undefined;
  };

  /**
   * Where a proxy whose factory takes no link sends (P242): a hook's proxy,
   * `createTRPCReact()`, whose client is made elsewhere and handed to a
   * provider. The repository's own chains of links are read, and where they
   * all send to one address that is where every such proxy sends; where they
   * send to several, which one a proxy reaches is the provider's business at
   * run time, and that is said rather than chosen.
   */
  let repositoryLink: LinkReading | null | undefined;
  const repositoryLinkOf = (): LinkReading | undefined => {
    if (repositoryLink !== undefined) return repositoryLink ?? undefined;
    const readings: LinkReading[] = [];
    for (const source of reading.sources()) {
      source.forEachDescendant((node) => {
        if (
          client.linksKey !== undefined &&
          (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) &&
          node.getName() === client.linksKey
        ) {
          const chain = propertyValue(node);
          const read = chain === undefined ? undefined : readSending(chain, 0);
          if (read !== undefined) readings.push(read);
          return;
        }
        // A link built with `new` stands on its own; one made by a call is
        // read as the chain it is part of, or not at all.
        if (Node.isNewExpression(node)) {
          const link = linkMade(node, links);
          if (link !== undefined) readings.push(readLink(node, link, 0) ?? { kind: 'dynamic', protocol: link.protocol, why: 'it is not built here' });
        }
      });
    }
    const protocol = links[0]?.protocol ?? client.name;
    const one = together(readings, protocol, 'the repository builds links to more than one address, and which one this proxy is given is decided where it is provided');
    repositoryLink = one === undefined ? null : one.kind === 'read' ? { ...one, fromRepository: true } : one;
    return repositoryLink ?? undefined;
  };

  return { linkOf, repositoryLinkOf };
};

/**
 * The procedure a value names, by where it is declared (P58): a tree's member
 * followed through names and the calls that assemble trees, down to the chain
 * the member is. The declaration's file and line are what the server's entry
 * carries, so the request joins it exactly even where its path is relative to
 * a tree below the root.
 */
const declaredAt = (root: TsNode, names: readonly string[], reading: ProcedureCallReading): string | undefined => {
  let at: TsNode | undefined = unwrap(root);
  const next = (value: TsNode): TsNode | undefined => {
    let node: TsNode | undefined = unwrap(value);
    for (let step = 0; node !== undefined && step < MAX_TREE_STEPS; step += 1) {
      if (Node.isIdentifier(node)) {
        node = initializerOf(node);
        continue;
      }
      return node;
    }
    return undefined;
  };
  at = next(at);
  for (const name of names) {
    if (at === undefined) return undefined;
    // A call assembling a tree hands back the literal it was given.
    if (Node.isCallExpression(at)) {
      const [tree] = at.getArguments();
      at = tree === undefined ? undefined : next(tree);
    }
    if (at === undefined || !Node.isObjectLiteralExpression(at)) return undefined;
    const property = at.getProperty(name);
    if (property === undefined) return undefined;
    if (Node.isShorthandPropertyAssignment(property)) {
      const symbol = property.getValueSymbol();
      const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
      const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
      at = initializer === undefined ? undefined : next(initializer);
      continue;
    }
    at = Node.isPropertyAssignment(property) ? next(property.getInitializerOrThrow()) : undefined;
  }
  if (at === undefined || !Node.isCallExpression(at)) return undefined;
  return `${reading.fileOf(at)}:${startLineOf(at)}`;
};

/** Whether a name is imported from one of these packages, or from a module below one. */
const importedFrom = (identifier: TsNode, packages: readonly string[]): boolean => {
  const declaration = identifier.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isImportSpecifier(declaration)) return false;
  const module = declaration.getImportDeclaration().getModuleSpecifierValue();
  return packages.some((name) => module === name || module.startsWith(`${name}/`));
};

/** One request for a procedure, as the reader found it. */
interface Asked {
  readonly operation: string;
  readonly shape: ProcedureOperation;
  readonly path: Path;
  readonly factory?: CallExpression;
  /** The procedure's declaration, where its value could be followed (P58). */
  readonly procedureAt?: string;
  readonly inProcess?: boolean;
}

/**
 * The path an untyped client's operation names as text (P242):
 * `client.query('orders.list', input)`. A computed one is a path with a
 * computed step, said as such.
 */
const writtenPath = (call: CallExpression, at: number, separator: string): Path => {
  const argument = call.getArguments()[at];
  const read = argument === undefined ? null : resolveStaticString(unwrap(argument));
  if (read === null || read.envRefs.length > 0 || read.guessed === true || read.value === '') {
    return { root: call, names: [`[${argument?.getText().slice(0, 40) ?? '?'}]`], dynamic: true };
  }
  return { root: call, names: read.value.split(separator), dynamic: false };
};

/**
 * Procedures a client asks for by name, in the bodies a half of the reading
 * walks.
 *
 * The server half reads a tree of procedures and names each by its path,
 * `orders.list`, rather than by a URL, because the URL is the client's link's
 * business and one tree is served at many. This is the half that reads the same
 * string where a caller writes it — `trpc.orders.list.useQuery(…)`,
 * `orders.orders.place(input)` in a worker — and makes it a request node
 * carrying the path and what the call does. Joining the two is the linker's, as
 * it is for every other request with an address: the procedure may be served by
 * the repository the call is written in or by another one the link or the
 * configuration names, and only the linker can see both.
 *
 * The node is the half's ordinary request with kind `rpc` - a browser's
 * `ui_api_call`, a server's `http_out` (P242) - so everything that asks who
 * calls what already sees it. It carries no verb and no path, because there is
 * none: a procedure path in `meta.path` would be read as a URL by everything
 * that reads `meta.path`, and joined to routes it has nothing to do with. The
 * address the client's link sends to is `meta.link`, apart from it (P58).
 */
export const readProcedureCalls = (holders: Iterable<ProcedureCallHolder>, reading: ProcedureCallReading): readonly ReadProcedureCall[] => {
  const clients = PROCEDURE_CLIENTS.filter((client) => hasAnyDependency(reading.pkg, client.packages));
  const read: ReadProcedureCall[] = [];
  if (clients.length === 0) return read;
  const readers = new Map(clients.map((client) => [client, linkReader(client, reading)]));
  /** A link read once per proxy factory, however many requests go through it. */
  const links = new Map<CallExpression, LinkReading | undefined>();
  const linkFor = (factory: CallExpression, client: ProcedureClient): LinkReading | undefined => {
    if (!links.has(factory)) {
      const reader = readers.get(client);
      links.set(factory, reader === undefined ? undefined : (reader.linkOf(factory) ?? reader.repositoryLinkOf()));
    }
    return links.get(factory);
  };

  const record = (holder: ProcedureCallHolder, call: CallExpression, client: ProcedureClient, asked: Asked): void => {
    const { shape, path, operation } = asked;
    const { file } = holder;
    const at = siteOf(call);
    if (reading.readAlready?.(file, at.line, at.column) === true) return;
    read.push({ file, line: at.line, call });
    const id = makeLeafId(reading.type, reading.repo, file, at.line, at.column);
    const procedure = path.dynamic || path.names.length === 0 ? null : path.names.join(client.separator);
    const argument = shape.inputAt === undefined ? undefined : call.getArguments()[shape.inputAt];
    const options = argument === undefined ? undefined : unwrap(argument);
    const input =
      shape.inputKey === undefined
        ? argument
        : options !== undefined && Node.isObjectLiteralExpression(options)
          ? (() => {
              const property = options.getProperty(shape.inputKey);
              return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
            })()
          : undefined;
    const inputKeys = input === undefined ? undefined : writtenKeysOf([input]);
    const application = reading.applicationOf?.(file);
    const found = asked.factory === undefined || asked.inProcess === true ? undefined : linkFor(asked.factory, client);
    // A subscription through a link with a WebSocket branch takes the socket (P242).
    const link: LinkReading | undefined =
      found?.kind === 'read' && found.socket !== undefined && shape.call === 'subscription' ? { kind: 'socket', protocol: found.socket } : found;
    const linkMeta =
      link === undefined
        ? undefined
        : link.kind === 'read'
          ? {
              protocol: link.protocol,
              ...(link.address.path === null || link.address.path === '' ? {} : { path: link.address.path }),
              ...(link.address.baseUrlEnv === null ? {} : { baseUrlEnv: link.address.baseUrlEnv }),
              ...(link.address.baseUrlDefault === undefined ? {} : { baseUrlDefault: link.address.baseUrlDefault }),
              ...(link.address.host === null ? {} : { host: link.address.host }),
              ...(link.fromRepository === true ? { from: 'repository' } : {}),
            }
          : link.kind === 'socket'
            ? { protocol: link.protocol, socket: true }
            : { protocol: link.protocol, dynamic: true };
    const named = procedure ?? (path.names.length > 0 ? path.names.join(client.separator) : unwrap(path.root).getText().slice(0, 60));

    reading.builder.addNode({
      id,
      type: reading.type,
      label: `rpc ${named}`,
      repo: reading.repo,
      file,
      line: at.line,
      kind: 'rpc',
      meta: {
        // The string the server's entry carries as `meta.key`, and the whole of
        // what the join matches on.
        procedure,
        // What the server has to have declared it as, in the server's own word.
        call: shape.call,
        // How it was spelled here, which is what a reader searching the source
        // for this call will type.
        operation,
        client: client.name,
        ...(inputKeys === undefined ? {} : { inputKeys }),
        ...(application === undefined ? {} : { application }),
        ...(linkMeta === undefined ? {} : { link: linkMeta }),
        ...(asked.procedureAt === undefined ? {} : { procedureAt: asked.procedureAt }),
        ...(asked.inProcess === true ? { inProcess: true } : {}),
      },
    });
    holder.ensure();
    const known = procedure !== null || asked.procedureAt !== undefined;
    reading.builder.addEdge({
      from: holder.id,
      to: id,
      type: 'calls',
      confidence: known ? 'static' : 'heuristic',
      file,
      line: at.line,
    });

    const symbol = asked.factory === undefined ? named : asked.factory.getText().slice(0, 80);
    if (!known) {
      reading.report({
        file,
        line: at.line,
        reason: 'procedure-path-dynamic',
        hint: 'A step of the path is computed, so the procedure it reaches cannot be named. Write each step as a name.',
        symbol: call.getText().slice(0, 80),
      });
    }
    if (link?.kind === 'dynamic') {
      reading.report({
        file,
        line: at.line,
        reason: 'procedure-link-dynamic',
        level: 'info',
        message: `${named} is sent through a link whose address cannot be read: ${link.why}, so the service it reaches is the one apiTarget names.`,
        hint: 'Write the link URL as text, or as a setting followed by a path, where the link is built.',
        symbol,
      });
    }
    if (link?.kind === 'socket') {
      reading.report({
        file,
        line: at.line,
        reason: 'procedure-link-socket',
        level: 'info',
        message: `${named} is sent over a WebSocket link, whose address is the socket client's and is not read, so the service it reaches is the one apiTarget names.`,
        hint: 'Nothing is wrong. Name the service the socket connects to in services[].apiTarget of this service, so the request is joined there.',
        symbol,
      });
    }
  };

  /** What one call asks, of the first client that recognises it. */
  const askedBy = (node: CallExpression, client: ProcedureClient): Asked | undefined => {
    const callee = unwrap(node.getExpression());
    if (Node.isIdentifier(callee)) {
      const caller = client.callers?.find((each) => each.name === callee.getText());
      if (caller === undefined || !importedFrom(callee, client.packages)) return undefined;
      const handed = node.getArguments()[caller.procedureAt];
      if (handed === undefined) return undefined;
      const path = pathOf(handed);
      const procedureAt = declaredAt(path.root, path.names, reading);
      return {
        operation: caller.name,
        shape: { call: caller.call, inputAt: caller.inputAt },
        path,
        ...(procedureAt === undefined ? {} : { procedureAt }),
        inProcess: true,
      };
    }
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const operation = callee.getName();
    // The untyped client, which names the path as text (P242).
    // Own keys only: `toString` is on every object and ends no chain.
    const untyped = client.untyped !== undefined && Object.hasOwn(client.untyped.operations, operation) ? client.untyped.operations[operation] : undefined;
    if (untyped !== undefined && client.untyped !== undefined) {
      const factory = factoryOf(callee.getExpression(), client.untyped.proxies);
      if (factory !== undefined) {
        return { operation, shape: untyped, path: writtenPath(node, untyped.pathAt, client.separator), factory };
      }
    }
    const shape = Object.hasOwn(client.operations, operation) ? client.operations[operation] : undefined;
    if (shape !== undefined) {
      const path = pathOf(callee.getExpression());
      const factory = path.names.length === 0 ? undefined : factoryOf(path.root, client.proxies);
      if (factory !== undefined) return { operation, shape, path, factory };
    }
    // The path itself called, on a proxy that is a client (P58).
    if (client.direct === undefined) return undefined;
    const path = pathOf(callee);
    const factory = factoryOf(path.root, client.proxies);
    const made = factory === undefined ? undefined : calleeName(factory);
    if (factory === undefined || made === undefined || !client.direct.proxies.includes(made)) return undefined;
    const inProcess = client.inProcess?.includes(made) === true;
    const [tree] = factory.getArguments();
    const procedureAt = inProcess && tree !== undefined && !path.dynamic ? declaredAt(tree, path.names, reading) : undefined;
    return {
      operation: 'call',
      shape: client.direct.operation,
      path,
      factory,
      ...(procedureAt === undefined ? {} : { procedureAt }),
      ...(inProcess ? { inProcess } : {}),
    };
  };

  const seen = new Set<CallExpression>();
  for (const holder of holders) {
    if (holder.body === undefined) continue;
    forEachCall(holder.body, (node) => {
      if (!Node.isCallExpression(node) || seen.has(node)) return;
      for (const client of clients) {
        const asked = askedBy(node, client);
        if (asked === undefined) continue;
        seen.add(node);
        record(holder, node, client, asked);
        return;
      }
    });
  }
  return read;
};
