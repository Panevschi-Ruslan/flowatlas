import {
  forEachCall,
  hasAnyDependency,
  normalizePath,
  providerIndex,
  UNREAD_SPAN,
  sameToken,
  type WrittenProvider,
  makeLeafId,
  resolveStaticString,
  siteOf,
  startLineOf,
  writtenKeysOf,
  formatTypeRef,
  parseTypeRef,
  type GraphBuilder,
  type PackageJson,
  type TypeCollector,
  type TypeRefAst,
  type TypeRefField,
  type Unresolved,
} from '@flowatlas/core';
import type { ArrayLiteralExpression, CallExpression, NewExpression, Node as TsNode, SourceFile, Type } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import {
  PROCEDURE_CLIENTS,
  type ProcedureClient,
  type ProcedureLink,
  type ProcedureOperation,
  type UntypedOperation,
} from './procedure-clients.js';

/** What makes a proxy: a factory's call, or a class of the client's package built with `new` (P277). */
type Made = CallExpression | NewExpression;

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
  /** Parts of the body read by holders of their own: a factory's members (P288). */
  readonly leaveOut?: ReadonlySet<TsNode>;
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
  /**
   * The half's type collector, which types what a call hands a procedure and
   * what it reads back (P247), so `contracts` can compare both with the
   * procedure's. Without one nothing is typed.
   */
  readonly types?: Pick<TypeCollector, 'collectType' | 'unwrapAsync'>;
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

/** The name a call is made by: `f()` is `f`, and `a.b.f()` is `f` too; `new A()` is `A`. */
const calleeName = (call: Made): string | undefined => {
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

/** Whether a name is imported from one of these packages, or from a module below one. */
const importedFrom = (identifier: TsNode, packages: readonly string[]): boolean => {
  const declaration = identifier.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isImportSpecifier(declaration)) return false;
  const module = declaration.getImportDeclaration().getModuleSpecifierValue();
  return packages.some((name) => module === name || module.startsWith(`${name}/`));
};

/** The containers whose `@Inject(TOKEN)` hands a parameter what is provided for a token (P247). */
const INJECTING = ['@nestjs/common', '@angular/core'] as const;

/**
 * The value a repository provides for an injection token, or nothing (P247),
 * and what it hands a parameter, one call away (P256).
 */
export interface ProvidedValue {
  (token: TsNode): TsNode | undefined;
  /**
   * The expression a parameter is handed: the argument of the one call the
   * repository makes of its function, or, for a provider's factory, the
   * value provided for the token in its place of the provider's `inject`.
   */
  readonly handed?: (parameter: TsNode) => TsNode | undefined;
}

/** The token a field initialised `inject(BILLING)` is handed by (P247). */
const injectedToken = (value: TsNode | undefined): TsNode | undefined => {
  if (value === undefined || !Node.isCallExpression(value)) return undefined;
  const callee = unwrap(value.getExpression());
  if (!Node.isIdentifier(callee) || callee.getText() !== 'inject' || !importedFrom(callee, ['@angular/core'])) return undefined;
  return value.getArguments()[0];
};

/** The token a constructor parameter property is decorated with, `@Inject(BILLING)` (P247). */
const tokenOfParameter = (owner: TsNode, name: string): TsNode | undefined => {
  if (!Node.isClassDeclaration(owner) && !Node.isClassExpression(owner)) return undefined;
  for (const constructor of owner.getConstructors()) {
    for (const parameter of constructor.getParameters()) {
      if (parameter.getName() !== name || !parameter.isParameterProperty()) continue;
      for (const decorator of parameter.getDecorators()) {
        const called = decorator.getCallExpression();
        const callee = called === undefined ? undefined : unwrap(called.getExpression());
        if (callee === undefined || !Node.isIdentifier(callee) || callee.getText() !== 'Inject' || !importedFrom(callee, INJECTING)) continue;
        return called?.getArguments()[0];
      }
    }
  }
  return undefined;
};

/**
 * The value a class's own member holds, `this.orders` (P242): the member's
 * initializer, or what the constructor assigns it. A service keeps its client
 * there far more often than in a module-level name. A member injected by a
 * token holds what the repository provides for the token (P247): the client
 * a module's `useFactory` builds, which is how a NestJS service is most often
 * handed one.
 */
const memberValueOf = (access: TsNode, provided?: ProvidedValue): TsNode | undefined => {
  if (!Node.isPropertyAccessExpression(access) || !Node.isThisExpression(unwrap(access.getExpression()))) return undefined;
  const name = access.getName();
  const owner = access.getFirstAncestor((node) => Node.isClassDeclaration(node) || Node.isClassExpression(node));
  if (owner === undefined || !(Node.isClassDeclaration(owner) || Node.isClassExpression(owner))) return undefined;
  const property = owner.getProperty(name);
  const initializer = property?.getInitializer();
  const written = initializer === undefined ? undefined : unwrap(initializer);
  const token = injectedToken(written) ?? (written === undefined ? tokenOfParameter(owner, name) : undefined);
  if (token !== undefined) return provided?.(token);
  if (written !== undefined) return written;
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
const valueOf = (expression: TsNode, provided?: ProvidedValue): TsNode => {
  const at = unwrap(expression);
  return (Node.isIdentifier(at) ? initializerOf(at) : memberValueOf(at, provided)) ?? boundOf(at, provided) ?? at;
};

/** The object a value is, written in place or held by a name. */
const objectIn = (value: TsNode | undefined): TsNode | undefined => {
  const at = value === undefined ? undefined : unwrap(value);
  if (at === undefined) return undefined;
  if (Node.isObjectLiteralExpression(at)) return at;
  const held = Node.isIdentifier(at) ? initializerOf(at) : undefined;
  return held !== undefined && Node.isObjectLiteralExpression(held) ? held : undefined;
};

/** What a member of an object written in place is given: a value, or a method written on it. */
const memberIn = (object: TsNode | undefined, name: string): TsNode | undefined => {
  if (object === undefined || !Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(name);
  if (property === undefined) return undefined;
  if (Node.isMethodDeclaration(property)) return property;
  const value = propertyValue(property);
  return value === undefined ? undefined : unwrap(value);
};

/**
 * What a parameter, or a member of one, stands for one call away (P256): the
 * `options.url` a configuring method's provider builds its link from is the
 * `url` of the object the repository's one call of the method hands it -
 * `BillingClientModule.forRoot({ url: process.env.BILLING_URL })` - and the
 * `opts.url` of a provider's factory is the `url` of what the repository
 * provides for the token it injects in that place. A destructured parameter
 * is the same member of what it is handed. Nothing where the reading was not
 * handed a way to bind, or nothing is handed.
 */
const boundOf = (expression: TsNode, provided?: ProvidedValue, depth = 0): TsNode | undefined => {
  const handed = provided?.handed;
  if (handed === undefined || depth >= MAX_ALIASES) return undefined;
  const at = unwrap(expression);
  if (Node.isIdentifier(at)) {
    // `{ url }` names the property; the value it is given is the name's.
    const holder = at.getParent();
    const symbol = holder !== undefined && Node.isShorthandPropertyAssignment(holder) ? holder.getValueSymbol() : at.getSymbol();
    const declaration = symbol?.getDeclarations()[0];
    if (declaration !== undefined && Node.isParameterDeclaration(declaration) && !declaration.isParameterProperty()) {
      const value = handed(declaration);
      return value === undefined ? undefined : unwrap(value);
    }
    if (declaration !== undefined && Node.isBindingElement(declaration)) {
      const parameter = declaration.getParent()?.getParent();
      if (parameter === undefined || !Node.isParameterDeclaration(parameter)) return undefined;
      const name = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
      const object = handed(parameter);
      return memberIn(objectIn(object === undefined ? undefined : (boundOf(object, provided, depth + 1) ?? object)), name);
    }
    return undefined;
  }
  if (!Node.isPropertyAccessExpression(at)) return undefined;
  const owner = unwrap(at.getExpression());
  const object = boundOf(owner, provided, depth + 1) ?? (Node.isIdentifier(owner) ? initializerOf(owner) : undefined);
  return memberIn(objectIn(object === undefined ? undefined : (boundOf(object, provided, depth + 1) ?? object)), at.getName());
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
const factoryOf = (
  expression: TsNode,
  factories: readonly string[],
  provided?: ProvidedValue,
  depth = 0,
): Made | undefined => {
  const at = unwrap(expression);
  if (Node.isCallExpression(at) || Node.isNewExpression(at)) {
    const name = calleeName(at);
    return name !== undefined && factories.includes(name) ? at : undefined;
  }
  if (depth >= MAX_ALIASES) return undefined;
  const assigned = (Node.isIdentifier(at) ? initializerOf(at) : memberValueOf(at, provided)) ?? boundOf(at, provided);
  return assigned === undefined ? undefined : factoryOf(assigned, factories, provided, depth + 1);
};

/**
 * The one expression a function returns: an arrow's body, or its only
 * `return`. A function a parameter is handed, one call away, is the one
 * written there (P256): `useFactory: options.useFactory`.
 */
const returnedBy = (fn: TsNode | undefined, provided?: ProvidedValue): TsNode | undefined => {
  if (fn === undefined) return undefined;
  const named = Node.isIdentifier(fn)
    ? (initializerOf(fn) ?? (fn.getSymbol()?.getAliasedSymbol() ?? fn.getSymbol())?.getDeclarations().find((declaration) => Node.isFunctionDeclaration(declaration)))
    : unwrap(fn);
  const at = named === undefined ? boundOf(fn, provided) : Node.isPropertyAccessExpression(named) ? (boundOf(named, provided) ?? named) : named;
  if (at === undefined) return undefined;
  if (Node.isArrowFunction(at)) {
    const body = at.getBody();
    if (!Node.isBlock(body)) return unwrap(body);
  }
  if (!Node.isArrowFunction(at) && !Node.isFunctionExpression(at) && !Node.isFunctionDeclaration(at) && !Node.isMethodDeclaration(at)) {
    return undefined;
  }
  const body = at.getBody();
  if (body === undefined || !Node.isBlock(body)) return undefined;
  const returns = body.getStatements().filter((statement) => Node.isReturnStatement(statement));
  const [only] = returns;
  const value = returns.length === 1 && only !== undefined && Node.isReturnStatement(only) ? only.getExpression() : undefined;
  return value === undefined ? undefined : unwrap(value);
};

/**
 * What a call to one of the repository's own functions returns, one step
 * (P247): a factory written `useFactory() { return build(); }`. A call to a
 * function with no body here - a library's - is the value itself.
 */
const madeBy = (value: TsNode): TsNode => {
  if (!Node.isCallExpression(value)) return value;
  const callee = unwrap(value.getExpression());
  return (Node.isIdentifier(callee) ? returnedBy(callee) : undefined) ?? value;
};

/**
 * What the repository provides for each injection token (P247), as both
 * containers write it: `{ provide: TOKEN, useFactory }` - the expression the
 * factory returns - or `{ provide: TOKEN, useValue }`. Read once, over the
 * repository's own sources, when a member injected by a token is first asked
 * about. One provider of a token is its value; none or several is nothing:
 * which one a container hands is its business at run time, and the injection
 * reader already says a token is ambiguous or unknown.
 *
 * A provider a configuring method builds (P256) - `forRoot` returning `{
 * module, providers: [...] }`, written in this service or in a package of
 * the workspace it declares - is one where the method is called: a
 * `forRootAsync` beside it that nothing calls provides nothing. Its factory
 * reads what the method was handed through `handed`, which is also how a
 * factory's own parameters are read: the value provided for the token in its
 * place of `inject`.
 */
const providedValues = (sources: () => readonly SourceFile[]): ProvidedValue => {
  // Which providers the repository makes, and how its functions are called, is the injection reader's rule too (P259).
  const written = providerIndex(sources);
  /** Tokens being worked out, so a provider whose factory injects its own token is nothing rather than a loop. */
  const asking = new Set<TsNode>();
  const provided: ProvidedValue = Object.assign(
    (token: TsNode): TsNode | undefined => {
      const mine = written.of(token).filter((provider) => provider.factory !== undefined || provider.given !== undefined);
      if (mine.length !== 1) return undefined;
      const [one] = mine as [WrittenProvider];
      if (asking.has(one.token)) return undefined;
      asking.add(one.token);
      try {
        const value = one.factory !== undefined ? returnedBy(one.factory, provided) : one.given;
        return value === undefined ? undefined : madeBy(unwrap(value));
      } finally {
        asking.delete(one.token);
      }
    },
    {
      handed: (parameter: TsNode): TsNode | undefined => {
        if (!Node.isParameterDeclaration(parameter)) return undefined;
        const fn = parameter.getParent();
        if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn) && !Node.isMethodDeclaration(fn)) return undefined;
        const index = fn.getParameters().indexOf(parameter);
        // A provider's factory is handed what is provided for the tokens it injects, in order.
        const holder = Node.isMethodDeclaration(fn) ? fn : fn.getParent();
        const isFactory =
          holder !== undefined && (Node.isPropertyAssignment(holder) || Node.isMethodDeclaration(holder)) && holder.getName() === 'useFactory';
        const object = isFactory ? holder.getParent() : undefined;
        if (object !== undefined && Node.isObjectLiteralExpression(object) && object.getProperty('provide') !== undefined) {
          const inject = memberIn(object, 'inject');
          const list = inject === undefined ? undefined : unwrap(valueOf(inject));
          const token = list !== undefined && Node.isArrayLiteralExpression(list) ? list.getElements()[index] : undefined;
          return token === undefined || Node.isSpreadElement(token) ? undefined : provided(token);
        }
        // Any other function is handed the argument of the one call the repository makes of it.
        const found = written.callsOf(fn);
        const [only] = found;
        return found.length === 1 && only !== undefined ? only.getArguments()[index] : undefined;
      },
    },
  );
  return provided;
};

/** The pieces of a URL written as a template or joined with `+`: text as written, and each other piece as the expression it is. */
const urlPieces = (url: TsNode): Array<string | TsNode> | undefined => {
  const at = unwrap(url);
  if (Node.isTemplateExpression(at)) {
    return [at.getHead().getLiteralText(), ...at.getTemplateSpans().flatMap((span) => [span.getExpression(), span.getLiteral().getLiteralText()])];
  }
  if (!Node.isBinaryExpression(at) || at.getOperatorToken().getText() !== '+') return undefined;
  const piece = (side: TsNode): Array<string | TsNode> => {
    const inner = unwrap(side);
    if (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner)) return [inner.getLiteralText()];
    return urlPieces(inner) ?? [inner];
  };
  return [...piece(at.getLeft()), ...piece(at.getRight())];
};

/** `scheme://host` at the start of a URL written out, and what follows it. */
const ABSOLUTE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/i;

/** The route part of what follows a URL's root: no query, no fragment. */
const routeOf = (text: string): string => text.split(/[?#]/)[0] ?? '';

/**
 * A link's URL built over a value one call away (P259): `${base}/rpc` where
 * `base` is a parameter of the function the link is built in, or `${options.
 * base}/trpc` where it is an option of the configuring method, each piece
 * followed to what the repository hands it - a setting, a URL written out -
 * and read as the half reads any address; what follows the opening piece is
 * text the files hold, or the URL is not read. Nothing (`undefined`) where no
 * piece is a value handed in, so the half reads the URL as it always has.
 */
const piecewise = (url: TsNode, provided: ProvidedValue, addressOf: (url: TsNode) => LinkAddress): LinkAddress | undefined => {
  const pieces = urlPieces(url);
  if (pieces === undefined) return undefined;
  let handedIn = false;
  const followed = pieces
    .filter((piece) => piece !== '')
    .map((piece) => {
      if (typeof piece === 'string') return piece;
      let at = piece;
      for (let step = 0; step < MAX_ALIASES; step += 1) {
        const handed = boundOf(at, provided);
        if (handed === undefined) break;
        at = handed;
        handedIn = true;
      }
      return at;
    });
  if (!handedIn) return undefined;
  const unread: LinkAddress = { path: null, baseUrlEnv: null, host: null };
  const textOfStatic = (piece: TsNode): string | undefined => {
    const found = resolveStaticString(unwrap(piece));
    return found === null || found.envRefs.length > 0 || found.guessed === true || found.value.includes(UNREAD_SPAN) ? undefined : found.value;
  };
  const textOf = (piece: string | TsNode): string | undefined => (typeof piece === 'string' ? piece : textOfStatic(piece));
  const [first, ...rest] = followed;
  if (first === undefined) return unread;
  const tail = rest.map(textOf);
  if (tail.some((text) => text === undefined)) return unread;
  const after = tail.join('');
  const opening = textOf(first);
  if (opening === undefined) {
    // The opening piece is the root - a setting, a URL - and the rest the path under it.
    const root = addressOf(first as TsNode);
    return root.path === null ? root : { ...root, path: normalizePath(`${root.path}${routeOf(after)}`) };
  }
  const whole = `${opening}${after}`;
  const absolute = ABSOLUTE.exec(whole);
  return absolute === null
    ? { path: normalizePath(routeOf(whole)), baseUrlEnv: null, host: null }
    : { path: normalizePath(routeOf(absolute[3] ?? '')), baseUrlEnv: null, host: (absolute[2] ?? '').toLowerCase() };
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
const linkReader = (client: ProcedureClient, reading: ProcedureCallReading, provided: ProvidedValue) => {
  const links = client.links ?? [];

  /** The URL a link's options carry, or why it cannot be read as an address. */
  const urlOf = (made: TsNode, link: ProcedureLink): LinkReading => {
    if (!Node.isNewExpression(made) && !Node.isCallExpression(made)) {
      return { kind: 'dynamic', protocol: link.protocol, why: 'the link is not built here' };
    }
    if (link.urlAt !== undefined) return urlHandedTo(made, link, link.urlAt);
    const options = made.getArguments()[link.optionsAt];
    const written = options === undefined ? undefined : valueOf(options, provided);
    if (written === undefined || !Node.isObjectLiteralExpression(written)) {
      return { kind: 'dynamic', protocol: link.protocol, why: 'its options are not written where it is built' };
    }
    const urlKey = link.urlKey ?? 'url';
    const property = written.getProperty(urlKey);
    if (property === undefined) return { kind: 'dynamic', protocol: link.protocol, why: `its options name no ${urlKey}` };
    const value = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
    if (Node.isMethodDeclaration(property)) {
      return { kind: 'dynamic', protocol: link.protocol, why: `its ${urlKey} is worked out when each request is sent` };
    }
    return addressFrom(value, link, `its ${urlKey}`);
  };

  /**
   * The URL a link is handed as an argument of its own (P277): a transport
   * built `new StreamableHTTPClientTransport(new URL(url))`, the `new URL`
   * read as the text or setting it is made from, and one handed a base read
   * as the path under it.
   */
  const urlHandedTo = (made: Made, link: ProcedureLink, at: number): LinkReading => {
    const argument = made.getArguments()[at];
    let value = argument === undefined ? undefined : valueOf(argument, provided);
    if (value !== undefined && Node.isNewExpression(value) && unwrap(value.getExpression()).getText() === 'URL') {
      const [path, base] = value.getArguments();
      if (base !== undefined && path !== undefined) {
        const root = addressFrom(base, link, 'the base of its URL');
        const text = resolveStaticString(unwrap(path));
        if (root.kind !== 'read') return root;
        if (text === null || text.envRefs.length > 0 || text.guessed === true) {
          return { kind: 'dynamic', protocol: link.protocol, why: 'the path of its URL is not written as text' };
        }
        return { ...root, address: { ...root.address, path: normalizePath(`${root.address.path ?? ''}/${routeOf(text.value)}`) } };
      }
      value = path;
    }
    return addressFrom(value, link, 'its URL');
  };

  /** The address a value holding a link's URL names, followed one call away, or why it names none. */
  const addressFrom = (value: TsNode | undefined, link: ProcedureLink, what: string): LinkReading => {
    // A parameter of the configuring method or factory the link is built in
    // is what the repository hands it, one call away (P256).
    const stated = value === undefined ? undefined : unwrap(value);
    let url = stated;
    for (let step = 0; url !== undefined && step < MAX_ALIASES; step += 1) {
      const handed = boundOf(url, provided);
      if (handed === undefined) break;
      url = handed;
    }
    if (url === undefined || Node.isArrowFunction(url) || Node.isFunctionExpression(url)) {
      return { kind: 'dynamic', protocol: link.protocol, why: `${what} is worked out when each request is sent` };
    }
    // A URL built over a parameter is read piece by piece, each followed one call away (P259).
    const address = piecewise(url, provided, reading.addressOf) ?? reading.addressOf(url);
    if (address.path === null) {
      return { kind: 'dynamic', protocol: link.protocol, why: what === 'its url' ? 'its URL is not written as text or a setting' : `${what} is not written as text or a setting` };
    }
    return { kind: 'read', protocol: link.protocol, address };
  };

  const readLink = (made: TsNode, link: ProcedureLink, depth: number): LinkReading | undefined => {
    if (link.socket === true) return { kind: 'socket', protocol: link.protocol };
    if (link.branches === undefined) return urlOf(made, link);
    if (!Node.isCallExpression(made) && !Node.isNewExpression(made)) return undefined;
    const options = made.getArguments()[link.optionsAt];
    const written = options === undefined ? undefined : valueOf(options, provided);
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
    const made = valueOf(last, provided);
    const link = linkMade(made, links);
    if (link === undefined) {
      return { kind: 'dynamic', protocol, why: `its last link, ${unwrap(last).getText().slice(0, 40)}, is not one this reads` };
    }
    return readLink(made, link, depth);
  };

  /** What a value handed to a factory or a link says about where requests go. */
  const readSending = (handed: TsNode, depth: number): LinkReading | undefined => {
    if (depth >= MAX_LINK_DEPTH) return undefined;
    const at = valueOf(handed, provided);
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
  const linkOf = (factory: Made, depth = 0): LinkReading | undefined => {
    if (links.length === 0 || depth >= MAX_ALIASES) return undefined;
    const connected = connectedTo(factory);
    if (connected !== undefined) return connected;
    for (const argument of factory.getArguments()) {
      const found = readSending(argument, 0);
      if (found !== undefined) return found;
      const inner = factoryOf(argument, [...client.proxies, ...(client.untyped?.proxies ?? [])], provided);
      if (inner !== undefined) {
        const through = linkOf(inner, depth + 1);
        if (through !== undefined) return through;
      }
    }
    return undefined;
  };

  /**
   * The links a client made with none is handed afterwards (P277),
   * `client.connect(transport)`: every such call on a value the factory made,
   * in the repository's own sources, read as the factory's own argument would
   * be. One address for all of them, or why there is none.
   */
  let connects: CallExpression[] | undefined;
  const connectedTo = (factory: Made): LinkReading | undefined => {
    const method = client.connect;
    if (method === undefined) return undefined;
    connects ??= reading.sources().flatMap((source) =>
      source.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
        const callee = unwrap(call.getExpression());
        return Node.isPropertyAccessExpression(callee) && callee.getName() === method && call.getArguments().length > 0;
      }),
    );
    const proxies = [...client.proxies, ...(client.untyped?.proxies ?? [])];
    const readings: LinkReading[] = [];
    for (const call of connects) {
      const callee = unwrap(call.getExpression());
      if (!Node.isPropertyAccessExpression(callee) || factoryOf(callee.getExpression(), proxies, provided) !== factory) continue;
      const [handed] = call.getArguments();
      const read = handed === undefined ? undefined : readSending(handed, 0);
      if (read !== undefined) readings.push(read);
    }
    return together(readings, links[0]?.protocol ?? client.name, 'it is connected to links that send to different addresses');
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

/**
 * The type of what a call hands a procedure (P247): the type the client
 * declares for the argument, where it declares one - a client typed from the
 * tree it calls, or from a copy of it - and otherwise the argument's own. The
 * declared type is the better answer for what each field is (an empty list
 * written in place is `never[]` on its own); a client typed `any` declares
 * nothing, and what is written is all there is. The keys a literal writes are
 * recorded beside it either way.
 */
const declaredFor = (input: TsNode): Type | undefined => {
  const declared = Node.isExpression(input) ? input.getContextualType() : undefined;
  return declared === undefined || declared.isAny() || declared.isUnknown() || declared.isTypeParameter() ? undefined : declared;
};

/**
 * A type's reference, where it names something (P247). A type the checker
 * could not resolve - a client whose package is not installed - is `any`
 * here and says so on the edge; collecting it would add a row about an
 * unresolved type at every call, where the contract check already says the
 * end has no type.
 */
export const typeRefOf = (types: Pick<TypeCollector, 'collectType'>, type: Type, at: TsNode): string =>
  type.isAny() ? 'any' : type.isUnknown() ? 'unknown' : types.collectType(type, at);

/** How deep an object written in place is read field by field. */
const MAX_WRITTEN_DEPTH = 4;

/**
 * The shape of an object written in place, field by field, each as its value
 * is written (P247): `{ status: 'open' }` sends `'open'`, which the
 * language's own type of the object widens to `string` - and a `string`
 * against a procedure's `'open' | 'shipped'` would be a mismatch nobody wrote.
 * Nothing where it is not an object written in place, or holds a spread or a
 * method, and its type is read whole.
 */
const writtenShape = (node: TsNode, types: Pick<TypeCollector, 'collectType'>, depth = 0): TypeRefAst | undefined => {
  const at = unwrap(node);
  if (!Node.isObjectLiteralExpression(at)) {
    if (depth === 0) return undefined;
    try {
      return parseTypeRef(typeRefOf(types, at.getType(), at));
    } catch {
      return undefined;
    }
  }
  if (depth >= MAX_WRITTEN_DEPTH) return undefined;
  const fields: TypeRefField[] = [];
  for (const property of at.getProperties()) {
    const name = property.getSymbol()?.getName();
    if (name === undefined || name === '') return undefined;
    const value = Node.isPropertyAssignment(property)
      ? property.getInitializer()
      : Node.isShorthandPropertyAssignment(property)
        ? property.getNameNode()
        : undefined;
    const type = value === undefined ? undefined : writtenShape(value, types, depth + 1);
    if (type === undefined) return undefined;
    fields.push({ name, optional: false, type });
  }
  // In the order written, as the language writes an object's own type.
  return { kind: 'object', fields };
};

/** The reference of what a call hands a procedure (P247): declared, else written, else its own type. */
export const sentType = (input: TsNode, types: Pick<TypeCollector, 'collectType'>): string => {
  const declared = declaredFor(input);
  if (declared !== undefined) return types.collectType(declared, input);
  const written = writtenShape(input, types);
  return written === undefined ? typeRefOf(types, input.getType(), input) : formatTypeRef(written);
};

/** One request for a procedure, as the reader found it. */
interface Asked {
  readonly operation: string;
  readonly shape: ProcedureOperation;
  readonly path: Path;
  readonly factory?: Made;
  /** The procedure's declaration, where its value could be followed (P58). */
  readonly procedureAt?: string;
  readonly inProcess?: boolean;
  /** What the server's entry key puts in front of the name (P277). */
  readonly prefix?: string;
}

/**
 * The path an untyped client's operation names as text (P242):
 * `client.query('orders.list', input)`. A computed one is a path with a
 * computed step, said as such.
 */
const writtenPath = (call: CallExpression, operation: UntypedOperation, separator: string): Path => {
  const handed = call.getArguments()[operation.pathAt];
  // The path under a key of the object handed in, `callTool({ name: 'x' })` (P277).
  const argument =
    operation.pathKey === undefined || handed === undefined ? handed : memberIn(objectIn(handed), operation.pathKey);
  const read = argument === undefined ? null : resolveStaticString(unwrap(argument));
  if (read === null || read.envRefs.length > 0 || read.guessed === true || read.value === '') {
    return { root: call, names: [`[${(argument ?? handed)?.getText().slice(0, 40) ?? '?'}]`], dynamic: true };
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
  const provided = providedValues(() => reading.sources());
  const readers = new Map(clients.map((client) => [client, linkReader(client, reading, provided)]));
  /** A link read once per proxy factory, however many requests go through it. */
  const links = new Map<Made, LinkReading | undefined>();
  const linkFor = (factory: Made, client: ProcedureClient): LinkReading | undefined => {
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
    const procedure = path.dynamic || path.names.length === 0 ? null : `${asked.prefix ?? ''}${path.names.join(client.separator)}`;
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
    // What the call hands the procedure and what it reads back, typed as the
    // code here sees them (P247), and the answer only where the call returns it.
    const { types } = reading;
    const inputType = input === undefined || types === undefined ? undefined : sentType(input, types);
    const outputType =
      shape.answers !== true || types === undefined ? undefined : typeRefOf(types, types.unwrapAsync(call.getType()), call);

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
        ...(inputType === undefined ? {} : { inputType }),
        // An input handed to what the call returns, `useMutation()` (P247),
        // or none written where this spelling takes one.
        ...(shape.inputAt === undefined ? { inputLater: true } : input === undefined ? { inputNone: true } : {}),
        ...(outputType === undefined ? {} : { outputType }),
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
        hint: client.dynamicHint ?? 'A step of the path is computed, so the procedure it reaches cannot be named. Write each step as a name.',
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
        shape: { call: caller.call, inputAt: caller.inputAt, ...(caller.answers === true ? { answers: true } : {}) },
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
      const factory = factoryOf(callee.getExpression(), client.untyped.proxies, provided);
      // A class built with `new` is the client's only where its package's (P277).
      const own = factory !== undefined && (!Node.isNewExpression(factory) || importedFrom(unwrap(factory.getExpression()), client.packages));
      if (factory !== undefined && own) {
        return {
          operation,
          shape: untyped,
          path: writtenPath(node, untyped, client.separator),
          factory,
          ...(untyped.prefix === undefined ? {} : { prefix: untyped.prefix }),
        };
      }
    }
    const shape = Object.hasOwn(client.operations, operation) ? client.operations[operation] : undefined;
    if (shape !== undefined) {
      const path = pathOf(callee.getExpression());
      const factory = path.names.length === 0 ? undefined : factoryOf(path.root, client.proxies, provided);
      if (factory !== undefined) return { operation, shape, path, factory };
    }
    // The path itself called, on a proxy that is a client (P58).
    if (client.direct === undefined) return undefined;
    const path = pathOf(callee);
    const factory = factoryOf(path.root, client.proxies, provided);
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
    }, holder.leaveOut);
  }
  return read;
};
